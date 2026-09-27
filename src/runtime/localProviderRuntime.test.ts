import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import { LocalSessionRepository } from '../local/localSessionRepository';
import { ProviderConfigStore, type LocalProviderConfig } from '../provider/providerConfigStore';
import type { OpenAiCompatibleClient } from '../provider/openAiCompatibleClient';
import { MemoryProviderCredentialStore } from '../security/providerCredentialStore';
import { LocalProviderRuntime } from './localProviderRuntime';

const config: LocalProviderConfig = {
  id: 'provider-a',
  name: 'Provider A',
  baseUrl: 'https://provider.example.com',
  model: 'model-a',
  protocol: 'chat-completions',
};

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
    const firstClient = {
      cancelActiveRun: jest.fn(),
      streamChat: jest.fn(),
    };
    const secondClient = {
      cancelActiveRun: jest.fn(),
      streamChat: jest.fn(),
    };
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

    await runtime.sendMessage(firstSession.id, 'first', { agentEnabled: true });
    await runtime.sendMessage(secondSession.id, 'second', { agentEnabled: true });

    expect(firstClient.cancelActiveRun).toHaveBeenCalledTimes(1);
    expect(secondClient.cancelActiveRun).not.toHaveBeenCalled();
  });

  it('derives the session title from the first non-empty user message', async () => {
    const { runtime } = await createSendReadyRuntime();
    const session = await runtime.createSession(undefined, config.id);

    await runtime.sendMessage(session.id, '   ');
    await expect(runtime.getSession(session.id)).resolves.toMatchObject({
      title: 'New local conversation',
    });

    await runtime.sendMessage(session.id, '  帮我写一个\n快速排序算法，并解释复杂度  ');

    await expect(runtime.getSession(session.id)).resolves.toMatchObject({
      title: '帮我写一个 快速排序算法，并解释复杂度',
    });
  });

  it('caps the derived session title at thirty characters', async () => {
    const { runtime } = await createSendReadyRuntime();
    const session = await runtime.createSession(undefined, config.id);

    await runtime.sendMessage(session.id, `${'a'.repeat(40)}\n${'b'.repeat(20)}`);

    await expect(runtime.getSession(session.id)).resolves.toMatchObject({
      title: `${'a'.repeat(30)}…`,
    });
  });

  it('keeps a custom session title when the first message arrives', async () => {
    const { runtime } = await createSendReadyRuntime();
    const session = await runtime.createSession('Custom title', config.id);

    await runtime.sendMessage(session.id, 'hello');

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
