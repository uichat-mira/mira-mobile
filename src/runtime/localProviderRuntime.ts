import type { ChatMessage, Session } from '../types';
import { OpenAiCompatibleClient, type OpenAiCompatibleMessage } from '../provider/openAiCompatibleClient';
import { ProviderConfigStore, type LocalProviderConfig } from '../provider/providerConfigStore';
import { providerCredentialStore, type ProviderCredentialStore } from '../security/providerCredentialStore';
import { LocalSessionRepository, DEFAULT_LOCAL_SESSION_TITLE } from '../local/localSessionRepository';
import type { ConversationRuntime, RuntimeEvent } from './conversationRuntime';
import { MobileAgentLoop } from './mobileAgentLoop';
import type {
  ToolApprovalDecision,
  ToolApprovalRequest,
  ToolGatewayClient,
} from '../tools/toolGatewayClient';

const createMessageId = () => `local-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const MAX_SESSION_TITLE_LENGTH = 30;

const deriveSessionTitle = (input: string): string => {
  const normalized = input.replace(/\s+/gu, ' ').trim();
  if (!normalized) return DEFAULT_LOCAL_SESSION_TITLE;
  return normalized.length > MAX_SESSION_TITLE_LENGTH
    ? `${normalized.slice(0, MAX_SESSION_TITLE_LENGTH)}…`
    : normalized;
};

export interface LocalProviderRuntimeOptions {
  configStore?: ProviderConfigStore;
  credentialStore?: ProviderCredentialStore;
  sessionRepository?: LocalSessionRepository;
  clientFactory?: (config: LocalProviderConfig, apiKey: string) => OpenAiCompatibleClient;
  toolGateway?: ToolGatewayClient;
}

export class LocalProviderRuntime implements ConversationRuntime {
  readonly kind = 'local-provider' as const;
  readonly supportsAgent: boolean;
  private readonly configStore: ProviderConfigStore;
  private readonly credentialStore: ProviderCredentialStore;
  private readonly sessionRepository: LocalSessionRepository;
  private readonly clientFactory: (config: LocalProviderConfig, apiKey: string) => OpenAiCompatibleClient;
  private readonly toolGateway?: ToolGatewayClient;
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
              (messages, tools) =>
                client.streamChat({
                  model: config.model,
                  messages: [...messages],
                  tools: [...tools],
                }),
              {
                shouldPause: () => this.executionSuspended,
                signal: abortController?.signal,
                requestApproval: (approval) =>
                  this.waitForApprovalDecision(runToken!, approval),
              },
            )
          : await client.streamChat({
              model: config.model,
              messages: requestMessages,
            });
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
    const runtime = this;
    const assistantId = createMessageId();
    return (async function* () {
      let content = '';
      try {
        for await (const event of stream) {
          if (event.type === 'text-delta') content += event.delta;
          yield event;
        }
        if (content) {
          await repository.appendMessages(sessionId, [
            { id: assistantId, role: 'assistant', content, timestamp: new Date() },
          ]);
        }
      } finally {
        if (runtime.activeClient === client) runtime.activeClient = null;
        if (
          runtime.activeAbortController === abortController &&
          runtime.activeRunToken === runToken
        ) {
          runtime.activeAbortController = null;
          runtime.activeRunToken = null;
        }
        if (runToken) {
          runtime.rejectPendingApproval(
            new Error('Local Agent run ended before approval was resolved'),
            runToken,
          );
        }
      }
    })();
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
