import type { ChatMessage, Session } from '../types';
import { OpenAiCompatibleClient } from '../provider/openAiCompatibleClient';
import { ProviderConfigStore, type LocalProviderConfig } from '../provider/providerConfigStore';
import { providerCredentialStore, type ProviderCredentialStore } from '../security/providerCredentialStore';
import { LocalSessionRepository, DEFAULT_LOCAL_SESSION_TITLE } from '../local/localSessionRepository';
import {
  loadPersonalizationSettings,
  type PersonalizationSettings,
} from '../screens/personalizationSettings';
import type { ConversationRuntime, RuntimeEvent } from './conversationRuntime';
import { getLocalMemoryService, type LocalMemoryService } from '../memory';
import { assembleLocalRequestContext } from './localRequestContext';
import { createLocalProviderExecutor } from './localProviderExecution';
import { LocalAgentRunController } from './localAgentRunController';
import { consolidateLocalTurn, isCompletedTurn } from './localTurnConsolidation';
import type { ToolApprovalDecision, ToolGatewayClient } from '../tools/toolGatewayClient';

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

export interface LocalProviderRuntimeOptions {
  configStore?: ProviderConfigStore;
  credentialStore?: ProviderCredentialStore;
  sessionRepository?: LocalSessionRepository;
  clientFactory?: (config: LocalProviderConfig, apiKey: string) => OpenAiCompatibleClient;
  toolGateway?: ToolGatewayClient;
  loadPersonalization?: () => Promise<PersonalizationSettings>;
  memoryService?: LocalMemoryService;
}

/**
 * `ConversationRuntime` entry point for the Local Provider path.
 *
 * This class is deliberately a thin, stable facade: it resolves the
 * session / Provider / credential facts and then delegates each turn to four
 * explicit internal boundaries:
 *
 * - request context assembly (canonical history + Personalization + Local Memory)
 *   in `localRequestContext`;
 * - ordinary Provider execution in `localProviderExecution`;
 * - Local Agent run lifecycle (run token / approval / cancel / suspend) in
 *   `localAgentRunController`;
 * - completed-turn Memory consolidation in `localTurnConsolidation`.
 *
 * It owns only the shared Local facts (canonical storage, Provider / credential
 * resolution, session metadata) that all four boundaries depend on, so the
 * `ConversationRuntime` public contract and both execution paths stay
 * consistent.
 */
export class LocalProviderRuntime implements ConversationRuntime {
  readonly kind = 'local-provider' as const;
  readonly supportsAgent: boolean;
  private readonly configStore: ProviderConfigStore;
  private readonly credentialStore: ProviderCredentialStore;
  private readonly sessionRepository: LocalSessionRepository;
  private readonly clientFactory: (config: LocalProviderConfig, apiKey: string) => OpenAiCompatibleClient;
  private readonly loadPersonalization: () => Promise<PersonalizationSettings>;
  private readonly memoryService: LocalMemoryService;
  private readonly agentRun: LocalAgentRunController | null;

  constructor(options: LocalProviderRuntimeOptions = {}) {
    this.configStore = options.configStore ?? new ProviderConfigStore();
    this.credentialStore = options.credentialStore ?? providerCredentialStore;
    this.sessionRepository = options.sessionRepository ?? new LocalSessionRepository();
    this.clientFactory =
      options.clientFactory ?? ((config, apiKey) => new OpenAiCompatibleClient({ baseUrl: config.baseUrl, apiKey }));
    this.loadPersonalization = options.loadPersonalization ?? loadPersonalizationSettings;
    this.memoryService = options.memoryService ?? getLocalMemoryService();
    this.agentRun = options.toolGateway
      ? new LocalAgentRunController(options.toolGateway)
      : null;
    this.supportsAgent = Boolean(options.toolGateway);
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
    const session = await this.sessionRepository.get(sessionId);
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
    const executor = createLocalProviderExecutor(client, config);
    const request = await assembleLocalRequestContext(canonicalMessages, {
      loadPersonalization: this.loadPersonalization,
      memoryService: this.memoryService,
    });

    const useAgent = Boolean(options?.agentEnabled) && this.agentRun;
    const agentRunHandle = useAgent
      ? await this.agentRun!.beginRun({
          executor,
          initialMessages: request.messages,
        })
      : null;
    const stream = agentRunHandle
      ? agentRunHandle.stream
      : await executor.streamMessages(request.messages);

    const repository = this.sessionRepository;
    const assistantId = createMessageId();
    const threadId = sessionId;
    const canonicalUserMessageId = userMessage.id;
    const userText = input;
    const memoryService = this.memoryService;
    const agentRun = this.agentRun;
    const run = agentRunHandle;
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
        // canonical Assistant reply was just persisted. Detached and
        // best-effort: the reply is already durable, so the Chat stream / UI
        // must complete without waiting for the extra Provider call.
        if (
          isCompletedTurn({ content, sawError, paused, finished, finishReason })
        ) {
          consolidateLocalTurn(
            {
              threadId,
              userMessageId: canonicalUserMessageId,
              assistantMessageId: assistantId,
              userText,
              assistantText: content,
            },
            { service: memoryService, executor, config },
          ).catch(() => undefined);
        }
      } finally {
        if (agentRun && run) {
          agentRun.finishRun(run);
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
    this.agentRun?.resolveToolApproval(invocationId, decision);
  }

  cancelActiveRun() {
    this.agentRun?.cancelActiveRun();
  }

  setExecutionSuspended(suspended: boolean) {
    this.agentRun?.setExecutionSuspended(suspended);
  }
}
