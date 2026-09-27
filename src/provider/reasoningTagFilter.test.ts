import type { RuntimeEvent } from '../runtime/conversationRuntime';
import {
  createReasoningTagFilter,
  filterReasoningTagEvents,
} from './reasoningTagFilter';

const run = (chunks: string[]): string => {
  const filter = createReasoningTagFilter();
  return chunks.map((chunk) => filter.push(chunk)).join('') + filter.flush();
};

const collect = async (stream: AsyncIterable<RuntimeEvent>) => {
  const events: RuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
};

const events = (...items: RuntimeEvent[]): AsyncIterable<RuntimeEvent> =>
  (async function* () {
    for (const item of items) yield item;
  })();

describe('createReasoningTagFilter', () => {
  it('preserves ordinary text byte-for-byte', () => {
    expect(run(['  hello ', '\nworld'])).toBe('  hello \nworld');
  });

  it('removes complete think blocks', () => {
    expect(run(['before<think>internal</think>after'])).toBe('beforeafter');
  });

  it('removes think blocks split across content chunks', () => {
    expect(run(['<th', 'ink>secret rea', 'soning</thi', 'nk>final'])).toBe(
      'final',
    );
  });

  it('supports the thinking variant case-insensitively', () => {
    expect(run(['<Thinking>hidden</THINKING>visible'])).toBe('visible');
  });

  it('drops a trailing unclosed reasoning block', () => {
    expect(run(['answer ', '<think>never closed'])).toBe('answer ');
  });

  it('preserves unrelated markup and incomplete non-reasoning tags', () => {
    expect(run(['a < b <div>x</div> <thi', 'ck>'])).toBe(
      'a < b <div>x</div> <thick>',
    );
  });
});

describe('filterReasoningTagEvents', () => {
  it('filters text deltas while preserving tool calls and finish events', async () => {
    const stream = filterReasoningTagEvents(
      events(
        { type: 'text-delta', delta: '<think>hidden</think>answer' },
        {
          type: 'tool-call',
          callId: 'call-1',
          name: 'search',
          arguments: '{}',
        },
        { type: 'finish', reason: 'tool_calls' },
      ),
    );

    await expect(collect(stream)).resolves.toEqual([
      { type: 'text-delta', delta: 'answer' },
      {
        type: 'tool-call',
        callId: 'call-1',
        name: 'search',
        arguments: '{}',
      },
      { type: 'finish', reason: 'tool_calls' },
    ]);
  });

  it('drops an unclosed reasoning block before finish', async () => {
    const stream = filterReasoningTagEvents(
      events(
        { type: 'text-delta', delta: '<think>still hidden' },
        { type: 'finish', reason: 'length' },
      ),
    );

    await expect(collect(stream)).resolves.toEqual([
      { type: 'finish', reason: 'length' },
    ]);
  });
});
