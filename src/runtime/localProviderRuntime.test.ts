import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import {
  LocalProviderSessionRollbackIncompleteError,
  LocalSessionRepository,
} from '../local/localSessionRepository';
import { ProviderConfigStore, type LocalProviderConfig } from '../provider/providerConfigStore';
import type { OpenAiCompatibleClient } from '../provider/openAiCompatibleClient';
import { MemoryProviderCredentialStore } from '../security/providerCredentialStore';
import {
  DEFAULT_PERSONALIZATION_SETTINGS,
  type PersonalizationSettings,
} from '../settings/personalizationSettings';
import { LocalProviderRuntime } from './localProviderRuntime';

const config: LocalProviderConfig = {
  id: 'provider-a',
  name: 'Provider A',
  baseUrl: 'https://provider.example.com',
  model: 'model-a',
  protocol: 'chat-completions',
};

const storedConfig = (value: LocalProviderConfig): LocalProviderConfig => ({
  ...value,
  compatibility: value.compatibility ?? { reasoningTags: 'strip' },
});

const createSendReadyRuntime = async () => {
  const configStore = new ProviderConfigStore(new MemoryLocalKeyValueStore());
  await configStore.save([config]);
  const credentialStore = new MemoryProviderCredentialStore();
  await credentialStore.save(config.id, 'sk-test');
  const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());
  const runtime = new LocalProviderRuntime({
    configStore,
    credentialStore,
    sessionRepository: repository,
    clientFactory: () => ({
      cancelActiveRun: jest.fn(),
      streamChat: jest.fn(async () => (async function* () {})()),
    } as unknown as OpenAiCompatibleClient),
  });
  return { runtime, repository };
};

describe('LocalProviderRuntime', () => {
  it('persists Agent mode on the local session', async () => {
    const configStore = new ProviderConfigStore(new MemoryLocalKeyValueStore());
    await configStore.save([config]);
    const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());
    const runtime = new LocalProviderRuntime({
      configStore,
      credentialStore: new MemoryProviderCredentialStore(),
      sessionRepository: repository,
      toolGateway: {
        listTools: async () => [],
        callTool: async () => ({ content: 'unused' }),
      },
    });
    const session = await runtime.createSession('Agent session', 'provider-a');

    await expect(runtime.getAgentEnabled(session.id)).resolves.toBe(false);
    await runtime.setAgentEnabled(session.id, true);

    await expect(runtime.getAgentEnabled(session.id)).resolves.toBe(true);
    await expect(runtime.listSessions()).resolves.toEqual([
      expect.objectContaining({
        id: session.id,
        agentEnabled: true,
      }),
    ]);
  });

  it('cancels the previous Provider client before replacing a local Agent run', async () => {
    const configStore = new ProviderConfigStore(new MemoryLocalKeyValueStore());
    await configStore.save([config]);
    const credentialStore = new MemoryProviderCredentialStore();
    await credentialStore.save(config.id, 'sk-test');
    const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());
    const makeClient = () => ({
      cancelActiveRun: jest.fn(),
      streamChat: jest.fn(async () => (async function* () {
        yield { type: 'finish', reason: 'stop' as const };
      })()),
    });
    const firstClient = makeClient();
    const secondClient = makeClient();
    const clients = [firstClient, secondClient];
    const runtime = new LocalProviderRuntime({
      configStore,
      credentialStore,
      sessionRepository: repository,
      clientFactory: () => clients.shift() as never,
      toolGateway: {
        listTools: async () => [],
        callTool: async () => ({ content: 'unused' }),
      },
    });
    const firstSession = await runtime.createSession('First', config.id);
    const secondSession = await runtime.createSession('Second', config.id);

    const firstStream = await runtime.sendMessage(
      firstSession.id,
      'first',
      { agentEnabled: true },
    );
    const firstIterator = firstStream[Symbol.asyncIterator]();
    await expect(firstIterator.next()).resolves.toMatchObject({ done: false });

    const secondStream = await runtime.sendMessage(
      secondSession.id,
      'second',
      { agentEnabled: true },
    );
    const secondIterator = secondStream[Symbol.asyncIterator]();
    await expect(secondIterator.next()).resolves.toMatchObject({ done: false });

    expect(firstClient.cancelActiveRun).toHaveBeenCalledTimes(1);
    expect(secondClient.cancelActiveRun).not.toHaveBeenCalled();

    await firstIterator.return?.();
    await secondIterator.return?.();
  });

  it('derives the session title from the first non-empty user message', async () => {
    const { runtime } = await createSendReadyRuntime();
    const session = await runtime.createSession(undefined, config.id);

    await drain(await runtime.sendMessage(session.id, '   '));
    await expect(runtime.getSession(session.id)).resolves.toMatchObject({
      title: 'New local conversation',
    });

    await drain(await runtime.sendMessage(session.id, '  帮我写一个\n快速排序算法，并解释复杂度  '));

    await expect(runtime.getSession(session.id)).resolves.toMatchObject({
      title: '帮我写一个 快速排序算法，并解释复杂度',
    });
  });

  it('caps the derived session title at thirty characters', async () => {
    const { runtime } = await createSendReadyRuntime();
    const session = await runtime.createSession(undefined, config.id);

    await drain(await runtime.sendMessage(session.id, `${'a'.repeat(40)}\n${'b'.repeat(20)}`));

    await expect(runtime.getSession(session.id)).resolves.toMatchObject({
      title: `${'a'.repeat(30)}…`,
    });
  });

  it('keeps a custom session title when the first message arrives', async () => {
    const { runtime } = await createSendReadyRuntime();
    const session = await runtime.createSession('Custom title', config.id);

    await drain(await runtime.sendMessage(session.id, 'hello'));

    await expect(runtime.getSession(session.id)).resolves.toMatchObject({
      title: 'Custom title',
    });
  });

  it('creates a session for the selected provider', async () => {
    const configStore = new ProviderConfigStore(new MemoryLocalKeyValueStore());
    await configStore.save([config, { ...config, id: 'provider-b', name: 'Provider B' }]);
    const runtime = new LocalProviderRuntime({
      configStore,
      credentialStore: new MemoryProviderCredentialStore(),
      sessionRepository: new LocalSessionRepository(new MemoryLocalKeyValueStore()),
    });

    const session = await runtime.createSession('Selected', 'provider-b');

    await expect(runtime.listSessions()).resolves.toEqual([
      expect.objectContaining({ id: session.id, providerName: 'Provider B', providerModel: 'model-a' }),
    ]);
  });
});


describe('LocalProviderRuntime send preflight', () => {
  it('rejects a missing API key before returning a stream', async () => {
    const configStore = new ProviderConfigStore(new MemoryLocalKeyValueStore());
    await configStore.save([config]);
    const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());
    const runtime = new LocalProviderRuntime({
      configStore,
      credentialStore: new MemoryProviderCredentialStore(),
      sessionRepository: repository,
    });
    const session = await runtime.createSession('Missing key', config.id);

    await expect(runtime.sendMessage(session.id, 'hello')).rejects.toThrow(
      'Local Provider API key is not configured',
    );
    await expect(repository.getMessages(session.id)).resolves.toEqual([]);
  });

  it('rejects a missing Provider before returning a stream', async () => {
    const configStore = new ProviderConfigStore(new MemoryLocalKeyValueStore());
    const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());
    const credentialStore = new MemoryProviderCredentialStore();
    await credentialStore.save(config.id, 'key-a');
    const session = await repository.create(config.id, 'Missing provider');
    const runtime = new LocalProviderRuntime({
      configStore,
      credentialStore,
      sessionRepository: repository,
    });

    await expect(runtime.sendMessage(session.id, 'hello')).rejects.toMatchObject({
      code: 'LOCAL_PROVIDER_SEND_UNAVAILABLE',
      reason: 'provider-missing',
    });
    await expect(repository.getMessages(session.id)).resolves.toEqual([]);
  });
});

describe('LocalProviderRuntime Provider deletion', () => {
  const otherConfig: LocalProviderConfig = {
    ...config,
    id: 'provider-b',
    name: 'Provider B',
    model: 'model-b',
  };

  const createDeletionRuntime = async (
    stageSessionReferenceRemoval = jest.fn(async () => ({
      commit: jest.fn(),
      rollback: jest.fn(async () => undefined),
    })),
  ) => {
    const configStore = new ProviderConfigStore(new MemoryLocalKeyValueStore());
    await configStore.save([config, otherConfig]);
    const credentialStore = new MemoryProviderCredentialStore();
    await credentialStore.save(config.id, 'key-a');
    await credentialStore.save(otherConfig.id, 'key-b');
    const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());
    const runtime = new LocalProviderRuntime({
      configStore,
      credentialStore,
      sessionRepository: repository,
      stageSessionReferenceRemoval,
      clientFactory: () => ({
        cancelActiveRun: jest.fn(),
        streamChat: jest.fn(async () => (async function* () {
          yield { type: 'finish', reason: 'stop' as const };
        })()),
      } as unknown as OpenAiCompatibleClient),
    });
    return {
      runtime,
      configStore,
      credentialStore,
      repository,
      stageSessionReferenceRemoval,
    };
  };

  it('deletes only the selected Provider, its credential, and its owned sessions', async () => {
    const {
      runtime,
      configStore,
      credentialStore,
      repository,
      stageSessionReferenceRemoval,
    } = await createDeletionRuntime();
    const first = await runtime.createSession('A1', config.id);
    const second = await runtime.createSession('A2', config.id);
    const other = await runtime.createSession('B1', otherConfig.id);

    await expect(runtime.getProviderDeletionImpact(config.id)).resolves.toEqual({
      providerId: config.id,
      sessionCount: 2,
    });

    await expect(runtime.deleteProvider(config.id, 2)).resolves.toEqual({
      providerId: config.id,
      sessionCount: 2,
      deletedSessionIds: [second.id, first.id],
    });
    expect(stageSessionReferenceRemoval).toHaveBeenCalledWith([
      second.id,
      first.id,
    ]);

    await expect(configStore.load()).resolves.toEqual([storedConfig(otherConfig)]);
    await expect(credentialStore.load(config.id)).resolves.toBeNull();
    await expect(credentialStore.load(otherConfig.id)).resolves.toBe('key-b');
    await expect(repository.list(config.id)).resolves.toEqual([]);
    await expect(repository.list(otherConfig.id)).resolves.toMatchObject([
      { id: other.id, title: 'B1' },
    ]);
    await expect(runtime.listSessions()).resolves.toMatchObject([
      {
        id: other.id,
        providerName: 'Provider B',
        providerModel: 'model-b',
      },
    ]);
  });

  it('matches Provider ownership by exact id without folding case or whitespace', async () => {
    const { runtime, repository } = await createDeletionRuntime();
    const exact = await runtime.createSession('Exact', config.id);
    const caseVariant = await repository.create('Provider-A', 'Case variant');
    const whitespaceVariant = await repository.create(
      'provider-a ',
      'Whitespace variant',
    );

    await expect(runtime.getProviderDeletionImpact(config.id)).resolves.toEqual({
      providerId: config.id,
      sessionCount: 1,
    });

    await expect(runtime.deleteProvider(config.id, 1)).resolves.toMatchObject({
      providerId: config.id,
      sessionCount: 1,
      deletedSessionIds: [exact.id],
    });

    await expect(repository.get(exact.id)).rejects.toThrow('not found');
    await expect(repository.get(caseVariant.id)).resolves.toBeDefined();
    await expect(repository.get(whitespaceVariant.id)).resolves.toBeDefined();
  });

  it('keeps deletion reservation scoped to the exact Provider id', async () => {
    const { runtime, configStore, credentialStore } =
      await createDeletionRuntime();
    const whitespaceConfig: LocalProviderConfig = {
      ...config,
      id: 'provider-a ',
      name: 'Whitespace Provider',
    };
    await configStore.upsert(whitespaceConfig);
    await credentialStore.save(whitespaceConfig.id, 'key-space');
    const whitespaceSession = await runtime.createSession(
      'Whitespace session',
      whitespaceConfig.id,
    );

    let releaseClear!: () => void;
    let signalClearStarted!: () => void;
    const clearGate = new Promise<void>((resolve) => {
      releaseClear = resolve;
    });
    const clearStarted = new Promise<void>((resolve) => {
      signalClearStarted = resolve;
    });
    const clearCredential = credentialStore.clear.bind(credentialStore);
    jest.spyOn(credentialStore, 'clear').mockImplementationOnce(
      async (providerId) => {
        signalClearStarted();
        await clearGate;
        await clearCredential(providerId);
      },
    );

    const deletion = runtime.deleteProvider(config.id, 0);
    await clearStarted;

    await expect(
      runtime.sendMessage(whitespaceSession.id, 'still valid'),
    ).resolves.toBeDefined();
    await expect(
      runtime.createSession('Another whitespace session', whitespaceConfig.id),
    ).resolves.toBeDefined();

    releaseClear();
    await expect(deletion).resolves.toMatchObject({
      providerId: config.id,
      sessionCount: 0,
    });
  });

  it('deletes a Provider with zero conversations without touching another Provider', async () => {
    const { runtime, configStore, credentialStore, repository } =
      await createDeletionRuntime();
    const other = await runtime.createSession('B1', otherConfig.id);

    await expect(runtime.deleteProvider(config.id, 0)).resolves.toEqual({
      providerId: config.id,
      sessionCount: 0,
      deletedSessionIds: [],
    });

    await expect(configStore.load()).resolves.toEqual([storedConfig(otherConfig)]);
    await expect(credentialStore.load(config.id)).resolves.toBeNull();
    await expect(credentialStore.load(otherConfig.id)).resolves.toBe('key-b');
    await expect(repository.list()).resolves.toMatchObject([
      { id: other.id, title: 'B1' },
    ]);
  });

  it('requires reconfirmation when the owned conversation count changed', async () => {
    const { runtime, configStore, credentialStore, repository } =
      await createDeletionRuntime();
    await runtime.createSession('A1', config.id);
    const impact = await runtime.getProviderDeletionImpact(config.id);
    await runtime.createSession('A2', config.id);

    await expect(
      runtime.deleteProvider(config.id, impact.sessionCount),
    ).rejects.toMatchObject({
      code: 'LOCAL_PROVIDER_DELETION_SCOPE_CHANGED',
      actualSessionCount: 2,
    });

    await expect(configStore.load()).resolves.toEqual([storedConfig(config), storedConfig(otherConfig)]);
    await expect(credentialStore.load(config.id)).resolves.toBe('key-a');
    await expect(repository.list(config.id)).resolves.toHaveLength(2);
  });

  it('does not mutate Provider data when reference staging fails', async () => {
    const stageSessionReferenceRemoval = jest.fn(async () => {
      throw new Error('reference cleanup failed');
    });
    const { runtime, configStore, credentialStore, repository } =
      await createDeletionRuntime(stageSessionReferenceRemoval);
    const session = await runtime.createSession('Keep me', config.id);

    await expect(runtime.deleteProvider(config.id, 1)).rejects.toThrow(
      'reference cleanup failed',
    );

    await expect(configStore.load()).resolves.toEqual([
      storedConfig(config),
      storedConfig(otherConfig),
    ]);
    await expect(credentialStore.load(config.id)).resolves.toBe('key-a');
    await expect(repository.get(session.id)).resolves.toBeDefined();
  });

  it('restores staged references when the canonical session cascade fails', async () => {
    const rollbackReferences = jest.fn(async () => undefined);
    const commitReferences = jest.fn();
    const stageSessionReferenceRemoval = jest.fn(async () => ({
      commit: commitReferences,
      rollback: rollbackReferences,
    }));
    const { runtime, configStore, credentialStore, repository } =
      await createDeletionRuntime(stageSessionReferenceRemoval);
    const session = await runtime.createSession('Keep me', config.id);
    jest.spyOn(repository, 'deleteByProvider').mockRejectedValueOnce(
      new Error('session persistence failed'),
    );

    await expect(runtime.deleteProvider(config.id, 1)).rejects.toThrow(
      'session persistence failed',
    );

    expect(stageSessionReferenceRemoval).toHaveBeenCalledWith([session.id]);
    expect(rollbackReferences).toHaveBeenCalledTimes(1);
    expect(commitReferences).not.toHaveBeenCalled();
    await expect(configStore.load()).resolves.toEqual([
      storedConfig(otherConfig),
      storedConfig(config),
    ]);
    await expect(credentialStore.load(config.id)).resolves.toBe('key-a');
    await expect(repository.get(session.id)).resolves.toBeDefined();
  });

  it('keeps staged references removed when canonical session rollback is incomplete', async () => {
    const rollbackReferences = jest.fn(async () => undefined);
    const commitReferences = jest.fn();
    const stageSessionReferenceRemoval = jest.fn(async () => ({
      commit: commitReferences,
      rollback: rollbackReferences,
    }));
    const { runtime, configStore, credentialStore, repository } =
      await createDeletionRuntime(stageSessionReferenceRemoval);
    const session = await runtime.createSession('Partial canonical rollback', config.id);
    jest.spyOn(repository, 'deleteByProvider').mockRejectedValueOnce(
      new LocalProviderSessionRollbackIncompleteError(
        new Error('canonical restore failed'),
      ),
    );

    await expect(runtime.deleteProvider(config.id, 1)).rejects.toMatchObject({
      code: 'LOCAL_PROVIDER_DELETION_ROLLBACK_INCOMPLETE',
      reason: 'canonical-sessions',
    });

    expect(stageSessionReferenceRemoval).toHaveBeenCalledWith([session.id]);
    expect(commitReferences).toHaveBeenCalledTimes(1);
    expect(rollbackReferences).not.toHaveBeenCalled();
    await expect(configStore.load()).resolves.toContainEqual(storedConfig(config));
    await expect(credentialStore.load(config.id)).resolves.toBe('key-a');
  });

  it('escalates canonical rollback failure when credential restoration also fails', async () => {
    const stageSessionReferenceRemoval = jest.fn(async () => ({
      commit: jest.fn(),
      rollback: jest.fn(async () => undefined),
    }));
    const { runtime, credentialStore, repository } =
      await createDeletionRuntime(stageSessionReferenceRemoval);
    await runtime.createSession('Credential rollback failure', config.id);
    jest.spyOn(repository, 'deleteByProvider').mockRejectedValueOnce(
      new LocalProviderSessionRollbackIncompleteError(
        new Error('canonical restore failed'),
      ),
    );
    jest.spyOn(credentialStore, 'save').mockRejectedValueOnce(
      new Error('credential restore failed'),
    );

    await expect(runtime.deleteProvider(config.id, 1)).rejects.toMatchObject({
      code: 'LOCAL_PROVIDER_DELETION_ROLLBACK_INCOMPLETE',
      reason: 'rollback',
    });
    await expect(credentialStore.load(config.id)).resolves.toBeNull();
  });

  it('cancels every unconsumed send for the Provider before cascade deletion', async () => {
    const { runtime, repository } = await createDeletionRuntime();
    const first = await runtime.createSession('Pending first', config.id);
    const second = await runtime.createSession('Pending second', config.id);
    const firstStream = await runtime.sendMessage(first.id, 'first');
    const secondStream = await runtime.sendMessage(second.id, 'second');

    await expect(runtime.deleteProvider(config.id, 2)).resolves.toMatchObject({
      providerId: config.id,
      sessionCount: 2,
    });

    await expect(
      firstStream[Symbol.asyncIterator]().next(),
    ).rejects.toThrow('Local Provider request was cancelled');
    await expect(
      secondStream[Symbol.asyncIterator]().next(),
    ).rejects.toThrow('Local Provider request was cancelled');
    await expect(repository.list(config.id)).resolves.toEqual([]);
  });

  it('cancels a lazy send before its first iterator step without writing messages', async () => {
    const { runtime, repository } = await createDeletionRuntime();
    const session = await runtime.createSession('Cancel before start', config.id);
    const stream = await runtime.sendMessage(session.id, 'hello');

    runtime.cancelActiveRun();

    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow(
      'Local Provider request was cancelled',
    );
    await expect(repository.getMessages(session.id)).resolves.toEqual([]);
  });

  it('suppresses a lazy send when the app suspends before first iteration', async () => {
    const { runtime, repository } = await createDeletionRuntime();
    const session = await runtime.createSession('Suspend before start', config.id);
    const stream = await runtime.sendMessage(session.id, 'hello');

    runtime.setExecutionSuspended(true);

    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow(
      'Local Provider request was cancelled',
    );
    await expect(repository.getMessages(session.id)).resolves.toEqual([]);

    runtime.setExecutionSuspended(false);
  });

  it('does not acquire a Provider lease for an unconsumed send stream', async () => {
    const { runtime, repository } = await createDeletionRuntime();
    const session = await runtime.createSession('Never started', config.id);

    await runtime.sendMessage(session.id, 'hello');

    await expect(runtime.deleteProvider(config.id, 1)).resolves.toMatchObject({
      providerId: config.id,
      sessionCount: 1,
    });
    await expect(repository.get(session.id)).rejects.toThrow('not found');
  });

  it('stops an active send before cascading Provider deletion', async () => {
    const { runtime, repository } = await createDeletionRuntime();
    const session = await runtime.createSession('Running', config.id);
    const stream = await runtime.sendMessage(session.id, 'hello');
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ done: false });

    await expect(runtime.deleteProvider(config.id, 1)).resolves.toMatchObject({
      providerId: config.id,
      sessionCount: 1,
    });
    await expect(repository.get(session.id)).rejects.toThrow('not found');
  });

  it('keeps ordinary cancel current-only while Provider deletion stops all remaining sends', async () => {
    const { runtime, repository } = await createDeletionRuntime();
    const firstSession = await runtime.createSession('First active', config.id);
    const secondSession = await runtime.createSession('Second active', config.id);
    const firstStream = await runtime.sendMessage(firstSession.id, 'first');
    const secondStream = await runtime.sendMessage(secondSession.id, 'second');
    const firstIterator = firstStream[Symbol.asyncIterator]();
    const secondIterator = secondStream[Symbol.asyncIterator]();

    await expect(firstIterator.next()).resolves.toMatchObject({ done: false });
    await expect(secondIterator.next()).resolves.toMatchObject({ done: false });

    runtime.cancelActiveRun();

    await expect(firstIterator.next()).resolves.toMatchObject({ done: true });

    await expect(runtime.deleteProvider(config.id, 2)).resolves.toMatchObject({
      providerId: config.id,
      sessionCount: 2,
    });
    await expect(repository.list(config.id)).resolves.toEqual([]);
  });

  it('rejects the cascade when the frozen session id set changes at the same count', async () => {
    const stageSessionReferenceRemoval = jest.fn(async () => ({
      commit: jest.fn(),
      rollback: jest.fn(async () => undefined),
    }));
    const {
      runtime,
      configStore,
      credentialStore,
      repository,
    } = await createDeletionRuntime(stageSessionReferenceRemoval);
    const first = await runtime.createSession('A1', config.id);
    const second = await runtime.createSession('A2', config.id);

    stageSessionReferenceRemoval.mockImplementationOnce(async () => {
      await repository.delete(first.id);
      await repository.create('provider-a', 'A3');
      return {
        commit: jest.fn(),
        rollback: jest.fn(async () => undefined),
      };
    });

    await expect(runtime.deleteProvider(config.id, 2)).rejects.toMatchObject({
      code: 'LOCAL_PROVIDER_DELETION_SCOPE_CHANGED',
      actualSessionCount: 2,
    });

    await expect(configStore.load()).resolves.toEqual([
      storedConfig(otherConfig),
      storedConfig(config),
    ]);
    await expect(credentialStore.load(config.id)).resolves.toBe('key-a');
    await expect(repository.list(config.id)).resolves.toHaveLength(2);
    await expect(repository.get(second.id)).resolves.toBeDefined();
  });

  it('accepts a semantically restored Provider config regardless of object key order', async () => {
    const { runtime, configStore, repository } = await createDeletionRuntime();
    await runtime.createSession('Keep me', config.id);
    jest.spyOn(repository, 'deleteByProvider').mockRejectedValueOnce(
      new Error('session persistence failed'),
    );
    const originalUpsert = configStore.upsert.bind(configStore);
    jest.spyOn(configStore, 'upsert').mockImplementationOnce(async (value) => {
      const reordered: LocalProviderConfig = {
        protocol: value.protocol,
        model: value.model,
        baseUrl: value.baseUrl,
        name: value.name,
        id: value.id,
        compatibility: value.compatibility,
        ...(value.toolGatewayId ? { toolGatewayId: value.toolGatewayId } : {}),
      };
      await originalUpsert(reordered);
    });

    await expect(runtime.deleteProvider(config.id, 1)).rejects.toThrow(
      'session persistence failed',
    );
    await expect(configStore.load()).resolves.toContainEqual(storedConfig(config));
  });

  it('detects a config rollback that resolves without restoring persisted state', async () => {
    const { runtime, configStore, repository } = await createDeletionRuntime();
    await runtime.createSession('Keep me', config.id);
    jest.spyOn(repository, 'deleteByProvider').mockRejectedValueOnce(
      new Error('session persistence failed'),
    );
    jest.spyOn(configStore, 'upsert').mockResolvedValueOnce(undefined);

    await expect(runtime.deleteProvider(config.id, 1)).rejects.toMatchObject({
      code: 'LOCAL_PROVIDER_DELETION_ROLLBACK_INCOMPLETE',
      originalError: expect.any(Error),
    });

    await expect(
      configStore.load(),
    ).resolves.toEqual([storedConfig(otherConfig)]);
  });

  it('waits for a paused send to unwind before cascading deletion', async () => {
    const { runtime, configStore, repository } = await createDeletionRuntime();
    const session = await runtime.createSession('Paused send', config.id);
    const originalLoad = configStore.load.bind(configStore);
    let releaseLoad!: () => void;
    let signalLoadStarted!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const loadStarted = new Promise<void>((resolve) => {
      signalLoadStarted = resolve;
    });
    const stream = await runtime.sendMessage(session.id, 'hello');
    jest.spyOn(configStore, 'load').mockImplementationOnce(async () => {
      signalLoadStarted();
      await loadGate;
      return originalLoad();
    });
    const iterator = stream[Symbol.asyncIterator]();
    const firstEvent = iterator.next();
    await loadStarted;

    const deletion = runtime.deleteProvider(config.id, 1);
    await expect(repository.getMessages(session.id)).resolves.toEqual([]);

    releaseLoad();
    await expect(firstEvent).rejects.toThrow('cancelled');
    await expect(deletion).resolves.toMatchObject({
      providerId: config.id,
      sessionCount: 1,
    });
  });

  it('keeps an unconsumed stream inert after its Provider is deleted', async () => {
    const { runtime, repository } = await createDeletionRuntime();
    const session = await runtime.createSession('Never started', config.id);
    const stream = await runtime.sendMessage(session.id, 'hello');

    await expect(runtime.deleteProvider(config.id, 1)).resolves.toMatchObject({
      providerId: config.id,
      sessionCount: 1,
    });

    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow(
      'Local Provider request was cancelled',
    );
    await expect(repository.list(config.id)).resolves.toEqual([]);
  });

  it('lets Provider deletion win if a single-session delete has not acquired its mutation lease yet', async () => {
    const { runtime, repository } = await createDeletionRuntime();
    const first = await runtime.createSession('Delete first', config.id);
    await runtime.createSession('Cascade second', config.id);
    const originalGetProviderId = repository.getProviderId.bind(repository);
    let releaseProviderId!: () => void;
    let signalProviderIdResolved!: () => void;
    const providerIdGate = new Promise<void>((resolve) => {
      releaseProviderId = resolve;
    });
    const providerIdResolved = new Promise<void>((resolve) => {
      signalProviderIdResolved = resolve;
    });
    jest.spyOn(repository, 'getProviderId').mockImplementationOnce(
      async (sessionId) => {
        const providerId = await originalGetProviderId(sessionId);
        signalProviderIdResolved();
        await providerIdGate;
        return providerId;
      },
    );

    const singleDelete = runtime.deleteSession(first.id);
    await providerIdResolved;
    const providerDelete = runtime.deleteProvider(config.id, 2);

    releaseProviderId();

    await expect(singleDelete).rejects.toThrow('正在删除');
    await expect(providerDelete).resolves.toMatchObject({
      providerId: config.id,
      sessionCount: 2,
    });
    await expect(repository.list(config.id)).resolves.toEqual([]);
  });

  it('reserves Provider deletion synchronously before the first await', async () => {
    const { runtime } = await createDeletionRuntime();
    const session = await runtime.createSession('Delete now', config.id);

    const deletion = runtime.deleteProvider(config.id, 1);

    await expect(runtime.sendMessage(session.id, 'Too late')).rejects.toThrow(
      '正在删除',
    );
    await expect(runtime.createSession('Too late', config.id)).rejects.toThrow(
      '正在删除',
    );
    await expect(runtime.deleteProvider(config.id, 1)).rejects.toThrow(
      '正在删除',
    );

    await expect(deletion).resolves.toMatchObject({
      providerId: config.id,
      sessionCount: 1,
    });
  });

  it('waits for an in-flight single-session mutation instead of reporting an active request', async () => {
    const { runtime, repository } = await createDeletionRuntime();
    const first = await runtime.createSession('Delete first', config.id);
    const second = await runtime.createSession('Cascade second', config.id);
    const originalDelete = repository.delete.bind(repository);
    let releaseDelete!: () => void;
    let signalDeleteStarted!: () => void;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const deleteStarted = new Promise<void>((resolve) => {
      signalDeleteStarted = resolve;
    });
    jest.spyOn(repository, 'delete').mockImplementationOnce(async (sessionId) => {
      signalDeleteStarted();
      await deleteGate;
      await originalDelete(sessionId);
    });

    const singleDelete = runtime.deleteSession(first.id);
    await deleteStarted;
    const providerDelete = runtime.deleteProvider(config.id);

    releaseDelete();
    await expect(singleDelete).resolves.toBeUndefined();
    await expect(providerDelete).resolves.toEqual({
      providerId: config.id,
      sessionCount: 1,
      deletedSessionIds: [second.id],
    });

    await expect(repository.list(config.id)).resolves.toEqual([]);
  });

  it('stops all selected-Provider runs without touching another Provider', async () => {
    const { runtime, configStore, credentialStore, repository } =
      await createDeletionRuntime();
    const selected = await runtime.createSession('Selected running', config.id);
    const other = await runtime.createSession('Other provider', otherConfig.id);
    const selectedStream = await runtime.sendMessage(selected.id, 'hello');
    const selectedIterator = selectedStream[Symbol.asyncIterator]();
    await expect(selectedIterator.next()).resolves.toMatchObject({ done: false });

    await expect(runtime.deleteProvider(config.id, 1)).resolves.toMatchObject({
      providerId: config.id,
      sessionCount: 1,
    });

    await expect(configStore.load()).resolves.toEqual([storedConfig(otherConfig)]);
    await expect(credentialStore.load(config.id)).resolves.toBeNull();
    await expect(credentialStore.load(otherConfig.id)).resolves.toBe('key-b');
    await expect(repository.get(selected.id)).rejects.toThrow('not found');
    await expect(repository.get(other.id)).resolves.toBeDefined();
  });

  it('blocks new sessions and sends while deletion is in progress', async () => {
    const { runtime, credentialStore, repository } =
      await createDeletionRuntime();
    const session = await runtime.createSession('Delete me', config.id);

    let releaseClear!: () => void;
    let signalClearStarted!: () => void;
    const clearGate = new Promise<void>((resolve) => {
      releaseClear = resolve;
    });
    const clearStarted = new Promise<void>((resolve) => {
      signalClearStarted = resolve;
    });
    const clearCredential = credentialStore.clear.bind(credentialStore);
    jest.spyOn(credentialStore, 'clear').mockImplementation(async (providerId) => {
      signalClearStarted();
      await clearGate;
      await clearCredential(providerId);
    });

    const deletion = runtime.deleteProvider(config.id, 1);
    await clearStarted;

    await expect(runtime.createSession('Too late', config.id)).rejects.toThrow(
      '正在删除',
    );
    await expect(runtime.sendMessage(session.id, 'Too late')).rejects.toThrow(
      '正在删除',
    );
    await expect(repository.getMessages(session.id)).resolves.toEqual([]);

    releaseClear();
    await expect(deletion).resolves.toMatchObject({
      providerId: config.id,
      sessionCount: 1,
    });
  });
});

const createPersonalizationRuntime = async (
  personalization: PersonalizationSettings,
  loadPersonalization: () => Promise<PersonalizationSettings> = async () => personalization,
) => {
  const configStore = new ProviderConfigStore(new MemoryLocalKeyValueStore());
  await configStore.save([config]);
  const credentialStore = new MemoryProviderCredentialStore();
  await credentialStore.save(config.id, 'sk-test');
  const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());
  const streamChat = jest.fn(async () => (async function* () {})());
  const runtime = new LocalProviderRuntime({
    configStore,
    credentialStore,
    sessionRepository: repository,
    clientFactory: () => ({
      cancelActiveRun: jest.fn(),
      streamChat,
    } as unknown as OpenAiCompatibleClient),
    loadPersonalization,
    toolGateway: {
      listTools: async () => [],
      callTool: async () => ({ content: 'unused' }),
    },
  });
  return { runtime, streamChat };
};

const firstRequestMessages = (streamChat: jest.Mock) => {
  const request = streamChat.mock.calls[0][0] as {
    messages: Array<{ role: string; content: string | null }>;
  };
  return request.messages;
};

const drain = async (stream: AsyncIterable<unknown>) => {
  // Exhaust the runtime stream so lazy model calls are dispatched.
  const iterator = stream[Symbol.asyncIterator]();
  let result = await iterator.next();
  while (!result.done) {
    result = await iterator.next();
  }
};

describe('LocalProviderRuntime personalization context', () => {
  const personalized: PersonalizationSettings = {
    baseStyle: { tone: 'professional' },
    characteristics: { traits: ['给出反例'] },
    instructions: '保持克制',
  };

  it('injects a Personalization system context into plain Local Chat requests', async () => {
    const { runtime, streamChat } = await createPersonalizationRuntime(personalized);
    const session = await runtime.createSession('Chat', config.id);

    await drain(await runtime.sendMessage(session.id, '你好'));

    const messages = firstRequestMessages(streamChat);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('professional');
    expect(messages[0].content).toContain('保持克制');
    expect(messages.some((message) => message.role === 'user')).toBe(true);
  });

  it('injects the same Personalization context into Local Agent requests', async () => {
    const { runtime, streamChat } = await createPersonalizationRuntime(personalized);
    const session = await runtime.createSession('Agent', config.id);

    await drain(await runtime.sendMessage(session.id, '你好', { agentEnabled: true }));

    const messages = firstRequestMessages(streamChat);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('professional');
  });

  it('does not inject a system context when personalization is default and no instruction is present', async () => {
    const { runtime, streamChat } = await createPersonalizationRuntime(
      DEFAULT_PERSONALIZATION_SETTINGS,
    );
    const session = await runtime.createSession('Chat', config.id);

    await drain(await runtime.sendMessage(session.id, '你好'));

    const messages = firstRequestMessages(streamChat);
    expect(messages.some((message) => message.role === 'system')).toBe(false);
  });

  it('carries the precedence note so the current user message can override the stored style', async () => {
    const { runtime, streamChat } = await createPersonalizationRuntime(personalized);
    const session = await runtime.createSession('Chat', config.id);

    await drain(await runtime.sendMessage(session.id, '请用非常简短的一句话回答'));

    const messages = firstRequestMessages(streamChat);
    expect(messages[0].content).toContain('follow the current user message');
  });

  it('never persists the compiled context into stored conversation history', async () => {
    const { runtime } = await createPersonalizationRuntime(personalized);
    const session = await runtime.createSession('Chat', config.id);

    await drain(await runtime.sendMessage(session.id, '你好'));

    const stored = await runtime.getMessages(session.id);
    expect(stored.some((message) => message.role === 'system')).toBe(false);
  });

  it('degrades to no personalization context when loading fails, without failing the send', async () => {
    const { runtime, streamChat } = await createPersonalizationRuntime(personalized, () => {
      throw new Error('corrupted personalization payload');
    });
    const session = await runtime.createSession('Chat', config.id);

    await expect(
      drain(await runtime.sendMessage(session.id, '你好')),
    ).resolves.toBeUndefined();

    const messages = firstRequestMessages(streamChat);
    expect(messages.some((message) => message.role === 'system')).toBe(false);
  });
});

