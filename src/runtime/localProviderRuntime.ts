import type { ChatMessage, Session } from '../types';
import { OpenAiCompatibleClient } from '../provider/openAiCompatibleClient';
import {
  ProviderConfigStore,
  type LocalProviderConfig,
} from '../provider/providerConfigStore';
import {
  providerCredentialStore,
  type ProviderCredentialStore,
} from '../security/providerCredentialStore';
import { LocalSessionRepository } from '../local/localSessionRepository';
import {
  loadPersonalizationSettings,
  type PersonalizationSettings,
} from '../screens/personalizationSettings';
import type { ConversationRuntime, RuntimeEvent } from './conversationRuntime';
import { getLocalMemoryService, type LocalMemoryService } from '../memory';
import { assembleLocalRequestContext } from './localRequestContext';
import {
  createLocalProviderExecutor,
  LocalProviderExecutionController,
} from './localProviderExecution';
import { LocalAgentRunController } from './localAgentRunController';
import { executeLocalConversationTurn } from './localConversationExecution';
import type {
  ToolApprovalDecision,
  ToolGatewayClient,
} from '../tools/toolGatewayClient';

export interface LocalProviderRuntimeOptions {
  configStore?: ProviderConfigStore;
  credentialStore?: ProviderCredentialStore;
  sessionRepository?: LocalSessionRepository;
  clientFactory?: (
    config: LocalProviderConfig,
    apiKey: string,
  ) => OpenAiCompatibleClient;
  toolGateway?: ToolGatewayClient;
  loadPersonalization?: () => Promise<PersonalizationSettings>;
  memoryService?: LocalMemoryService;
}

/**
 * Stable ConversationRuntime facade for Local Provider.
 *
 * This class resolves Local session / Provider / credential facts and delegates
 * the actual turn to explicit internal owners:
 * - localRequestContext: Local-only request context;
 * - localProviderExecution: Provider IO + current execution cancellation;
 * - localConversationExecution: canonical user/Assistant turn lifecycle;
 * - localAgentRunController: Agent-specific token / approval / abort lifecycle;
 * - localTurnConsolidation: completed-turn Memory side effect.
 */
export class LocalProviderRuntime implements ConversationRuntime {
  readonly kind = 'local-provider' as const;
  readonly supportsAgent: boolean;

  private readonly configStore: ProviderConfigStore;
  private readonly credentialStore: ProviderCredentialStore;
  private readonly sessionRepository: LocalSessionRepository;
  private readonly clientFactory: (
    config: LocalProviderConfig,
    apiKey: string,
  ) => OpenAiCompatibleClient;
  private readonly loadPersonalization: () => Promise<PersonalizationSettings>;
  private readonly memoryService: LocalMemoryService;
  private readonly providerExecution = new LocalProviderExecutionController();
  private readonly agentRun: LocalAgentRunController | null;

  constructor(options: LocalProviderRuntimeOptions = {}) {
    this.configStore = options.configStore ?? new ProviderConfigStore();
    this.credentialStore =
      options.credentialStore ?? providerCredentialStore;
    this.sessionRepository =
      options.sessionRepository ?? new LocalSessionRepository();
    this.clientFactory =
      options.clientFactory ??
      ((config, apiKey) =>
        new OpenAiCompatibleClient({
          baseUrl: config.baseUrl,
          apiKey,
        }));
    this.loadPersonalization =
      options.loadPersonalization ?? loadPersonalizationSettings;
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
    return sessions
      .flat()
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  }

  async createSession(title?: string, providerId?: string): Promise<Session> {
    const configs = await this.configStore.load();
    const config = providerId
      ? configs.find((item) => item.id === providerId)
      : configs[0];
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
    if (!config) {
      throw new Error('Local Provider configuration was not found');
    }
    const apiKey = await this.credentialStore.load(config.id);
    if (!apiKey) {
      throw new Error('Local Provider API key is not configured');
    }

    const executor = createLocalProviderExecutor(
      this.clientFactory(config, apiKey),
      config,
    );

    return executeLocalConversationTurn(
      {
        session,
        input,
        messageId: options?.messageId,
        agentEnabled: options?.agentEnabled,
      },
      {
        repository: this.sessionRepository,
        executor,
        providerExecution: this.providerExecution,
        agentRun: this.agentRun,
        assembleRequest: (canonicalMessages) =>
          assembleLocalRequestContext(canonicalMessages, {
            loadPersonalization: this.loadPersonalization,
            memoryService: this.memoryService,
          }),
        memoryService: this.memoryService,
        config,
      },
    );
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
  ): void {
    this.agentRun?.resolveToolApproval(invocationId, decision);
  }

  cancelActiveRun(): void {
    // Abort Agent control flow first so a Provider abort is classified as an
    // intentional Agent cancellation rather than an ordinary stream failure.
    this.agentRun?.cancelActiveRun();
    this.providerExecution.cancelActiveRun();
  }

  setExecutionSuspended(suspended: boolean): void {
    // Set the shared suspension predicate before interrupting Agent approval /
    // control flow so MobileAgentLoop reports app-suspended, not cancelled.
    this.providerExecution.setExecutionSuspended(suspended);
    if (suspended) {
      this.agentRun?.interruptForSuspension();
    }
  }
}
