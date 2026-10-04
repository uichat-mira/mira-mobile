import {
  createLocalProviderConsolidator,
  parseConsolidationProposals,
} from './consolidator';
import type {
  ConsolidationInput,
  MemoryRecord,
  MemoryPatchProposal,
} from './types';
import type { RuntimeEvent } from '../runtime/conversationRuntime';
import { RemoteHostError } from '../api/remoteHttp';

interface ChatRequest {
  model: string;
  messages: Array<{ role: string; content: string | null }>;
}

const chatReturning = (events: RuntimeEvent[]) => {
  const iterable: AsyncIterable<RuntimeEvent> = {
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) yield event;
    },
  };
  return jest.fn<Promise<AsyncIterable<RuntimeEvent>>, [ChatRequest]>(
    async () => iterable,
  );
};

const existing: MemoryRecord[] = [
  {
    id: 'mem_1',
    kind: 'preference',
    content: '用户偏好先看结论。',
    sources: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
];

const input: ConsolidationInput = {
  source: {
    type: 'conversation',
    threadId: 'thread-1',
    userMessageId: 'user-1',
    assistantMessageId: 'assistant-1',
  },
  userText: '以后技术问题先给我结论。',
  assistantText: '记住了。',
  existing,
};

describe('parseConsolidationProposals', () => {
  it('parses a strict JSON proposal list', () => {
    const proposals = parseConsolidationProposals(
      JSON.stringify({
        patches: [
          {
            operation: 'create',
            kind: 'preference',
            content: '用户偏好先看结论。',
            confidence: 0.95,
            reason: '用户明确表达',
          },
        ],
      }),
    );

    expect(proposals).toHaveLength(1);
    expect(proposals?.[0]).toMatchObject({ operation: 'create', kind: 'preference' });
  });

  it('tolerates a fenced JSON payload', () => {
    const proposals = parseConsolidationProposals(
      '```json\n{"patches":[]}\n```',
    );
    expect(proposals).toEqual([]);
  });

  it('returns null for invalid JSON', () => {
    expect(parseConsolidationProposals('not json at all')).toBeNull();
  });

  it('returns null when the top-level shape is wrong', () => {
    expect(parseConsolidationProposals('{"foo":1}')).toBeNull();
    expect(parseConsolidationProposals('{"patches":{}}')).toBeNull();
  });

  it('returns null when any proposal is structurally invalid', () => {
    expect(
      parseConsolidationProposals(
        JSON.stringify({
          patches: [{ operation: 'create', content: '缺少 kind', confidence: 0.9, reason: 'x' }],
        }),
      ),
    ).toBeNull();
  });

  it('requires a targetId for replace and delete', () => {
    expect(
      parseConsolidationProposals(
        JSON.stringify({
          patches: [
            { operation: 'delete', confidence: 0.9, reason: 'x' },
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe('createLocalProviderConsolidator', () => {
  it('sends the turn and existing memory to the current Local Provider model', async () => {
    const chat = chatReturning([{ type: 'text-delta', delta: '{"patches":[]}' }]);
    const consolidator = createLocalProviderConsolidator({ model: 'model-a', chat });

    const proposals = await consolidator.propose(input);

    expect(proposals).toEqual([]);
    const request = chat.mock.calls[0]![0];
    expect(request.model).toBe('model-a');
    const userMessage = request.messages.find(
      (message: { role: string }) => message.role === 'user',
    );
    expect(userMessage?.content).toContain('以后技术问题先给我结论。');
    expect(userMessage?.content).toContain('用户偏好先看结论。');
  });

  it('returns null on provider failure so the turn is not marked processed', async () => {
    const chat = jest.fn(async () => {
      throw new RemoteHostError('NETWORK_ERROR', 'Unable to reach Provider');
    });
    const consolidator = createLocalProviderConsolidator({ model: 'model-a', chat });

    await expect(consolidator.propose(input)).resolves.toBeNull();
  });

  it('returns null when the provider returns no text', async () => {
    const chat = chatReturning([{ type: 'finish', reason: 'stop' }]);
    const consolidator = createLocalProviderConsolidator({ model: 'model-a', chat });

    await expect(consolidator.propose(input)).resolves.toBeNull();
  });

  it('returns null when the provider returns invalid JSON', async () => {
    const chat = chatReturning([{ type: 'text-delta', delta: 'sure, here you go!' }]);
    const consolidator = createLocalProviderConsolidator({ model: 'model-a', chat });

    await expect(consolidator.propose(input)).resolves.toBeNull();
  });

  it('propagates a valid proposal list to the caller for policy validation', async () => {
    const expected: MemoryPatchProposal[] = [
      {
        operation: 'create',
        kind: 'preference',
        content: '用户偏好先看结论。',
        confidence: 0.95,
        reason: '用户明确表达',
      },
    ];
    const chat = chatReturning([
      { type: 'text-delta', delta: JSON.stringify({ patches: expected }) },
    ]);
    const consolidator = createLocalProviderConsolidator({ model: 'model-a', chat });

    await expect(consolidator.propose(input)).resolves.toEqual(expected);
  });
});
