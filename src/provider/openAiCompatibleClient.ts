import { RemoteHostError } from '../api/remoteHttp';
import type { RuntimeEvent } from '../runtime/conversationRuntime';

export interface OpenAiCompatibleMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface OpenAiCompatibleTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAiCompatibleRequest {
  model: string;
  messages: OpenAiCompatibleMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  tools?: OpenAiCompatibleTool[];
  tool_choice?: 'auto' | 'none' | 'required';
}

export interface OpenAiCompatibleClientOptions {
  baseUrl: string;
  apiKey: string;
  requestTimeoutMs?: number;
  xhrFactory?: () => XMLHttpRequest;
}

interface StreamQueue<T> extends AsyncIterable<T> {
  push(value: T): void;
  close(): void;
  fail(error: unknown): void;
}

class AsyncPushQueue<T> implements StreamQueue<T>, AsyncIterableIterator<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private closed = false;
  private failure: unknown = null;

  push(value: T) {
    if (this.closed || this.failure) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value, done: false });
    } else {
      this.values.push(value);
    }
  }

  close() {
    if (this.closed || this.failure) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.resolve({ value: undefined, done: true });
    }
  }

  fail(error: unknown) {
    if (this.closed || this.failure) return;
    this.failure = error;
    this.values.length = 0;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.reject(error);
    }
  }

  next(): Promise<IteratorResult<T>> {
    if (this.failure) return Promise.reject(this.failure);
    const value = this.values.shift();
    if (value !== undefined) return Promise.resolve({ value, done: false });
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }
}

const normalizeBaseUrl = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/u, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new RemoteHostError('INVALID_PROVIDER_URL', 'Provider URL is not valid');
  }
  if (parsed.username || parsed.password) {
    throw new RemoteHostError(
      'INVALID_PROVIDER_URL',
      'Provider URL must not contain embedded credentials',
    );
  }
  if (parsed.protocol !== 'https:' && !__DEV__) {
    throw new RemoteHostError(
      'INSECURE_PROVIDER_URL',
      'Provider must use HTTPS outside development builds',
    );
  }
  return parsed.toString().replace(/\/+$/u, '');
};

const resolveChatCompletionsUrl = (value: string): string => {
  const normalized = normalizeBaseUrl(value);
  const parsed = new URL(normalized);
  const pathname = parsed.pathname.replace(/\/+$/u, '');
  const endpointPath = /(?:^|\/)v1$/u.test(pathname)
    ? `${pathname}/chat/completions`
    : `${pathname}/v1/chat/completions`;
  return `${parsed.protocol}//${parsed.host}${endpointPath}`;
};

const parseSseFrames = (buffer: string): { frames: string[]; remainder: string } => {
  const frames: string[] = [];
  let remainder = buffer;
  while (true) {
    const separator = /\r?\n\r?\n/u.exec(remainder);
    if (!separator || separator.index === undefined) break;
    frames.push(remainder.slice(0, separator.index));
    remainder = remainder.slice(separator.index + separator[0].length);
  }
  return { frames, remainder };
};

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

type PendingToolCalls = Map<number, PendingToolCall>;

const flushToolCalls = (pending: PendingToolCalls): RuntimeEvent[] => {
  const events = Array.from(pending.entries())
    .sort(([left], [right]) => left - right)
    .map(([, call]) => ({
      type: 'tool-call' as const,
      callId: call.id,
      name: call.name,
      arguments: call.arguments,
    }));
  pending.clear();
  return events;
};

interface ParsedProviderFrame {
  events: RuntimeEvent[];
  done: boolean;
}

const parseFrame = (frame: string, pendingToolCalls: PendingToolCalls): ParsedProviderFrame => {
  const data = frame
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /u, ''))
    .join('\n');
  if (!data) return { events: [], done: false };
  if (data === '[DONE]') {
    return { events: flushToolCalls(pendingToolCalls), done: true };
  }

  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch {
    throw new RemoteHostError('INVALID_PROVIDER_EVENT', 'Provider returned invalid SSE JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RemoteHostError('INVALID_PROVIDER_EVENT', 'Provider SSE event must be an object');
  }
  const choice = (value as Record<string, unknown>).choices;
  if (!Array.isArray(choice) || !choice[0] || typeof choice[0] !== 'object') {
    return { events: [], done: false };
  }
  const item = choice[0] as Record<string, unknown>;
  const events: RuntimeEvent[] = [];
  const delta = item.delta;
  if (delta && typeof delta === 'object' && !Array.isArray(delta)) {
    const deltaRecord = delta as Record<string, unknown>;
    if (typeof deltaRecord.content === 'string' && deltaRecord.content.length > 0) {
      events.push({ type: 'text-delta', delta: deltaRecord.content });
    }
    if (Array.isArray(deltaRecord.tool_calls)) {
      for (const [fallbackIndex, call] of deltaRecord.tool_calls.entries()) {
        if (!call || typeof call !== 'object' || Array.isArray(call)) continue;
        const record = call as Record<string, unknown>;
        const protocolIndex = record.index;
        const index =
          typeof protocolIndex === 'number' && Number.isInteger(protocolIndex) && protocolIndex >= 0
            ? protocolIndex
            : fallbackIndex;
        const fn = record.function;
        const functionRecord =
          fn && typeof fn === 'object' && !Array.isArray(fn)
            ? fn as Record<string, unknown>
            : null;
        if (typeof record.id !== 'string' && !functionRecord) continue;
        const previous = pendingToolCalls.get(index) ?? { id: '', name: '', arguments: '' };
        pendingToolCalls.set(index, {
          id: typeof record.id === 'string' ? record.id : previous.id,
          name:
            functionRecord && typeof functionRecord.name === 'string'
              ? functionRecord.name
              : previous.name,
          arguments:
            previous.arguments +
            (functionRecord && typeof functionRecord.arguments === 'string'
              ? functionRecord.arguments
              : ''),
        });
      }
    }
  }
  if (typeof item.finish_reason === 'string') {
    events.push(...flushToolCalls(pendingToolCalls));
    events.push({ type: 'finish', reason: item.finish_reason });
  }
  return { events, done: false };
};

export class OpenAiCompatibleClient {
  private readonly chatCompletionsUrl: string;
  private readonly xhrFactory: () => XMLHttpRequest;
  private readonly requestTimeoutMs: number;
  private activeAbort: AbortController | null = null;

  constructor(private readonly options: OpenAiCompatibleClientOptions) {
    this.chatCompletionsUrl = resolveChatCompletionsUrl(options.baseUrl);
    this.xhrFactory = options.xhrFactory ?? (() => new XMLHttpRequest());
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
  }

  async streamChat(request: OpenAiCompatibleRequest): Promise<AsyncIterable<RuntimeEvent>> {
    this.cancelActiveRun();
    const controller = new AbortController();
    this.activeAbort = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.requestTimeoutMs);
    const queue = new AsyncPushQueue<RuntimeEvent>();
    const cleanup = () => {
      clearTimeout(timeout);
      if (this.activeAbort === controller) this.activeAbort = null;
    };
    controller.signal.addEventListener('abort', () => {
      queue.fail(
        timedOut
          ? new RemoteHostError('PROVIDER_TIMEOUT', 'Provider request timed out')
          : new RemoteHostError('REQUEST_ABORTED', 'Provider request was cancelled'),
      );
      cleanup();
    });

    void this.consumeStream(request, controller, queue, () => timedOut, cleanup);
    return queue;
  }

  cancelActiveRun() {
    this.activeAbort?.abort();
    this.activeAbort = null;
  }

  private async consumeStream(
    request: OpenAiCompatibleRequest,
    controller: AbortController,
    queue: AsyncPushQueue<RuntimeEvent>,
    wasTimedOut: () => boolean,
    cleanup: () => void,
  ) {
    const xhr = this.xhrFactory();
    let processedLength = 0;
    let buffer = '';
    let settled = false;
    let receivedFinishReason = false;
    const pendingToolCalls: PendingToolCalls = new Map();

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      queue.fail(error);
      cleanup();
    };
    const complete = () => {
      if (settled) return;
      settled = true;
      try {
        buffer += (xhr.responseText ?? '').slice(processedLength);
        const trailing = parseSseFrames(buffer);
        for (const frame of trailing.frames) {
          const parsed = parseFrame(frame, pendingToolCalls);
          parsed.events.forEach((event) => {
            if (event.type === 'finish' && event.reason !== null) receivedFinishReason = true;
            queue.push(event);
          });
          if (parsed.done && !receivedFinishReason) {
            queue.push({ type: 'finish', reason: null });
          }
        }
        queue.close();
        cleanup();
      } catch (error) {
        queue.fail(error);
        cleanup();
      }
    };
    const processChunk = () => {
      if (settled) return;
      const responseText = xhr.responseText ?? '';
      const chunk = responseText.slice(processedLength);
      processedLength = responseText.length;
      buffer += chunk;
      const parsed = parseSseFrames(buffer);
      buffer = parsed.remainder;
      for (const frame of parsed.frames) {
        const providerFrame = parseFrame(frame, pendingToolCalls);
        providerFrame.events.forEach((event) => {
          if (event.type === 'finish' && event.reason !== null) receivedFinishReason = true;
          queue.push(event);
        });
        if (providerFrame.done) {
          if (!receivedFinishReason) queue.push({ type: 'finish', reason: null });
          settled = true;
          xhr.abort();
          queue.close();
          cleanup();
          return;
        }
      }
    };

    controller.signal.addEventListener('abort', () => {
      if (!settled) xhr.abort();
    });
    xhr.open('POST', this.chatCompletionsUrl, true);
    xhr.timeout = this.requestTimeoutMs;
    xhr.setRequestHeader('Accept', 'text/event-stream');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', `Bearer ${this.options.apiKey}`);
    xhr.onprogress = () => {
      try {
        processChunk();
      } catch (error) {
        xhr.abort();
        fail(error);
      }
    };
    xhr.onload = () => {
      if (settled) return;
      if (xhr.status < 200 || xhr.status >= 300) {
        fail(new RemoteHostError('PROVIDER_REQUEST_FAILED', xhr.responseText?.slice(0, 512) || `Provider request failed with HTTP ${xhr.status}`, xhr.status));
        return;
      }
      try {
        processChunk();
        if (!settled) complete();
      } catch (error) {
        fail(error);
      }
    };
    xhr.onerror = () => fail(new RemoteHostError('NETWORK_ERROR', 'Unable to reach Provider'));
    xhr.ontimeout = () => fail(new RemoteHostError('PROVIDER_TIMEOUT', 'Provider request timed out'));
    xhr.onabort = () => {
      if (controller.signal.aborted) {
        fail(
          wasTimedOut()
            ? new RemoteHostError('PROVIDER_TIMEOUT', 'Provider request timed out')
            : new RemoteHostError('REQUEST_ABORTED', 'Provider request was cancelled'),
        );
      }
    };
    xhr.send(JSON.stringify({ ...request, stream: true }));
  }
}
