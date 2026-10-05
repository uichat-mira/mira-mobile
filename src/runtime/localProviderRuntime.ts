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
import {
  LocalProviderSessionRollbackIncompleteError,
  LocalProviderSessionSetChangedError,
  LocalSessionRepository,
} from '../local/localSessionRepository';
import {
  loadPersonalizationSettings,
  type PersonalizationSettings,
} from '../settings/personalizationSettings';
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
import {
  stageLocalSessionReferenceRemoval,
  type StagedLocalSessionReferenceRemoval,
} from '../session/localSessionReferenceCleanup';

export interface LocalProviderDeletionImpact {
  providerId: string;
  sessionCount: number;
}

export interface LocalProviderDeletionResult extends LocalProviderDeletionImpact {
  deletedSessionIds: string[];
}

export class LocalProviderDeletionScopeChangedError extends Error {
  readonly code = 'LOCAL_PROVIDER_DELETION_SCOPE_CHANGED';

  constructor(readonly actualSessionCount: number) {
    super('关联本地对话数量已变化，请重新确认删除范围。');
    this.name = 'LocalProviderDeletionScopeChangedError';
  }
}

export class LocalProviderDeletionRollbackIncompleteError extends Error {
  readonly code = 'LOCAL_PROVIDER_DELETION_ROLLBACK_INCOMPLETE';

  constructor(readonly originalError: unknown) {
    super('删除 Local Provider 失败，且本地回滚未完整完成；请重新打开设置检查当前状态。');
    this.name = 'LocalProviderDeletionRollbackIncompleteError';
  }
}

export type StageLocalSessionReferenceRemoval = (
  sessionIds: readonly string[],
) => Promise<StagedLocalSessionReferenceRemoval>;

interface ActiveProviderSend {
  providerId: string;
  cancelled: boolean;
  cancelProviderRun: (() => void) | null;
}

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
  stageSessionReferenceRemoval?: StageLocalSessionReferenceRemoval;
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
  private readonly stageSessionReferenceRemoval: StageLocalSessionReferenceRemoval;
  private readonly providerExecution = new LocalProviderExecutionController();
  private readonly agentRun: LocalAgentRunController | null;
  private readonly activeProviderMutations = new Map<string, number>();
  private readonly providerMutationWaiters = new Map<string, Set<() => void>>();
  private readonly deletingProviderIds = new Set<string>();
  private readonly activeProviderSends = new Set<ActiveProviderSend>();

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
    this.stageSessionReferenceRemoval =
      options.stageSessionReferenceRemoval ?? stageLocalSessionReferenceRemoval;
    this.agentRun = options.toolGateway
      ? new LocalAgentRunController(options.toolGateway)
      : null;
    this.supportsAgent = Boolean(options.toolGateway);
  }

  private acquireProviderMutation(providerId: string): () => void {
    const normalizedProviderId = providerId.trim();
    if (!normalizedProviderId) {
      throw new Error('Local Provider id is required');
    }
    if (this.deletingProviderIds.has(normalizedProviderId)) {
      throw new Error('当前 Provider 正在删除，请稍后重试。');
    }

    this.activeProviderMutations.set(
      normalizedProviderId,
      (this.activeProviderMutations.get(normalizedProviderId) ?? 0) + 1,
    );

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next =
        (this.activeProviderMutations.get(normalizedProviderId) ?? 1) - 1;
      if (next <= 0) {
        this.activeProviderMutations.delete(normalizedProviderId);
        const waiters = this.providerMutationWaiters.get(normalizedProviderId);
        this.providerMutationWaiters.delete(normalizedProviderId);
        waiters?.forEach((resolve) => resolve());
      } else {
        this.activeProviderMutations.set(normalizedProviderId, next);
      }
    };
  }

  private waitForProviderMutations(providerId: string): Promise<void> {
    if ((this.activeProviderMutations.get(providerId) ?? 0) === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const waiters =
        this.providerMutationWaiters.get(providerId) ?? new Set<() => void>();
      waiters.add(resolve);
      this.providerMutationWaiters.set(providerId, waiters);
    });
  }

  private hasActiveProviderSend(providerId: string): boolean {
    return [...this.activeProviderSends].some(
      (send) => send.providerId === providerId,
    );
  }

  private beginProviderSend(providerId: string): ActiveProviderSend {
    const normalizedProviderId = providerId.trim();
    if (!normalizedProviderId) {
      throw new Error('Local Provider id is required');
    }
    if (this.deletingProviderIds.has(normalizedProviderId)) {
      throw new Error('当前 Provider 正在删除，请稍后重试。');
    }

    const send: ActiveProviderSend = {
      providerId: normalizedProviderId,
      cancelled: false,
      cancelProviderRun: null,
    };
    this.activeProviderSends.add(send);
    return send;
  }

  private finishProviderSend(send: ActiveProviderSend): void {
    this.activeProviderSends.delete(send);
  }

  private cancelTrackedProviderSends(): void {
    for (const send of this.activeProviderSends) {
      send.cancelled = true;
      send.cancelProviderRun?.();
    }
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

    const release = this.acquireProviderMutation(config.id);
    try {
      return await this.sessionRepository.create(config.id, title);
    } finally {
      release();
    }
  }

  async getProviderDeletionImpact(providerId: string): Promise<LocalProviderDeletionImpact> {
    const normalizedProviderId = providerId.trim();
    if (!normalizedProviderId) throw new Error('Local Provider id is required');
    const sessions = await this.sessionRepository.list(normalizedProviderId);
    return { providerId: normalizedProviderId, sessionCount: sessions.length };
  }

  async deleteProvider(
    providerId: string,
    expectedSessionCount?: number,
  ): Promise<LocalProviderDeletionResult> {
    const normalizedProviderId = providerId.trim();
    if (!normalizedProviderId) throw new Error('Local Provider id is required');
    if (this.deletingProviderIds.has(normalizedProviderId)) {
      throw new Error('当前 Provider 正在删除，请稍后重试。');
    }
    if (this.hasActiveProviderSend(normalizedProviderId)) {
      throw new Error('当前 Provider 正在执行本地请求，请先结束当前对话后再删除。');
    }

    this.deletingProviderIds.add(normalizedProviderId);
    let configToRestore: LocalProviderConfig | null = null;
    let credentialToRestore: string | null = null;
    let stagedSessionReferences: StagedLocalSessionReferenceRemoval | null = null;
    let credentialCleared = false;
    let configRemoved = false;

    try {
      await this.waitForProviderMutations(normalizedProviderId);
      const configs = await this.configStore.load();
      configToRestore =
        configs.find((item) => item.id === normalizedProviderId) ?? null;

      const sessions = await this.sessionRepository.list(normalizedProviderId);
      if (
        expectedSessionCount !== undefined &&
        sessions.length !== expectedSessionCount
      ) {
        throw new LocalProviderDeletionScopeChangedError(sessions.length);
      }

      credentialToRestore =
        await this.credentialStore.load(normalizedProviderId);
      const sessionIds = sessions.map((session) => session.id);
      stagedSessionReferences =
        await this.stageSessionReferenceRemoval(sessionIds);

      await this.credentialStore.clear(normalizedProviderId);
      credentialCleared = true;

      if (configToRestore) {
        await this.configStore.remove(normalizedProviderId);
        configRemoved = true;
      }

      const deletedSessionIds =
        await this.sessionRepository.deleteByProvider(
          normalizedProviderId,
          sessionIds,
        );
      stagedSessionReferences.commit();

      return {
        providerId: normalizedProviderId,
        sessionCount: deletedSessionIds.length,
        deletedSessionIds,
      };
    } catch (error) {
      const rollback: Promise<unknown>[] = [];
      if (configRemoved && configToRestore) {
        rollback.push(this.configStore.upsert(configToRestore));
      }
      if (credentialCleared && credentialToRestore) {
        rollback.push(
          this.credentialStore.save(normalizedProviderId, credentialToRestore),
        );
      }
      if (stagedSessionReferences) {
        rollback.push(stagedSessionReferences.rollback());
      }

      const rollbackResults = await Promise.allSettled(rollback);
      let rollbackComplete =
        !rollbackResults.some((result) => result.status === 'rejected');

      if (rollbackComplete && configRemoved && configToRestore) {
        const restoredConfig = (await this.configStore.load())
          .find((item) => item.id === normalizedProviderId);
        rollbackComplete =
          JSON.stringify(restoredConfig) === JSON.stringify(configToRestore);
      }
      if (rollbackComplete && credentialCleared) {
        const restoredCredential =
          await this.credentialStore.load(normalizedProviderId);
        rollbackComplete = restoredCredential === credentialToRestore;
      }

      if (
        !rollbackComplete ||
        error instanceof LocalProviderSessionRollbackIncompleteError
      ) {
        throw new LocalProviderDeletionRollbackIncompleteError(error);
      }
      if (error instanceof LocalProviderSessionSetChangedError) {
        throw new LocalProviderDeletionScopeChangedError(
          error.actualSessionIds.length,
        );
      }
      throw error;
    } finally {
      this.deletingProviderIds.delete(normalizedProviderId);
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const providerId = await this.sessionRepository.getProviderId(sessionId);
    const release = this.acquireProviderMutation(providerId);
    try {
      await this.sessionRepository.delete(sessionId);
    } finally {
      release();
    }
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
    const providerId = await this.sessionRepository.getProviderId(sessionId);
    if (this.deletingProviderIds.has(providerId)) {
      throw new Error('当前 Provider 正在删除，请稍后重试。');
    }
    const runtime = this;

    return (async function* () {
      const activeSend = runtime.beginProviderSend(providerId);

      try {
        const configs = await runtime.configStore.load();
        if (activeSend.cancelled) {
          throw new Error('Local Provider request was cancelled');
        }
        const config = configs.find((item) => item.id === providerId);
        if (!config) {
          throw new Error('Local Provider configuration was not found');
        }

        const session = await runtime.sessionRepository.get(sessionId);
        const currentProviderId =
          await runtime.sessionRepository.getProviderId(sessionId);
        if (currentProviderId !== providerId) {
          throw new Error('Local Provider session ownership changed');
        }
        if (activeSend.cancelled) {
          throw new Error('Local Provider request was cancelled');
        }

        const apiKey = await runtime.credentialStore.load(config.id);
        if (!apiKey) {
          throw new Error('Local Provider API key is not configured');
        }
        if (activeSend.cancelled) {
          throw new Error('Local Provider request was cancelled');
        }

        const executor = createLocalProviderExecutor(
          runtime.clientFactory(config, apiKey),
          config,
        );
        activeSend.cancelProviderRun = () => executor.client.cancelActiveRun();
        if (activeSend.cancelled) {
          activeSend.cancelProviderRun();
          throw new Error('Local Provider request was cancelled');
        }

        const stream = await executeLocalConversationTurn(
          {
            session,
            input,
            messageId: options?.messageId,
            agentEnabled: options?.agentEnabled,
          },
          {
            repository: runtime.sessionRepository,
            executor,
            providerExecution: runtime.providerExecution,
            agentRun: runtime.agentRun,
            assembleRequest: (canonicalMessages) =>
              assembleLocalRequestContext(canonicalMessages, {
                loadPersonalization: runtime.loadPersonalization,
                memoryService: runtime.memoryService,
              }),
            memoryService: runtime.memoryService,
            config,
          },
        );

        for await (const event of stream) {
          yield event;
        }
      } finally {
        runtime.finishProviderSend(activeSend);
      }
    })();
  }

  getAgentEnabled(sessionId: string): Promise<boolean> {
    return this.sessionRepository.getAgentEnabled(sessionId);
  }

  async setAgentEnabled(sessionId: string, enabled: boolean): Promise<void> {
    const providerId = await this.sessionRepository.getProviderId(sessionId);
    const release = this.acquireProviderMutation(providerId);
    try {
      await this.sessionRepository.setAgentEnabled(sessionId, enabled);
    } finally {
      release();
    }
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
    this.cancelTrackedProviderSends();
  }

  setExecutionSuspended(suspended: boolean): void {
    // Set the shared suspension predicate before interrupting Agent approval /
    // control flow so MobileAgentLoop reports app-suspended, not cancelled.
    this.providerExecution.setExecutionSuspended(suspended);
    if (suspended) {
      this.agentRun?.interruptForSuspension();
      this.cancelTrackedProviderSends();
    }
  }
}
