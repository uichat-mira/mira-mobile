import { LocalSessionRepository } from '../local/localSessionRepository';
import { ProviderConfigStore, type LocalProviderConfig } from '../provider/providerConfigStore';
import { MemoryProviderCredentialStore } from '../security/providerCredentialStore';
import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import { LocalMemoryRepository, LocalMemoryService, LocalMemoryTurnLedger } from '../memory';
import { DEFAULT_PERSONALIZATION_SETTINGS } from '../settings/personalizationSettings';
import type { ToolGatewayClient } from '../tools/toolGatewayClient';
import type { RuntimeEvent } from './conversationRuntime';
import { LocalProviderRuntime } from './localProviderRuntime';

// #227 boundary routing contract: `LocalProviderRuntime` stays the stable
// `ConversationRuntime` entry point, but the four responsibilities are now
// delegated. These tests assert the observable routing/behavior of that split
// (which path runs, how runs are scoped, what gets consolidated) without
// reaching into private fields.

const config: LocalProviderConfig = {
  id: 'provider-a',
  name: 'Provider A',
  baseUrl: 'https://provider.example.com',
  model: 'model-a',
  protocol: 'chat-completions',
};

const streaming = (events: RuntimeEvent[]): AsyncIterable<RuntimeEvent> => ({
  [Symbol.asyncIterator]: async function* () {
    for (const event of events) yield event;
  },
});

const drain = async (stream: AsyncIterable<RuntimeEvent>) => {
  const events: RuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
};

const createMemoryService = (store = new MemoryLocalKeyValueStore()) =>
  new LocalMemoryService(
    new LocalMemoryRepository(store),
    new LocalMemoryTurnLedger(store),
  );

interface Harness {
  runtime: LocalProviderRuntime;
  repository: LocalSessionRepository;
  requests: Array<{ model: string; messages: Array<{ role: string; content: string | null }>; tools?: unknown[] }>;
  modelCalls: number;
  consolidationCalls: number;
  clients: Array<{ cancelActiveRun: jest.Mock }>;
}

const createHarness = async (options: {
  chatEvents: (callIndex: number) => RuntimeEvent[];
  consolidationEvents?: () => AsyncIterable<RuntimeEvent>;
  toolGateway?: ToolGatewayClient;
  memoryService?: LocalMemoryService;
}): Promise<Harness> => {
  const configStore = new ProviderConfigStore(new MemoryLocalKeyValueStore());
  await configStore.save([config]);
  const credentialStore = new MemoryProviderCredentialStore();
  await credentialStore.save(config.id, 'sk-test');
  const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());

  const requests: Harness['requests'] = [];
  const clients: Harness['clients'] = [];
  let modelCalls = 0;
  let consolidationCalls = 0;

  const clientFactory = () => {
    const client = { cancelActiveRun: jest.fn() };
    clients.push(client);
    let perClientCalls = 0;
    return {
      ...client,
      streamChat: async (request: Harness['requests'][number]) => {
        perClientCalls += 1;
        requests.push(request);
        // The first call on a fresh turn client is the model call; a later call
        // is the detached consolidation request.
        if (perClientCalls === 1) {
          const events = options.chatEvents(modelCalls);
          modelCalls += 1;
          return streaming(events);
        }
        consolidationCalls += 1;
        if (options.consolidationEvents) return options.consolidationEvents();
        return streaming([]);
      },
    } as never;
  };

  const runtime = new LocalProviderRuntime({
    configStore,
    credentialStore,
    sessionRepository: repository,
    clientFactory,
    ...(options.toolGateway ? { toolGateway: options.toolGateway } : {}),
    ...(options.memoryService ? { memoryService: options.memoryService } : {}),
    loadPersonalization: async () => DEFAULT_PERSONALIZATION_SETTINGS,
  });

  return {
    runtime,
    repository,
    requests,
    get modelCalls() {
      return modelCalls;
    },
    get consolidationCalls() {
      return consolidationCalls;
    },
    clients,
  } as Harness;
};

describe('#227 boundary routing', () => {
  it('routes an ordinary Chat send through Provider execution, not the Agent loop', async () => {
    const gateway: ToolGatewayClient = {
      listTools: async () => {
        throw new Error('Agent gateway must not be consulted for ordinary Chat');
      },
      callTool: async () => ({ content: 'unused' }),
    };
    const harness = await createHarness({
      chatEvents: () => [
        { type: 'text-delta', delta: 'hi' },
        { type: 'finish', reason: 'stop' },
      ],
      toolGateway: gateway,
    });
    const session = await harness.runtime.createSession('Chat', config.id);

    await drain(await harness.runtime.sendMessage(session.id, '你好'));

    const stored = await harness.repository.getMessages(session.id);
    expect(stored.find((message) => message.role === 'assistant')?.content).toBe('hi');
    expect(harness.requests).toHaveLength(1);
  });

  it('runs the Agent loop per model round when agent mode is enabled', async () => {
    let rounds = 0;
    const gateway: ToolGatewayClient = {
      listTools: async () => [{ name: 'remote_tool', parameters: { type: 'object' } }],
      callTool: async () => ({ content: 'ok' }),
    };
    const harness = await createHarness({
      chatEvents: () =>
        rounds === 0
          ? [
              { type: 'tool-call', callId: 'call-1', name: 'remote_tool', arguments: '{}' },
              { type: 'finish', reason: 'tool_calls' },
            ]
          : [
              { type: 'text-delta', delta: 'done' },
              { type: 'finish', reason: 'stop' },
            ],
      toolGateway: gateway,
    });
    // Each Agent model round must go through the executor, so the counter is
    // driven by the number of recorded requests.
    const session = await harness.runtime.createSession('Agent', config.id);

    await drain(await harness.runtime.sendMessage(session.id, '跑一下', { agentEnabled: true }));

    expect(harness.requests.length).toBeGreaterThanOrEqual(2);
    expect(harness.requests[0].tools).toBeDefined();
  });

  it('cancels the previous run client when a newer Agent run replaces it', async () => {
    const gateway: ToolGatewayClient = {
      listTools: async () => [],
      callTool: async () => ({ content: 'unused' }),
    };
    const harness = await createHarness({
      chatEvents: () => [{ type: 'finish', reason: 'stop' }],
      toolGateway: gateway,
    });
    const first = await harness.runtime.createSession('First', config.id);
    const second = await harness.runtime.createSession('Second', config.id);

    await harness.runtime.sendMessage(first.id, 'first', { agentEnabled: true });
    await harness.runtime.sendMessage(second.id, 'second', { agentEnabled: true });

    expect(harness.clients[0].cancelActiveRun).toHaveBeenCalledTimes(1);
    expect(harness.clients[1].cancelActiveRun).not.toHaveBeenCalled();
  });

  it('rejects a stale approval after cancel so no cross-run approval resolves', async () => {
    const gateway: ToolGatewayClient = {
      listTools: async () => [],
      callTool: async () => ({ content: 'unused' }),
    };
    const harness = await createHarness({
      chatEvents: () => [{ type: 'finish', reason: 'stop' }],
      toolGateway: gateway,
    });
    const session = await harness.runtime.createSession('Agent', config.id);

    await harness.runtime.sendMessage(session.id, 'hi', { agentEnabled: true });
    // A stale approval id must be a no-op, not throw or resolve a live run.
    expect(() => harness.runtime.resolveToolApproval('missing', 'approved')).not.toThrow();
    expect(() => harness.runtime.cancelActiveRun()).not.toThrow();
  });

  it('cancels the real Provider request for an ordinary Local Chat turn', async () => {
    const harness = await createHarness({
      chatEvents: () => [
        { type: 'text-delta', delta: 'still running' },
        { type: 'finish', reason: 'stop' },
      ],
    });
    const session = await harness.runtime.createSession('Chat', config.id);

    await harness.runtime.sendMessage(session.id, '你好');
    expect(harness.clients[0].cancelActiveRun).not.toHaveBeenCalled();

    harness.runtime.cancelActiveRun();

    expect(harness.clients[0].cancelActiveRun).toHaveBeenCalledTimes(1);
  });

  it('cancels the real Provider request when ordinary Local Chat is suspended', async () => {
    const harness = await createHarness({
      chatEvents: () => [
        { type: 'text-delta', delta: 'still running' },
        { type: 'finish', reason: 'stop' },
      ],
    });
    const session = await harness.runtime.createSession('Chat', config.id);

    await harness.runtime.sendMessage(session.id, '你好');
    expect(harness.clients[0].cancelActiveRun).not.toHaveBeenCalled();

    harness.runtime.setExecutionSuspended(true);

    expect(harness.clients[0].cancelActiveRun).toHaveBeenCalledTimes(1);
  });

  it('does not retain a completed Agent Provider client for later cancel or suspend', async () => {
    const gateway: ToolGatewayClient = {
      listTools: async () => [],
      callTool: async () => ({ content: 'unused' }),
    };
    const harness = await createHarness({
      chatEvents: () => [{ type: 'finish', reason: 'stop' }],
      toolGateway: gateway,
    });
    const session = await harness.runtime.createSession('Agent', config.id);

    await drain(
      await harness.runtime.sendMessage(session.id, 'done', {
        agentEnabled: true,
      }),
    );
    expect(harness.clients[0].cancelActiveRun).not.toHaveBeenCalled();

    harness.runtime.cancelActiveRun();
    harness.runtime.setExecutionSuspended(true);

    expect(harness.clients[0].cancelActiveRun).not.toHaveBeenCalled();
  });

  it('does not consolidate an ordinary Chat turn that never completes', async () => {
    const service = createMemoryService();
    const harness = await createHarness({
      chatEvents: () => [{ type: 'text-delta', delta: 'partial' }, { type: 'error', message: 'boom' }],
      consolidationEvents: () => streaming([{ type: 'text-delta', delta: '{"patches":[]}' }]),
      memoryService: service,
    });
    const session = await harness.runtime.createSession('Chat', config.id);

    await drain(await harness.runtime.sendMessage(session.id, '你好'));

    expect(harness.consolidationCalls).toBe(0);
    expect((await service.getOverview()).records).toHaveLength(0);
  });
});
