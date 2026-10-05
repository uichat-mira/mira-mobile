import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import { LocalMemoryRepository, LocalMemoryService, LocalMemoryTurnLedger } from '../memory';
import type { LocalProviderConfig } from '../provider/providerConfigStore';
import type { RuntimeEvent } from './conversationRuntime';
import type { LocalProviderExecutor } from './localProviderExecution';
import { consolidateLocalTurn, isCompletedTurn } from './localTurnConsolidation';

// #227 completed-turn post-processing contract: only a real final Assistant
// reply consolidates, the consolidator is bound per turn to the executor's
// client/model, and every failure path is swallowed.

const config: LocalProviderConfig = {
  id: 'provider-a',
  name: 'Provider A',
  baseUrl: 'https://provider.example.com',
  model: 'model-a',
  protocol: 'chat-completions',
};

const createService = (store = new MemoryLocalKeyValueStore()) =>
  new LocalMemoryService(new LocalMemoryRepository(store), new LocalMemoryTurnLedger(store));

const executorWith = (
  streamChat: (request: { model: string }) => Promise<AsyncIterable<RuntimeEvent>>,
): LocalProviderExecutor =>
  ({
    client: { streamChat, cancelActiveRun: jest.fn() },
    streamMessages: jest.fn(),
  } as unknown as LocalProviderExecutor);

const streaming = (events: RuntimeEvent[]): AsyncIterable<RuntimeEvent> => ({
  [Symbol.asyncIterator]: async function* () {
    for (const event of events) yield event;
  },
});

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

describe('#227 isCompletedTurn', () => {
  it('accepts a real final reply', () => {
    expect(
      isCompletedTurn({ content: 'hi', sawError: false, paused: false, finished: true, finishReason: 'stop' }),
    ).toBe(true);
    expect(
      isCompletedTurn({ content: 'hi', sawError: false, paused: false, finished: true, finishReason: null }),
    ).toBe(true);
  });

  it.each([
    ['empty content', { content: '', sawError: false, paused: false, finished: true, finishReason: 'stop' as const }],
    ['error', { content: 'x', sawError: true, paused: false, finished: true, finishReason: 'stop' as const }],
    ['paused', { content: 'x', sawError: false, paused: true, finished: false, finishReason: null }],
    ['not finished', { content: 'x', sawError: false, paused: false, finished: false, finishReason: null }],
    ['tool_calls', { content: 'x', sawError: false, paused: false, finished: true, finishReason: 'tool_calls' as const }],
    ['length', { content: 'x', sawError: false, paused: false, finished: true, finishReason: 'length' as const }],
    ['content_filter', { content: 'x', sawError: false, paused: false, finished: true, finishReason: 'content_filter' as const }],
  ])('rejects a non-completed turn (%s)', (_label, turn) => {
    expect(isCompletedTurn(turn)).toBe(false);
  });
});

describe('#227 consolidateLocalTurn', () => {
  const input = {
    threadId: 'thread-1',
    userMessageId: 'user-1',
    assistantMessageId: 'assistant-1',
    userText: '以后技术问题先给我结论。',
    assistantText: '记住了。',
  };

  it('commits a completed turn using the executor model and client', async () => {
    const service = createService();
    const seen: string[] = [];
    const executor = executorWith(async (request) => {
      seen.push(request.model);
      return streaming([{ type: 'text-delta', delta: PROPOSAL_JSON }]);
    });

    await consolidateLocalTurn(input, { service, executor, config });

    expect(seen).toEqual(['model-a']);
    const overview = await service.getOverview();
    expect(overview.records).toHaveLength(1);
    expect(await service.isProcessed({ type: 'conversation', ...input, threadId: 'thread-1' })).toBe(true);
  });

  it('swallows a provider failure without marking the turn processed', async () => {
    const service = createService();
    const executor = executorWith(async () => {
      throw new Error('provider unavailable');
    });

    await expect(
      consolidateLocalTurn(input, { service, executor, config }),
    ).resolves.toBeUndefined();

    expect(
      await service.isProcessed({
        type: 'conversation',
        threadId: 'thread-1',
        userMessageId: 'user-1',
        assistantMessageId: 'assistant-1',
      }),
    ).toBe(false);
  });

  it('is idempotent for the same canonical evidence', async () => {
    const service = createService();
    let calls = 0;
    const executor = executorWith(async () => {
      calls += 1;
      return streaming([{ type: 'text-delta', delta: PROPOSAL_JSON }]);
    });

    await consolidateLocalTurn(input, { service, executor, config });
    await consolidateLocalTurn(input, { service, executor, config });

    expect(calls).toBe(1);
    expect((await service.getOverview()).records).toHaveLength(1);
  });
});
