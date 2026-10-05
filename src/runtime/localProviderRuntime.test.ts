import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import { LocalSessionRepository } from '../local/localSessionRepository';
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

  it('releases a started send lease when the runtime is cancelled', async () => {
    const { runtime, repository } = await createDeletionRuntime();
    const session = await runtime.createSession('Running', config.id);
    const stream = await runtime.sendMessage(session.id, 'hello');
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    await expect(runtime.deleteProvider(config.id, 1)).rejects.toThrow(
      '正在执行本地请求',
    );

    runtime.cancelActiveRun();

    await expect(runtime.deleteProvider(config.id, 1)).resolves.toMatchObject({
      providerId: config.id,
      sessionCount: 1,
    });
    await expect(repository.get(session.id)).rejects.toThrow('not found');
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

  it('blocks deletion while a started send is paused before Provider config resolves', async () => {
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
    jest.spyOn(configStore, 'load').mockImplementationOnce(async () => {
      signalLoadStarted();
      await loadGate;
      return originalLoad();
    });

    const stream = await runtime.sendMessage(session.id, 'hello');
    const iterator = stream[Symbol.asyncIterator]();
    const firstEvent = iterator.next();
    await loadStarted;

    await expect(runtime.deleteProvider(config.id, 1)).rejects.toThrow(
      '正在执行本地请求',
    );
    await expect(repository.getMessages(session.id)).resolves.toEqual([]);

    releaseLoad();
    await expect(firstEvent).resolves.toMatchObject({ done: false });
    await iterator.return?.();
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
    await expect(iterator.next()).rejects.toThrow('not found');
    await expect(repository.list(config.id)).resolves.toEqual([]);
  });

  it('refuses deletion while the selected Provider still owns an active run', async () => {
    const { runtime, configStore, credentialStore, repository } =
      await createDeletionRuntime();
    const session = await runtime.createSession('Running', config.id);
    const stream = await runtime.sendMessage(session.id, 'hello');
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ done: false });

    await expect(runtime.deleteProvider(config.id, 1)).rejects.toThrow(
      '正在执行本地请求',
    );
    await expect(configStore.load()).resolves.toEqual([storedConfig(config), storedConfig(otherConfig)]);
    await expect(credentialStore.load(config.id)).resolves.toBe('key-a');
    await expect(repository.get(session.id)).resolves.toBeDefined();

    await drain(stream);
    await expect(runtime.deleteProvider(config.id, 1)).resolves.toMatchObject({
      providerId: config.id,
      sessionCount: 1,
    });
    await expect(repository.get(session.id)).rejects.toThrow('not found');
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

