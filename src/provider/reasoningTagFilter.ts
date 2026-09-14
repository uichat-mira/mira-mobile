import type { RuntimeEvent } from '../runtime/conversationRuntime';

const OPEN_TAG = /^<think(?:ing)?>/iu;
const CLOSE_TAG = /^<\/think(?:ing)?>/iu;
const KNOWN_TAGS = ['<think>', '<thinking>', '</think>', '</thinking>'];

const isPartialTag = (value: string): boolean => {
  const lower = value.toLowerCase();
  return KNOWN_TAGS.some(
    (tag) => tag.length > lower.length && tag.startsWith(lower),
  );
};

export interface ReasoningTagFilter {
  push(chunk: string): string;
  flush(): string;
}

export const createReasoningTagFilter = (): ReasoningTagFilter => {
  let buffer = '';
  let insideReasoning = false;

  const drainOutside = (parts: string[]): boolean => {
    const marker = buffer.indexOf('<');
    if (marker === -1) {
      parts.push(buffer);
      buffer = '';
      return false;
    }
    if (marker > 0) {
      parts.push(buffer.slice(0, marker));
      buffer = buffer.slice(marker);
    }

    const open = OPEN_TAG.exec(buffer);
    if (open) {
      buffer = buffer.slice(open[0].length);
      insideReasoning = true;
      return true;
    }

    const close = CLOSE_TAG.exec(buffer);
    if (close) {
      buffer = buffer.slice(close[0].length);
      return true;
    }

    if (isPartialTag(buffer)) return false;
    parts.push('<');
    buffer = buffer.slice(1);
    return true;
  };

  const drainInside = (): boolean => {
    for (let index = 0; index < buffer.length; index += 1) {
      if (buffer[index] !== '<') continue;
      const rest = buffer.slice(index);
      const close = CLOSE_TAG.exec(rest);
      if (close) {
        buffer = rest.slice(close[0].length);
        insideReasoning = false;
        return true;
      }
      if (isPartialTag(rest)) {
        buffer = rest;
        return false;
      }
    }
    buffer = '';
    return false;
  };

  return {
    push(chunk: string): string {
      if (!chunk) return '';
      buffer += chunk;
      const parts: string[] = [];
      while (buffer.length > 0) {
        const progressed = insideReasoning
          ? drainInside()
          : drainOutside(parts);
        if (!progressed) break;
      }
      return parts.join('');
    },
    flush(): string {
      const output = insideReasoning ? '' : buffer;
      buffer = '';
      insideReasoning = false;
      return output;
    },
  };
};

export const filterReasoningTagEvents = (
  stream: AsyncIterable<RuntimeEvent>,
): AsyncIterable<RuntimeEvent> =>
  (async function* () {
    const filter = createReasoningTagFilter();

    const flushVisible = function* (): Generator<RuntimeEvent> {
      const trailing = filter.flush();
      if (trailing) yield { type: 'text-delta' as const, delta: trailing };
    };

    for await (const event of stream) {
      if (event.type === 'text-delta') {
        const visible = filter.push(event.delta);
        if (visible) yield { ...event, delta: visible };
        continue;
      }

      if (event.type === 'finish') {
        yield* flushVisible();
      }
      yield event;
    }

    yield* flushVisible();
  })();
