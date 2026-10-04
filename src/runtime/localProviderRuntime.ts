import type { ChatMessage, Session } from '../types';
import { OpenAiCompatibleClient, type OpenAiCompatibleMessage } from '../provider/openAiCompatibleClient';
import { ProviderConfigStore, type LocalProviderConfig } from '../provider/providerConfigStore';
import { filterReasoningTagEvents } from '../provider/reasoningTagFilter';
import { providerCredentialStore, type ProviderCredentialStore } from '../security/providerCredentialStore';
import { LocalSessionRepository, DEFAULT_LOCAL_SESSION_TITLE } from '../local/localSessionRepository';
import {
  loadPersonalizationSettings,
  type PersonalizationSettings,
} from '../screens/personalizationSettings';
import type { ConversationRuntime, RuntimeEvent } from './conversationRuntime';
import { MobileAgentLoop } from './mobileAgentLoop';
import { buildLocalPersonalizationContext } from './localPersonalizationContext';
import {
  buildMemoryContext,
  createLocalProviderConsolidator,
  getLocalMemoryService,
  type LocalMemoryService,
} from '../memory';
import type {
  ToolApprovalDecision,
  ToolApprovalRequest,
  ToolGatewayClient,
} from '../tools/toolGatewayClient';

let localMessageIdSequence = 0;
const createMessageId = () => {
  localMessageIdSequence += 1;
  return `local-message-${Date.now()}-${localMessageIdSequence.toString(36)}`;
};
const MAX_SESSION_TITLE_LENGTH = 30;

const deriveSessionTitle = (input: string): string => {
  const normalized = input.replace(/\s+/gu, ' ').trim();
  if (!normalized) return DEFAULT_LOCAL_SESSION_TITLE;
  return normalized.length > MAX_SESSION_TITLE_LENGTH
    ? `${normalized.slice(0, MAX_SESSION_TITLE_LENGTH)}…`
    : normalized;
};

const applyProviderCompatibility = (
  stream: AsyncIterable<RuntimeEvent>,
  config: LocalProviderConfig,
): AsyncIterable<RuntimeEvent> =>
  config.compatibility?.reasoningTags === 'strip'
    ? filterReasoningTagEvents(stream)
    : stream;

const isCompletedAssistantFinishReason = (reason: string | null): boolean =>
  reason === 'stop' || reason === null;

export interface LocalProviderRuntimeOptions {
  configStore?: ProviderConfigStore;
  credentialStore?: ProviderCredentialStore;
  sessionRepository?: LocalSessionRepository;
  clientFactory?: (config: LocalProviderConfig, apiKey: string) => OpenAiCompatibleClient;
  toolGateway?: ToolGatewayClient;
  loadPersonalization?: () => Promise<PersonalizationSettings>;
  memoryService?: LocalMemoryService;
}

export class LocalProviderRuntime implements ConversationRuntime {
  readonly kind = 'local-provider' as const;
  readonly supportsAgent: boolean;
  private readonly configStore: ProviderConfigStore;
  private readonly credentialStore: ProviderCredentialStore;
  private readonly sessionRepository: LocalSessionRepository;
  private readonly clientFactory: (config: LocalProviderConfig, apiKey: string) => OpenAiCompatibleClient;
  private readonly toolGateway?: ToolGatewayClient;
  private readonly loadPersonalization: () => Promise<PersonalizationSettings>;
  private readonly memoryService: LocalMemoryService;
  private activeClient: OpenAiCompatibleClient | null = null;
  private activeAbortController: AbortController | null = null;
  private activeRunToken: symbol | null = null;
  private pendingApproval:
    | {
        runToken: symbol;
        invocationId: string;
        resolve: (decision: ToolApprovalDecision) => void;
        reject: (error: Error) => void;
      }
    | null = null;
  private executionSuspended = false;

  constructor(options: LocalProviderRuntimeOptions = {}) {
    this.configStore = options.configStore ?? new ProviderConfigStore();
    this.credentialStore = options.credentialStore ?? providerCredentialStore;
    this.sessionRepository = options.sessionRepository ?? new LocalSessionRepository();
    this.clientFactory =
      options.clientFactory ?? ((config, apiKey) => new OpenAiCompatibleClient({ baseUrl: config.baseUrl, apiKey }));
    this.toolGateway = options.toolGateway;
    this.loadPersonalization = options.loadPersonalization ?? loadPersonalizationSettings;
    this.memoryService = options.memoryService ?? getLocalMemoryService();
    this.supportsAgent = Boolean(this.toolGateway);
  }

  async listSessions(): Promise<Session[]> {
    const configs = await this.configStore.load();
    const sessions = await Promise.all(
      configs.map(async (config) =>
        (await this.sessionRepository.list(config.id)).map((session) => ({
          ...session,
          providerName: config.name,
          providerModel: config.model,
        })),
      ),
    );
    return sessions.flat().sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  }

  async createSession(title?: string, providerId?: string): Promise<Session> {
    const configs = await this.configStore.load();
    const config = providerId ? configs.find((item) => item.id === providerId) : configs[0];
    if (!config) throw new Error('请先配置 Local Provider');
    return this.sessionRepository.create(config.id, title);
  }

  deleteSession(sessionId: string): Promise<void> {
    return this.sessionRepository.delete(sessionId);
  }

  getSession(sessionId: string): Promise<Session> {
    return this.sessionRepository.get(sessionId);
  }

  getMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.sessionRepository.getMessages(sessionId);
  }

  async sendMessage(
    sessionId: string,
    input: string,
    options?: { agentEnabled?: boolean; messageId?: string },
  ): Promise<AsyncIterable<RuntimeEvent>> {
    const sessions = await this.listSessions();
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error('Local session was not found');
    const configs = await this.configStore.load();
    const providerId = await this.sessionRepository.getProviderId(sessionId);
    const config = configs.find((item) => item.id === providerId);
    if (!config) throw new Error('Local Provider configuration was not found');
    const apiKey = await this.credentialStore.load(config.id);
    if (!apiKey) throw new Error('Local Provider API key is not configured');

    const userMessage: ChatMessage = {
      id: options?.messageId?.trim() || createMessageId(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };
    const previous = await this.sessionRepository.getMessages(sessionId);
    const alreadyRecorded = previous.some((message) => message.id === userMessage.id);
    if (!alreadyRecorded) {
      await this.sessionRepository.appendMessages(sessionId, [userMessage]);
    }
    const canonicalMessages = alreadyRecorded ? previous : [...previous, userMessage];
    if (session.title === DEFAULT_LOCAL_SESSION_TITLE) {
      const firstUserMessage = canonicalMessages.find(
        (message) => message.role === 'user' && message.content.trim().length > 0,
      );
      if (firstUserMessage) {
        await this.sessionRepository.rename(
          sessionId,
          deriveSessionTitle(firstUserMessage.content),
        );
      }
    }
    const client = this.clientFactory(config, apiKey);
    const requestMessages = canonicalMessages.map<OpenAiCompatibleMessage>(
      (message) => ({
        role: message.role,
        content: message.content,
      }),
    );
    // Personalization is a Local-only request context. It is compiled here,
    // after canonical storage reads, so persisted history stays untouched and
    // the Remote Host path (which never enters this runtime) cannot receive it.
    // A read failure degrades to no personalization rather than failing the
    // send, and must never overwrite the persisted settings.
    let personalizationContext: string | null = null;
    try {
      personalizationContext = buildLocalPersonalizationContext(
        await this.loadPersonalization(),
      );
    } catch {
      personalizationContext = null;
    }
    if (personalizationContext) {
      requestMessages.unshift({ role: 'system', content: personalizationContext });
    }
    // Local Memory is another Local-only request context, layered after
    // Personalization so request order stays:
    //   system / agent context -> Personalization -> Local Memory -> conversation
    // A memory read failure (or disabled / empty memory) degrades to no memory
    // context rather than failing the send, and never touches persisted history.
    try {
      const snapshot = await this.memoryService.buildContext();
      const memoryContext = buildMemoryContext(snapshot);
      if (memoryContext) {
        const insertAt = personalizationContext ? 1 : 0;
        requestMessages.splice(insertAt, 0, {
          role: 'system',
          content: memoryContext,
        });
      }
    } catch {
      // Safe degradation: this turn simply runs without memory context.
    }
    if (options?.agentEnabled && this.activeRunToken) {
      const replacedClient = this.activeClient;
      this.activeAbortController?.abort();
      replacedClient?.cancelActiveRun();
      this.rejectPendingApproval(
        new Error('A newer local Agent run replaced the previous run'),
      );
      this.activeAbortController = null;
      this.activeRunToken = null;
    }
    this.activeClient = client;

    const abortController =
      options?.agentEnabled && this.toolGateway
        ? new AbortController()
        : null;
    const runToken = abortController ? Symbol('local-agent-run') : null;
    if (abortController && runToken) {
      this.activeAbortController = abortController;
      this.activeRunToken = runToken;
    }

    let stream: AsyncIterable<RuntimeEvent>;
    try {
      stream =
        options?.agentEnabled && this.toolGateway
          ? await new MobileAgentLoop(this.toolGateway).run(
              requestMessages,
              async (messages, tools) =>
                applyProviderCompatibility(
                  await client.streamChat({
                    model: config.model,
                    messages: [...messages],
                    tools: [...tools],
                  }),
                  config,
                ),
              {
                shouldPause: () => this.executionSuspended,
                signal: abortController?.signal,
                requestApproval: (approval) =>
                  this.waitForApprovalDecision(runToken!, approval),
              },
            )
          : applyProviderCompatibility(
              await client.streamChat({
                model: config.model,
                messages: requestMessages,
              }),
              config,
            );
    } catch (error) {
      if (this.activeClient === client) this.activeClient = null;
      if (
        this.activeAbortController === abortController &&
        this.activeRunToken === runToken
      ) {
        this.activeAbortController = null;
        this.activeRunToken = null;
      }
      abortController?.abort();
      if (runToken) {
        this.rejectPendingApproval(
          new Error('Local Agent setup failed before the run started'),
          runToken,
        );
      }
      throw error;
    }
    const repository = this.sessionRepository;
    const that = this;
    const assistantId = createMessageId();
    const threadId = sessionId;
    const canonicalUserMessageId = userMessage.id;
    const userText = input;
    return (async function* () {
      let content = '';
      let sawError = false;
      let paused = false;
      let finished = false;
      let finishReason: string | null = null;
      try {
        for await (const event of stream) {
          if (event.type === 'text-delta') content += event.delta;
          if (event.type === 'error') sawError = true;
          if (event.type === 'run-paused') paused = true;
          if (event.type === 'finish') {
            finished = true;
            finishReason = event.reason;
          }
          yield event;
        }
        if (content) {
          await repository.appendMessages(sessionId, [
            { id: assistantId, role: 'assistant', content, timestamp: new Date() },
          ]);
        }
        // Memory consolidation runs only for a genuinely completed turn whose
        // canonical Assistant reply was just persisted.
        //
        // "Completed" means the run reached a real final Assistant reply, not
        // merely that some text arrived. An Agent run that errored, paused
        // (app-suspended / timeout / cancelled / approval-rejected) or stopped
        // on a non-final reason (tool_calls / tool-round limit) is not a
        // completed turn: tool intermediate messages are not Memory evidence.
        const completedTurn =
          content.length > 0 &&
          !sawError &&
          !paused &&
          finished &&
          isCompletedAssistantFinishReason(finishReason);
        if (completedTurn) {
          // Detached, best-effort side effect: the canonical reply is already
          // durable, so the Chat stream / UI must complete without waiting for
          // the extra Provider consolidation call.
          that.consolidateTurn({
            threadId,
            userMessageId: canonicalUserMessageId,
            assistantMessageId: assistantId,
            userText,
            assistantText: content,
            model: config.model,
            client,
            config,
          }).catch(() => undefined);
        }
      } finally {
        if (that.activeClient === client) that.activeClient = null;
        if (
          that.activeAbortController === abortController &&
          that.activeRunToken === runToken
        ) {
          that.activeAbortController = null;
          that.activeRunToken = null;
        }
        if (runToken) {
          that.rejectPendingApproval(
            new Error('Local Agent run ended before approval was resolved'),
            runToken,
          );
        }
      }
    })();
  }

  /**
   * Consolidate one completed local turn into Memory.
   *
   * This is a best-effort, detached, Local-only side effect that runs after the
   * canonical Assistant reply is already durable. Every failure path (provider
   * error, invalid JSON, policy reject, repository failure, disabled memory) is
   * swallowed here so a Memory problem can never turn a successful chat reply
   * into a failed one. The Memory Service owns idempotency and marks the turn
   * processed only on a successful consolidation.
   *
   * The Provider-backed consolidator is built per turn from the exact Local
   * Provider client / model that produced this turn and passed explicitly into
   * `commitTurn`, so concurrent sessions can never share or overwrite each
   * other's Provider.
   */
  private async consolidateTurn(input: {
    threadId: string;
    userMessageId: string;
    assistantMessageId: string;
    userText: string;
    assistantText: string;
    model: string;
    client: OpenAiCompatibleClient;
    config: LocalProviderConfig;
  }): Promise<void> {
    try {
      const source = {
        type: 'conversation' as const,
        threadId: input.threadId,
        userMessageId: input.userMessageId,
        assistantMessageId: input.assistantMessageId,
      };
      if (await this.memoryService.isProcessed(source)) return;
      // The consolidator uses the exact same Local Provider client / model and
      // secure credential boundary as the chat request, and goes through the
      // same provider compatibility normalization (e.g. reasoning-tag stripping)
      // so a reasoning-tag-prefixed JSON payload is still parsed correctly.
      const consolidator = createLocalProviderConsolidator({
        model: input.model,
        chat: async request =>
          applyProviderCompatibility(
            await input.client.streamChat(request),
            input.config,
          ),
      });
      await this.memoryService.commitTurn({
        source,
        userText: input.userText,
        assistantText: input.assistantText,
        consolidator,
      });
    } catch {
      // Memory is an additive capability; it must never fail the chat reply.
    }
  }

  getAgentEnabled(sessionId: string): Promise<boolean> {
    return this.sessionRepository.getAgentEnabled(sessionId);
  }

  setAgentEnabled(sessionId: string, enabled: boolean): Promise<void> {
    return this.sessionRepository.setAgentEnabled(sessionId, enabled);
  }

  resolveToolApproval(
    invocationId: string,
    decision: ToolApprovalDecision,
  ) {
    const pending = this.pendingApproval;
    if (!pending || pending.invocationId !== invocationId) return;
    this.pendingApproval = null;
    pending.resolve(decision);
  }

  cancelActiveRun() {
    this.activeAbortController?.abort();
    this.activeAbortController = null;
    this.activeRunToken = null;
    this.activeClient?.cancelActiveRun();
    this.activeClient = null;
    this.rejectPendingApproval(new Error('Local Agent run was cancelled'));
  }

  setExecutionSuspended(suspended: boolean) {
    this.executionSuspended = suspended;
    if (!suspended) return;
    this.activeAbortController?.abort();
    this.activeClient?.cancelActiveRun();
    this.rejectPendingApproval(new Error('Local Agent run was suspended'));
  }

  private waitForApprovalDecision(
    runToken: symbol,
    approval: ToolApprovalRequest,
  ): Promise<ToolApprovalDecision> {
    if (this.activeRunToken !== runToken) {
      return Promise.reject(
        new Error('Local Agent run is no longer active'),
      );
    }
    this.rejectPendingApproval(
      new Error('A newer tool approval replaced the previous request'),
    );

    return new Promise<ToolApprovalDecision>((resolve, reject) => {
      this.pendingApproval = {
        runToken,
        invocationId: approval.invocationId,
        resolve,
        reject,
      };
    });
  }

  private rejectPendingApproval(error: Error, runToken?: symbol) {
    const pending = this.pendingApproval;
    if (!pending || (runToken && pending.runToken !== runToken)) return;
    this.pendingApproval = null;
    pending.reject(error);
  }
}
