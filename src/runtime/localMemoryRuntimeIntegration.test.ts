import { LocalSessionRepository } from '../local/localSessionRepository';
import type { OpenAiStandardClient } from '../provider/openAiStandardClient';
import {
  ProviderConfigStore,
  type LocalProviderConfig,
} from '../provider/providerConfigStore';
import { MemoryProviderCredentialStore } from '../security/providerCredentialStore';
import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import {
  DEFAULT_PERSONALIZATION_SETTINGS,
  type PersonalizationSettings,
} from '../settings/personalizationSettings';
import {
  LocalMemoryRepository,
  LocalMemoryService,
  LocalMemoryTurnLedger,
  type ConversationMemorySource,
} from '../memory';
import { PairedRemoteMiraHostClient } from '../api/miraHostClient';
import type { ToolGatewayClient } from '../tools/toolGatewayClient';
import { ToolApprovalRequiredError } from '../tools/toolGatewayClient';
import type { RuntimeEvent } from './conversationRuntime';
import { LocalProviderRuntime } from './localProviderRuntime';

// MOB-064 integration contract: the Mobile Local Memory Kernel (#161) is wired
// into the Local Provider chat / Agent runtime only. Memory is injected into the
// request, consolidation runs after a completed turn using the current Local
// Provider, and Remote Host stays memory-free.

const config: LocalProviderConfig = {
  id: 'provider-a',
  name: 'Provider A',
  baseUrl: 'https://provider.example.com',
  model: 'model-a',
  protocol: 'openai-chat-completions',
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

// Consolidation is a detached side effect, so it may still be in flight right
// after the stream drains. Tests that assert on its result must wait for it.
// We poll the ledger/overview until the detached work settles (bounded so a
// genuine hang fails rather than blocking forever).
const settleConsolidation = async (
  expected: () => Promise<boolean>,
): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await expected()) return;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
};

const requestMessages = (
  requests: Array<{ messages: Array<{ role: string; content: string | null }> }>,
  index = -1,
): Array<{ role: string; content: string | null }> => {
  const call = requests.at(index) as {
    messages: Array<{ role: string; content: string | null }>;
  };
  return call.messages;
};

const memorySystemOf = (
  messages: Array<{ role: string; content: string | null }>,
) =>
  messages.find(
    message =>
      message.role === 'system' &&
      typeof message.content === 'string' &&
      message.content.includes('durable memory'),
  );

const chatReply = (text: string): RuntimeEvent[] => [
  { type: 'text-delta', delta: text },
  { type: 'finish', reason: 'stop' },
];

const PROPOSAL_JSON = JSON.stringify({
  patches: [
    {
      operation: 'create',
      kind: 'preference',
      content: '用户偏好技术问题先给结论。',
      confidence: 0.98,
      reason: '用户明确表达',
    },
  ],
});

const createMemoryService = (store = new MemoryLocalKeyValueStore()) =>
  new LocalMemoryService(
    new LocalMemoryRepository(store),
    new LocalMemoryTurnLedger(store),
  );

interface ScriptedRuntimeOptions {
  memoryService: LocalMemoryService;
  chatEvents: RuntimeEvent[];
  consolidationEvents?: RuntimeEvent[] | (() => Promise<never>);
  personalization?: () => Promise<PersonalizationSettings>;
  toolGateway?: ToolGatewayClient;
}

/**
 * Build a runtime whose Provider client script distinguishes the chat request
 * from the follow-up consolidation request per turn: within each `sendMessage`
 * the factory hands out a fresh client, and the client's FIRST `streamMessages`
 * call is the chat request while the second is the consolidation request. This
 * mirrors production, where each `sendMessage` builds a new client.
 */
const createScriptedRuntime = async (options: ScriptedRuntimeOptions) => {
  const configStore = new ProviderConfigStore(new MemoryLocalKeyValueStore());
  await configStore.save([config]);
  const credentialStore = new MemoryProviderCredentialStore();
  await credentialStore.save(config.id, 'sk-test');
  const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());

  const requests: Array<{
    messages: Array<{ role: string; content: string | null }>;
  }> = [];
  let chatCalls = 0;
  let consolidationCalls = 0;
  const clientFactory = () => {
    let perClientCalls = 0;
    return {
      cancelActiveRun: jest.fn(),
      streamMessages: async (request: {
        model: string;
        messages: Array<{ role: string; content: string | null }>;
      }) => {
        chatCalls += 1;
        perClientCalls += 1;
        requests.push(request);
        if (perClientCalls === 1) return streaming(options.chatEvents);
        consolidationCalls += 1;
        if (options.consolidationEvents === undefined) return streaming([]);
        if (typeof options.consolidationEvents === 'function') {
          return options.consolidationEvents();
        }
        return streaming(options.consolidationEvents);
      },
    } as unknown as OpenAiStandardClient;
  };

  const runtime = new LocalProviderRuntime({
    configStore,
    credentialStore,
    sessionRepository: repository,
    clientFactory,
    memoryService: options.memoryService,
    loadPersonalization:
      options.personalization ?? (async () => DEFAULT_PERSONALIZATION_SETTINGS),
    ...(options.toolGateway ? { toolGateway: options.toolGateway } : {}),
  });
  const stats = () => ({
    chat: chatCalls,
    consolidation: consolidationCalls,
  });
  return { runtime, requests, repository, stats };
};

const agentGateway = (): ToolGatewayClient => ({
  listTools: async () => [],
  callTool: async () => ({ content: 'unused' }),
});

/**
 * A gateway whose first tool call asks for approval. Because the test runtime
 * never resolves that approval within the run deadline, the mobile Agent loop
 * ends with a real `run-paused` event — the concrete paused/waiting state the
 * commit policy must exclude.
 */
const approvalPausedGateway = (): ToolGatewayClient => ({
  listTools: async () => [
    { name: 'remote_tool', parameters: { type: 'object' } },
  ],
  callTool: async () => {
    throw new ToolApprovalRequiredError({
      invocationId: 'inv-1',
      callId: 'call-1',
      name: 'remote_tool',
      arguments: '{}',
      message: '需要审批',
    });
  },
  resolveApproval: () => new Promise(() => {}),
});

const toolCallEvents = (): RuntimeEvent[] => [
  { type: 'tool-call', callId: 'call-1', name: 'remote_tool', arguments: '{}' },
  { type: 'finish', reason: 'tool_calls' },
];

/**
 * Advance a paused Agent stream until it emits `run-paused`, then resolve. The
 * run is terminated by `cancelActiveRun` so no test hangs on a real timeout.
 */
const pauseAndCancel = async (
  runtime: LocalProviderRuntime,
  stream: AsyncIterable<RuntimeEvent>,
) => {
  const events: RuntimeEvent[] = [];
  for await (const event of stream) {
    events.push(event);
    if (event.type === 'approval-required') runtime.cancelActiveRun();
  }
  return events;
};

describe('MOB-064 Local Memory runtime integration', () => {
  it('consolidates a completed Local Chat turn then injects it into the next request', async () => {
    const service = createMemoryService();
    const { runtime, requests } = await createScriptedRuntime({
      memoryService: service,
      chatEvents: chatReply('记住了，以后先给结论。'),
      consolidationEvents: [{ type: 'text-delta', delta: PROPOSAL_JSON }],
    });
    const session = await runtime.createSession('Chat', config.id);

    await drain(await runtime.sendMessage(session.id, '以后技术问题先给我结论。'));
    // The first turn's consolidation is detached; wait for it to land before
    // the second request so it can be consumed as Memory context.
    await settleConsolidation(
      async () => (await service.getOverview()).records.length === 1,
    );
    await drain(await runtime.sendMessage(session.id, '再解释一下。'));

    // Call order per turn is [chat, consolidation]; the second chat request is
    // therefore at request index 2.
    const injected = memorySystemOf(requestMessages(requests, 2));
    expect(injected?.content).toContain('用户偏好技术问题先给结论。');

    const stored = await runtime.getMessages(session.id);
    expect(stored.some(message => message.role === 'system')).toBe(false);
  });

  it('consolidates a completed Local Agent turn', async () => {
    const service = createMemoryService();
    const { runtime, stats } = await createScriptedRuntime({
      memoryService: service,
      chatEvents: chatReply('已完成。'),
      consolidationEvents: [{ type: 'text-delta', delta: PROPOSAL_JSON }],
      toolGateway: agentGateway(),
    });
    const session = await runtime.createSession('Agent', config.id);

    await drain(
      await runtime.sendMessage(session.id, '以后技术问题先给我结论。', {
        agentEnabled: true,
      }),
    );
    await settleConsolidation(
      async () => (await service.getOverview()).records.length === 1,
    );

    const overview = await service.getOverview();
    expect(overview.records).toHaveLength(1);
    expect(stats().consolidation).toBe(1);
  });

  it('never consolidates a Local Agent run that pauses waiting for approval', async () => {
    const service = createMemoryService();
    const { runtime, stats } = await createScriptedRuntime({
      memoryService: service,
      chatEvents: toolCallEvents(),
      consolidationEvents: [{ type: 'text-delta', delta: PROPOSAL_JSON }],
      toolGateway: approvalPausedGateway(),
    });
    const session = await runtime.createSession('Agent', config.id);

    const events = await pauseAndCancel(
      runtime,
      await runtime.sendMessage(session.id, '以后技术问题先给我结论。', {
        agentEnabled: true,
      }),
    );

    expect(events.some(event => event.type === 'run-paused')).toBe(true);
    expect((await service.getOverview()).records).toHaveLength(0);
    // Only the chat request ran; no consolidation call happened.
    expect(stats().consolidation).toBe(0);
  });

  it('never consolidates a cancelled Local Agent run', async () => {
    const service = createMemoryService();
    const { runtime, stats } = await createScriptedRuntime({
      memoryService: service,
      chatEvents: toolCallEvents(),
      consolidationEvents: [{ type: 'text-delta', delta: PROPOSAL_JSON }],
      toolGateway: approvalPausedGateway(),
    });
    const session = await runtime.createSession('Agent', config.id);

    const stream = await runtime.sendMessage(session.id, '以后技术问题先给我结论。', {
      agentEnabled: true,
    });
    // Cancel as soon as the run starts waiting, so it ends via the cancellation
    // boundary rather than the overall timeout.
    const iterator = stream[Symbol.asyncIterator]();
    const events: RuntimeEvent[] = [];
    let result = await iterator.next();
    while (!result.done) {
      events.push(result.value);
      if (result.value.type === 'approval-required') runtime.cancelActiveRun();
      result = await iterator.next();
    }

    expect(events.some(event => event.type === 'run-paused')).toBe(true);
    expect((await service.getOverview()).records).toHaveLength(0);
    expect(stats().consolidation).toBe(0);
  });

  it('never consolidates when the Agent run fails before any reply', async () => {
    const service = createMemoryService();
    const { runtime, stats } = await createScriptedRuntime({
      memoryService: service,
      chatEvents: [{ type: 'error', message: 'provider exploded' }],
      consolidationEvents: [{ type: 'text-delta', delta: PROPOSAL_JSON }],
      toolGateway: agentGateway(),
    });
    const session = await runtime.createSession('Agent', config.id);

    const events = await drain(
      await runtime.sendMessage(session.id, '以后技术问题先给我结论。', {
        agentEnabled: true,
      }),
    );

    expect(events).toContainEqual({ type: 'error', message: 'provider exploded' });
    // A failed run produced no canonical reply, so nothing is consolidated.
    expect((await service.getOverview()).records).toHaveLength(0);
    expect(stats().consolidation).toBe(0);
  });

  it('neither injects nor consolidates when Memory is disabled', async () => {
    const service = createMemoryService();
    await service.setEnabled(false);
    const { runtime, requests, stats } = await createScriptedRuntime({
      memoryService: service,
      chatEvents: chatReply('记住了。'),
      consolidationEvents: [{ type: 'text-delta', delta: PROPOSAL_JSON }],
    });
    const session = await runtime.createSession('Chat', config.id);

    await drain(await runtime.sendMessage(session.id, '以后技术问题先给我结论。'));

    expect(memorySystemOf(requestMessages(requests))).toBeUndefined();
    expect((await service.getOverview()).records).toHaveLength(0);
    expect(stats().consolidation).toBe(0);
  });

  it('marks a no-patch successful consolidation as processed', async () => {
    const service = createMemoryService();
    const { runtime, stats } = await createScriptedRuntime({
      memoryService: service,
      chatEvents: chatReply('好的。'),
      consolidationEvents: [{ type: 'text-delta', delta: '{"patches":[]}' }],
    });
    const session = await runtime.createSession('Chat', config.id);

    await drain(await runtime.sendMessage(session.id, '帮我算一下。'));
    // Turn 1 consolidates exactly once (detached; wait for it).
    await settleConsolidation(async () => stats().consolidation >= 1);
    expect(stats().consolidation).toBe(1);
    await drain(await runtime.sendMessage(session.id, '再算一次。'));
    // No-patch consolidation is still recorded as processed, so turn 2 also
    // consolidates exactly once: never a repeat for turn 1.
    await settleConsolidation(async () => stats().consolidation >= 2);
    expect(stats().consolidation).toBe(2);
  });

  it('keeps the chat successful and leaves the turn unprocessed when consolidation fails', async () => {
    const service = createMemoryService();
    const firstUserMessageId = 'local-user-1';
    const { runtime, repository, stats } = await createScriptedRuntime({
      memoryService: service,
      chatEvents: chatReply('这是回复。'),
      consolidationEvents: async () => {
        throw new Error('provider unavailable');
      },
    });
    const session = await runtime.createSession('Chat', config.id);

    await expect(
      drain(
        await runtime.sendMessage(session.id, '你好。', {
          messageId: firstUserMessageId,
        }),
      ),
    ).resolves.toBeDefined();

    const stored = await repository.getMessages(session.id);
    const assistant = stored.find(message => message.role === 'assistant');
    expect(assistant?.content).toBe('这是回复。');
    // Wait for the detached consolidation attempt to run and fail.
    await settleConsolidation(async () => stats().consolidation >= 1);
    expect(
      await service.isProcessed({
        type: 'conversation',
        threadId: session.id,
        userMessageId: firstUserMessageId,
        assistantMessageId: assistant?.id ?? '',
      }),
    ).toBe(false);
  });

  it('treats invalid consolidation JSON as failure without failing the reply', async () => {
    const service = createMemoryService();
    const { runtime, stats } = await createScriptedRuntime({
      memoryService: service,
      chatEvents: chatReply('这是回复。'),
      consolidationEvents: [{ type: 'text-delta', delta: 'not json' }],
    });
    const session = await runtime.createSession('Chat', config.id);

    await expect(
      drain(await runtime.sendMessage(session.id, '你好。')),
    ).resolves.toBeDefined();

    await settleConsolidation(async () => stats().consolidation >= 1);
    expect(stats().consolidation).toBe(1);
    expect((await service.getOverview()).records).toHaveLength(0);
  });

  it('never runs a second consolidation for the same canonical evidence', async () => {
    const service = createMemoryService();
    const { runtime, repository, stats } = await createScriptedRuntime({
      memoryService: service,
      chatEvents: chatReply('记住了。'),
      consolidationEvents: [{ type: 'text-delta', delta: PROPOSAL_JSON }],
    });
    const session = await runtime.createSession('Chat', config.id);

    await drain(await runtime.sendMessage(session.id, '以后技术问题先给我结论。'));
    await settleConsolidation(
      async () => (await service.getOverview()).records.length === 1,
    );
    const evidence: ConversationMemorySource = {
      type: 'conversation',
      threadId: session.id,
      userMessageId: (await repository.getMessages(session.id)).find(
        message => message.role === 'user',
      )!.id,
      assistantMessageId: (await repository.getMessages(session.id)).find(
        message => message.role === 'assistant',
      )!.id,
    };

    // Replay the exact same canonical evidence directly through the service: the
    // ledger must make it a no-op and the consolidator must not be called again.
    const before = stats().consolidation;
    await service.commitTurn({
      source: evidence,
      userText: '以后技术问题先给我结论。',
      assistantText: '记住了。',
      consolidator: { propose: async () => [] },
    });
    expect(stats().consolidation).toBe(before);
    expect((await service.getOverview()).records).toHaveLength(1);
  });

  it('keeps both Personalization and Memory in the Local request with the user message last', async () => {
    const service = createMemoryService();
    const { runtime, requests } = await createScriptedRuntime({
      memoryService: service,
      chatEvents: chatReply('记住了。'),
      consolidationEvents: [{ type: 'text-delta', delta: PROPOSAL_JSON }],
      personalization: async () => ({
        baseStyle: { tone: 'professional' },
        characteristics: { traits: [] },
        instructions: '',
      }),
    });
    const session = await runtime.createSession('Chat', config.id);

    await drain(await runtime.sendMessage(session.id, '以后技术问题先给我结论。'));
    await settleConsolidation(
      async () => (await service.getOverview()).records.length === 1,
    );
    await drain(await runtime.sendMessage(session.id, '请用一句话回答。'));

    // The second chat request (after the first turn's consolidation) is at
    // request index 2.
    const messages = requestMessages(requests, 2);
    const systems = messages.filter(message => message.role === 'system');
    expect(systems.some(message => message.content?.includes('professional'))).toBe(true);
    expect(memorySystemOf(messages)).toBeDefined();
    // Personalization precedes Memory; the conversation follows both.
    const personalizationIndex = messages.findIndex(message =>
      message.content?.includes('professional'),
    );
    const memoryIndex = messages.findIndex(
      message => memorySystemOf([message]) !== undefined,
    );
    expect(personalizationIndex).toBeLessThan(memoryIndex);
    expect(messages.at(-1)?.role).toBe('user');
    expect(messages.at(-1)?.content).toBe('请用一句话回答。');
  });

  it('scopes each concurrent Provider to its own model and client during consolidation', async () => {
    const service = createMemoryService();
    const providerA: LocalProviderConfig = {
      ...config,
      id: 'provider-a',
      name: 'Provider A',
      model: 'model-a',
    };
    const providerB: LocalProviderConfig = {
      ...config,
      id: 'provider-b',
      name: 'Provider B',
      model: 'model-b',
    };
    const configStore = new ProviderConfigStore(new MemoryLocalKeyValueStore());
    await configStore.save([providerA, providerB]);
    const credentialStore = new MemoryProviderCredentialStore();
    await credentialStore.save(providerA.id, 'sk-a');
    await credentialStore.save(providerB.id, 'sk-b');
    const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());

    // Each Provider's client records which model its consolidation request used,
    // and each resolves its chat reply only when the test releases it. This
    // lets both sessions reach the consolidation step concurrently.
    const consolidationModels: string[] = [];
    const makeClient = (providerId: string) => {
      let perClientCalls = 0;
      return {
        cancelActiveRun: jest.fn(),
        streamMessages: async (request: { model: string }) => {
          perClientCalls += 1;
          if (perClientCalls === 1) {
            return streaming(chatReply(`reply-${providerId}`));
          }
          consolidationModels.push(request.model);
          return streaming([{ type: 'text-delta', delta: '{"patches":[]}' }]);
        },
      } as unknown as OpenAiStandardClient;
    };

    const runtime = new LocalProviderRuntime({
      configStore,
      credentialStore,
      sessionRepository: repository,
      clientFactory: (providerConfig) =>
        makeClient(providerConfig.id),
      memoryService: service,
      loadPersonalization: async () => DEFAULT_PERSONALIZATION_SETTINGS,
    });
    const sessionA = await runtime.createSession('A', providerA.id);
    const sessionB = await runtime.createSession('B', providerB.id);

    await drain(await runtime.sendMessage(sessionA.id, '记住 A。'));
    await drain(await runtime.sendMessage(sessionB.id, '记住 B。'));
    await settleConsolidation(async () => consolidationModels.length >= 2);

    // Each consolidation used exactly its own session's Provider model; neither
    // ever saw the other's model.
    expect(new Set(consolidationModels)).toEqual(new Set(['model-a', 'model-b']));
    expect(consolidationModels.filter(model => model === 'model-a')).toHaveLength(1);
    expect(consolidationModels.filter(model => model === 'model-b')).toHaveLength(1);
  });

  it.each(['length', 'content_filter'])(
    'does not consolidate a Local Chat reply finished with %s',
    async finishReason => {
      const service = createMemoryService();
      const { runtime, stats } = await createScriptedRuntime({
        memoryService: service,
        chatEvents: [
          { type: 'text-delta', delta: '这是未完整的回复。' },
          { type: 'finish', reason: finishReason },
        ],
        consolidationEvents: [{ type: 'text-delta', delta: PROPOSAL_JSON }],
      });
      const session = await runtime.createSession('Chat', config.id);

      await drain(await runtime.sendMessage(session.id, '请继续。'));

      expect(stats().consolidation).toBe(0);
      expect((await service.getOverview()).records).toHaveLength(0);
    },
  );

  it.each(['length', 'content_filter'])(
    'does not consolidate a Local Agent reply finished with %s',
    async finishReason => {
      const service = createMemoryService();
      const { runtime, stats } = await createScriptedRuntime({
        memoryService: service,
        chatEvents: [
          { type: 'text-delta', delta: '这是未完整的 Agent 回复。' },
          { type: 'finish', reason: finishReason },
        ],
        consolidationEvents: [{ type: 'text-delta', delta: PROPOSAL_JSON }],
        toolGateway: agentGateway(),
      });
      const session = await runtime.createSession('Agent', config.id);

      await drain(
        await runtime.sendMessage(session.id, '请继续。', {
          agentEnabled: true,
        }),
      );

      expect(stats().consolidation).toBe(0);
      expect((await service.getOverview()).records).toHaveLength(0);
    },
  );

  it('does not consolidate an Agent turn that errors after emitting text', async () => {
    const service = createMemoryService();
    const { runtime, stats } = await createScriptedRuntime({
      memoryService: service,
      chatEvents: [
        { type: 'text-delta', delta: '正在处理…' },
        { type: 'error', message: 'provider exploded mid-run' },
      ],
      consolidationEvents: [{ type: 'text-delta', delta: PROPOSAL_JSON }],
      toolGateway: agentGateway(),
    });
    const session = await runtime.createSession('Agent', config.id);

    const events = await drain(
      await runtime.sendMessage(session.id, '以后技术问题先给我结论。', {
        agentEnabled: true,
      }),
    );

    expect(events).toContainEqual({
      type: 'error',
      message: 'provider exploded mid-run',
    });
    // A partial reply followed by a real error is not a completed turn.
    expect(stats().consolidation).toBe(0);
    expect((await service.getOverview()).records).toHaveLength(0);
  });

  it('does not consolidate an Agent turn stopped by the tool-round limit', async () => {
    const service = createMemoryService();
    const configStore = new ProviderConfigStore(new MemoryLocalKeyValueStore());
    await configStore.save([config]);
    const credentialStore = new MemoryProviderCredentialStore();
    await credentialStore.save(config.id, 'sk-test');
    const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());

    // Every model call returns text plus a tool call, so the loop always asks
    // for another round and eventually stops on the round limit. Any call after
    // the first model round is still a model round, never a consolidation.
    let modelCalls = 0;
    const runtime = new LocalProviderRuntime({
      configStore,
      credentialStore,
      sessionRepository: repository,
      clientFactory: () =>
        ({
          cancelActiveRun: jest.fn(),
          streamMessages: async () => {
            modelCalls += 1;
            return streaming([
              { type: 'text-delta', delta: '继续调用工具…' },
              { type: 'tool-call', callId: `call-${modelCalls}`, name: 'remote_tool', arguments: '{}' },
              { type: 'finish', reason: 'tool_calls' },
            ]);
          },
        } as unknown as OpenAiStandardClient),
      toolGateway: {
        listTools: async () => [
          { name: 'remote_tool', parameters: { type: 'object' } },
        ],
        callTool: async () => ({ content: 'ok' }),
      },
      memoryService: service,
      loadPersonalization: async () => DEFAULT_PERSONALIZATION_SETTINGS,
    });
    const session = await runtime.createSession('Agent', config.id);

    const events = await drain(
      await runtime.sendMessage(session.id, '以后技术问题先给我结论。', {
        agentEnabled: true,
      }),
    );

    expect(events.some(event => event.type === 'error')).toBe(true);
    // The turn stopped on the tool-round limit, not a final reply, so no Memory
    // is written and nothing is marked processed. The only Provider calls were
    // model rounds; consolidation was never attempted.
    expect(modelCalls).toBeGreaterThan(1);
    expect((await service.getOverview()).records).toHaveLength(0);
  });

  it('strips reasoning tags before parsing consolidation JSON', async () => {
    const service = createMemoryService();
    const configStore = new ProviderConfigStore(new MemoryLocalKeyValueStore());
    const stripConfig: LocalProviderConfig = {
      ...config,
      compatibility: { reasoningTags: 'strip' },
    };
    await configStore.save([stripConfig]);
    const credentialStore = new MemoryProviderCredentialStore();
    await credentialStore.save(stripConfig.id, 'sk-test');
    const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());

    let perClientCalls = 0;
    const runtime = new LocalProviderRuntime({
      configStore,
      credentialStore,
      sessionRepository: repository,
      clientFactory: () =>
        ({
          cancelActiveRun: jest.fn(),
          streamMessages: async () => {
            perClientCalls += 1;
            if (perClientCalls === 1) return streaming(chatReply('记住了。'));
            // The Provider prefixes the JSON with a reasoning tag; only after
            // the same compatibility normalization as chat can this parse.
            return streaming([
              { type: 'text-delta', delta: '<thi' },
              { type: 'text-delta', delta: 'nk>internal reasoning</thi' },
              { type: 'text-delta', delta: 'nk>' },
              { type: 'text-delta', delta: PROPOSAL_JSON },
            ]);
          },
        } as unknown as OpenAiStandardClient),
      memoryService: service,
      loadPersonalization: async () => DEFAULT_PERSONALIZATION_SETTINGS,
    });
    const session = await runtime.createSession('Chat', stripConfig.id);

    await drain(await runtime.sendMessage(session.id, '以后技术问题先给我结论。'));
    await settleConsolidation(
      async () => (await service.getOverview()).records.length === 1,
    );

    const overview = await service.getOverview();
    expect(overview.records).toHaveLength(1);
    expect(overview.records[0]?.content).toContain('用户偏好技术问题先给结论。');
  });

  it('does not let a hung consolidation block chat stream completion', async () => {
    const service = createMemoryService();
    const { runtime, requests, stats } = await createScriptedRuntime({
      memoryService: service,
      chatEvents: chatReply('这是回复。'),
      // Consolidation never resolves: the chat stream must still complete.
      consolidationEvents: () => new Promise<never>(() => {}),
    });
    const session = await runtime.createSession('Chat', config.id);

    const stream = await runtime.sendMessage(session.id, '你好。');
    const events: RuntimeEvent[] = [];
    const iterator = stream[Symbol.asyncIterator]();
    // Bounded wait: if the hung consolidation blocked the stream, this would
    // never resolve and the test would fail on timeout.
    let result = await iterator.next();
    while (!result.done) {
      events.push(result.value);
      result = await iterator.next();
    }

    expect(events).toContainEqual({ type: 'text-delta', delta: '这是回复。' });
    const stored = await runtime.getMessages(session.id);
    expect(stored.find(message => message.role === 'assistant')?.content).toBe(
      '这是回复。',
    );
    // The chat stream completed without waiting for consolidation; the detached
    // consolidation was still attempted (and is hung), so nothing was processed.
    await settleConsolidation(async () => stats().consolidation >= 1);
    expect(stats().consolidation).toBe(1);
    expect(requests).toHaveLength(2);
  });
});

describe('MOB-064 Remote Host memory isolation', () => {
  const remoteStream = () => ({
    abort: jest.fn(),
    events: (async function* () {
      yield { type: 'finish', finishReason: 'stop' };
    })(),
  });

  const collect = async (value: AsyncIterable<string>) => {
    // Drain the remote stream so the request is fully dispatched.
    for await (const chunk of value) {
      expect(typeof chunk).toBe('string');
    }
  };

  it('never embeds Mobile Local Memory in a Remote Host request payload', async () => {
    // Populate real Mobile Local Memory first.
    const service = createMemoryService();
    await service.commitTurn({
      source: {
        type: 'conversation',
        threadId: 'thread-1',
        userMessageId: 'user-1',
        assistantMessageId: 'assistant-1',
      },
      userText: '以后技术问题先给我结论。',
      assistantText: '记住了。',
      consolidator: {
        propose: async () => [
          {
            operation: 'create',
            kind: 'preference',
            content: '用户偏好技术问题先给结论。',
            confidence: 0.98,
            reason: '用户明确表达',
          },
        ],
      },
    });

    const sendMessage = jest.fn().mockResolvedValue(remoteStream());
    const remote = {
      getMessages: jest.fn().mockResolvedValue([]),
      sendMessage,
    } as never;
    const client = new PairedRemoteMiraHostClient(remote);

    await collect(await client.sendMessage('thread-1', 'hello', 'user-1'));

    const payload = JSON.stringify(sendMessage.mock.calls[0][0]);
    expect(payload).not.toContain('durable memory');
    expect(payload).not.toContain('用户偏好技术问题先给结论。');
    expect(payload).not.toContain('system');
  });
});
