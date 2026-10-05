import { RemoteHostError } from '../api/remoteHttp';
import type { RuntimeEvent } from '../runtime/conversationRuntime';
import {
  resolveOpenAiStandardEndpoint,
  type OpenAiStandardProtocol,
} from './openAiStandardProtocol';

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface OpenAiTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAiModelRequest {
  model: string;
  messages: OpenAiMessage[];
  tools?: OpenAiTool[];
  tool_choice?: 'auto' | 'none' | 'required';
}

export interface OpenAiStandardClientOptions {
  baseUrl: string;
  apiKey: string;
  protocol: OpenAiStandardProtocol;
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

  push(value: T): void {
    if (this.closed || this.failure) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value, done: false });
    } else {
      this.values.push(value);
    }
  }

  close(): void {
    if (this.closed || this.failure) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.resolve({ value: undefined, done: true });
    }
  }

  fail(error: unknown): void {
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
    return new Promise((resolve, reject) =>
      this.waiters.push({ resolve, reject }),
    );
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }
}

const parseSseFrames = (
  buffer: string,
): { frames: string[]; remainder: string } => {
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

const extractSseData = (frame: string): string =>
  frame
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /u, ''))
    .join('\n');

const parseJsonObject = (
  data: string,
  protocolName: string,
): Record<string, unknown> => {
  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch {
    throw new RemoteHostError(
      'INVALID_PROVIDER_EVENT',
      `${protocolName} returned invalid SSE JSON`,
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RemoteHostError(
      'INVALID_PROVIDER_EVENT',
      `${protocolName} SSE event must be an object`,
    );
  }
  return value as Record<string, unknown>;
};

interface PendingChatToolCall {
  id: string;
  name: string;
  arguments: string;
}

type PendingChatToolCalls = Map<number, PendingChatToolCall>;

const flushChatToolCalls = (
  pending: PendingChatToolCalls,
): RuntimeEvent[] => {
  const events = Array.from(pending.entries())
    .sort(([left], [right]) => left - right)
    .map(([, call]) => {
      if (!call.id || !call.name) {
        throw new RemoteHostError(
          'INVALID_PROVIDER_EVENT',
          'Chat Completions returned an incomplete tool call',
        );
      }
      return {
        type: 'tool-call' as const,
        callId: call.id,
        name: call.name,
        arguments: call.arguments,
      };
    });
  pending.clear();
  return events;
};

interface ProtocolFrameResult {
  events: RuntimeEvent[];
  done: boolean;
}

interface ChatStreamState {
  pendingToolCalls: PendingChatToolCalls;
  receivedFinishReason: boolean;
}

const parseChatCompletionsFrame = (
  data: string,
  state: ChatStreamState,
): ProtocolFrameResult => {
  if (!data) return { events: [], done: false };
  if (data === '[DONE]') {
    const events = flushChatToolCalls(state.pendingToolCalls);
    if (!state.receivedFinishReason) {
      events.push({ type: 'finish', reason: null });
    }
    return { events, done: true };
  }

  const value = parseJsonObject(data, 'Chat Completions');
  const choices = value.choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') {
    return { events: [], done: false };
  }

  const item = choices[0] as Record<string, unknown>;
  const events: RuntimeEvent[] = [];
  const delta = item.delta;

  if (delta && typeof delta === 'object' && !Array.isArray(delta)) {
    const deltaRecord = delta as Record<string, unknown>;
    if (
      typeof deltaRecord.content === 'string' &&
      deltaRecord.content.length > 0
    ) {
      events.push({ type: 'text-delta', delta: deltaRecord.content });
    }

    if (Array.isArray(deltaRecord.tool_calls)) {
      for (const call of deltaRecord.tool_calls) {
        if (!call || typeof call !== 'object' || Array.isArray(call)) continue;
        const record = call as Record<string, unknown>;
        if (
          typeof record.index !== 'number' ||
          !Number.isInteger(record.index) ||
          record.index < 0
        ) {
          throw new RemoteHostError(
            'INVALID_PROVIDER_EVENT',
            'Chat Completions tool call delta is missing a standard index',
          );
        }

        const functionValue = record.function;
        const fn =
          functionValue &&
          typeof functionValue === 'object' &&
          !Array.isArray(functionValue)
            ? (functionValue as Record<string, unknown>)
            : null;
        const previous = state.pendingToolCalls.get(record.index) ?? {
          id: '',
          name: '',
          arguments: '',
        };
        state.pendingToolCalls.set(record.index, {
          id: typeof record.id === 'string' ? record.id : previous.id,
          name: fn && typeof fn.name === 'string' ? fn.name : previous.name,
          arguments:
            previous.arguments +
            (fn && typeof fn.arguments === 'string' ? fn.arguments : ''),
        });
      }
    }
  }

  if (typeof item.finish_reason === 'string') {
    events.push(...flushChatToolCalls(state.pendingToolCalls));
    state.receivedFinishReason = true;
    events.push({ type: 'finish', reason: item.finish_reason });
  }

  return { events, done: false };
};

interface PendingResponseToolCall {
  callId: string;
  name: string;
  arguments: string;
  emitted: boolean;
}

interface ResponsesStreamState {
  pendingToolCalls: Map<number, PendingResponseToolCall>;
  sawToolCall: boolean;
}

const responseToolCallFromItem = (
  item: Record<string, unknown>,
): PendingResponseToolCall | null => {
  if (item.type !== 'function_call') return null;
  if (
    typeof item.call_id !== 'string' ||
    typeof item.name !== 'string' ||
    typeof item.arguments !== 'string'
  ) {
    throw new RemoteHostError(
      'INVALID_PROVIDER_EVENT',
      'Responses API returned an incomplete function call item',
    );
  }
  return {
    callId: item.call_id,
    name: item.name,
    arguments: item.arguments,
    emitted: false,
  };
};

const flushResponseToolCall = (
  state: ResponsesStreamState,
  outputIndex: number,
): RuntimeEvent[] => {
  const call = state.pendingToolCalls.get(outputIndex);
  if (!call || call.emitted) return [];
  if (!call.callId || !call.name) {
    throw new RemoteHostError(
      'INVALID_PROVIDER_EVENT',
      'Responses API returned an incomplete function call',
    );
  }
  call.emitted = true;
  state.sawToolCall = true;
  return [{
    type: 'tool-call',
    callId: call.callId,
    name: call.name,
    arguments: call.arguments,
  }];
};

const responseOutputIndex = (
  value: Record<string, unknown>,
  eventType: string,
): number => {
  if (
    typeof value.output_index !== 'number' ||
    !Number.isInteger(value.output_index) ||
    value.output_index < 0
  ) {
    throw new RemoteHostError(
      'INVALID_PROVIDER_EVENT',
      `${eventType} is missing output_index`,
    );
  }
  return value.output_index;
};

const parseResponsesFrame = (
  data: string,
  state: ResponsesStreamState,
): ProtocolFrameResult => {
  if (!data) return { events: [], done: false };
  if (data === '[DONE]') {
    throw new RemoteHostError(
      'INVALID_PROVIDER_EVENT',
      'Responses API must terminate with a typed response event',
    );
  }

  const value = parseJsonObject(data, 'Responses API');
  const type = value.type;
  if (typeof type !== 'string') {
    throw new RemoteHostError(
      'INVALID_PROVIDER_EVENT',
      'Responses API event is missing type',
    );
  }

  if (type === 'response.output_text.delta') {
    if (typeof value.delta !== 'string') {
      throw new RemoteHostError(
        'INVALID_PROVIDER_EVENT',
        'Responses API text delta is invalid',
      );
    }
    return {
      events: value.delta
        ? [{ type: 'text-delta', delta: value.delta }]
        : [],
      done: false,
    };
  }

  if (type === 'response.output_item.added') {
    const index = responseOutputIndex(value, type);
    const item = value.item;
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const call = responseToolCallFromItem(item as Record<string, unknown>);
      if (call) state.pendingToolCalls.set(index, call);
    }
    return { events: [], done: false };
  }

  if (type === 'response.function_call_arguments.delta') {
    const index = responseOutputIndex(value, type);
    if (typeof value.delta !== 'string') {
      throw new RemoteHostError(
        'INVALID_PROVIDER_EVENT',
        'Responses API function arguments delta is invalid',
      );
    }
    const current = state.pendingToolCalls.get(index);
    if (!current) {
      throw new RemoteHostError(
        'INVALID_PROVIDER_EVENT',
        'Responses API function arguments arrived before the function call item',
      );
    }
    current.arguments += value.delta;
    return { events: [], done: false };
  }

  if (type === 'response.function_call_arguments.done') {
    const index = responseOutputIndex(value, type);
    const current = state.pendingToolCalls.get(index);
    if (!current) {
      throw new RemoteHostError(
        'INVALID_PROVIDER_EVENT',
        'Responses API function arguments completed before the function call item',
      );
    }
    if (typeof value.arguments === 'string') {
      current.arguments = value.arguments;
    }
    return { events: [], done: false };
  }

  if (type === 'response.output_item.done') {
    const index = responseOutputIndex(value, type);
    const item = value.item;
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const finalCall = responseToolCallFromItem(
        item as Record<string, unknown>,
      );
      if (finalCall) {
        state.pendingToolCalls.set(index, finalCall);
        return {
          events: flushResponseToolCall(state, index),
          done: false,
        };
      }
    }
    return { events: [], done: false };
  }

  if (type === 'response.completed') {
    const events: RuntimeEvent[] = [];
    for (const index of state.pendingToolCalls.keys()) {
      events.push(...flushResponseToolCall(state, index));
    }
    events.push({
      type: 'finish',
      reason: state.sawToolCall ? 'tool_calls' : 'stop',
    });
    return { events, done: true };
  }

  if (type === 'response.incomplete') {
    const response = value.response;
    let reason: string | null = null;
    if (response && typeof response === 'object' && !Array.isArray(response)) {
      const details = (response as Record<string, unknown>).incomplete_details;
      if (details && typeof details === 'object' && !Array.isArray(details)) {
        const rawReason = (details as Record<string, unknown>).reason;
        if (typeof rawReason === 'string') {
          reason = rawReason === 'max_output_tokens' ? 'length' : rawReason;
        }
      }
    }
    return {
      events: [{ type: 'finish', reason }],
      done: true,
    };
  }

  if (type === 'response.failed' || type === 'error') {
    const response = value.response;
    const responseError =
      response && typeof response === 'object' && !Array.isArray(response)
        ? (response as Record<string, unknown>).error
        : null;
    const message =
      responseError &&
      typeof responseError === 'object' &&
      !Array.isArray(responseError) &&
      typeof (responseError as Record<string, unknown>).message === 'string'
        ? String((responseError as Record<string, unknown>).message)
        : typeof value.message === 'string'
          ? value.message
          : 'Responses API request failed';
    throw new RemoteHostError('PROVIDER_REQUEST_FAILED', message);
  }

  return { events: [], done: false };
};

const toResponsesInput = (
  messages: readonly OpenAiMessage[],
): Array<Record<string, unknown>> => {
  const input: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === 'tool') {
      if (!message.tool_call_id) {
        throw new Error('Tool result is missing tool_call_id');
      }
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: message.content ?? '',
      });
      continue;
    }

    if (message.content !== null && message.content.length > 0) {
      input.push({
        role: message.role,
        content: message.content,
      });
    }

    if (message.role === 'assistant' && message.tool_calls) {
      for (const call of message.tool_calls) {
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        });
      }
    }

    if (
      message.content === null &&
      (!message.tool_calls || message.tool_calls.length === 0)
    ) {
      input.push({ role: message.role, content: '' });
    }
  }

  return input;
};

const toResponsesTools = (
  tools: readonly OpenAiTool[],
): Array<Record<string, unknown>> =>
  tools.map((tool) => ({
    type: 'function',
    name: tool.function.name,
    ...(tool.function.description
      ? { description: tool.function.description }
      : {}),
    parameters: tool.function.parameters,
  }));

const buildWireRequest = (
  protocol: OpenAiStandardProtocol,
  request: OpenAiModelRequest,
): Record<string, unknown> => {
  if (protocol === 'openai-responses') {
    return {
      model: request.model,
      input: toResponsesInput(request.messages),
      stream: true,
      store: false,
      ...(request.tools && request.tools.length > 0
        ? { tools: toResponsesTools(request.tools) }
        : {}),
      ...(request.tool_choice ? { tool_choice: request.tool_choice } : {}),
    };
  }

  return {
    model: request.model,
    messages: request.messages,
    stream: true,
    ...(request.tools && request.tools.length > 0
      ? { tools: request.tools }
      : {}),
    ...(request.tool_choice ? { tool_choice: request.tool_choice } : {}),
  };
};

export class OpenAiStandardClient {
  private readonly endpointUrl: string;
  private readonly xhrFactory: () => XMLHttpRequest;
  private readonly requestTimeoutMs: number;
  private activeAbort: AbortController | null = null;

  constructor(private readonly options: OpenAiStandardClientOptions) {
    this.endpointUrl = resolveOpenAiStandardEndpoint(
      options.baseUrl,
      options.protocol,
    );
    const parsed = new URL(this.endpointUrl);
    if (parsed.protocol !== 'https:' && !__DEV__) {
      throw new RemoteHostError(
        'INSECURE_PROVIDER_URL',
        'Provider must use HTTPS outside development builds',
      );
    }
    this.xhrFactory = options.xhrFactory ?? (() => new XMLHttpRequest());
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
  }

  async streamMessages(
    request: OpenAiModelRequest,
  ): Promise<AsyncIterable<RuntimeEvent>> {
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
          : new RemoteHostError(
              'REQUEST_ABORTED',
              'Provider request was cancelled',
            ),
      );
      cleanup();
    });

    void this.consumeStream(
      request,
      controller,
      queue,
      () => timedOut,
      cleanup,
    );
    return queue;
  }

  cancelActiveRun(): void {
    this.activeAbort?.abort();
    this.activeAbort = null;
  }

  private async consumeStream(
    request: OpenAiModelRequest,
    controller: AbortController,
    queue: AsyncPushQueue<RuntimeEvent>,
    wasTimedOut: () => boolean,
    cleanup: () => void,
  ): Promise<void> {
    const xhr = this.xhrFactory();
    let processedLength = 0;
    let buffer = '';
    let settled = false;

    const chatState: ChatStreamState = {
      pendingToolCalls: new Map(),
      receivedFinishReason: false,
    };
    const responsesState: ResponsesStreamState = {
      pendingToolCalls: new Map(),
      sawToolCall: false,
    };

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      queue.fail(error);
      cleanup();
    };

    const processFrame = (frame: string): ProtocolFrameResult => {
      const data = extractSseData(frame);
      return this.options.protocol === 'openai-responses'
        ? parseResponsesFrame(data, responsesState)
        : parseChatCompletionsFrame(data, chatState);
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
        const result = processFrame(frame);
        result.events.forEach((event) => queue.push(event));
        if (result.done) {
          settled = true;
          xhr.abort();
          queue.close();
          cleanup();
          return;
        }
      }
    };

    const complete = () => {
      if (settled) return;
      try {
        buffer += (xhr.responseText ?? '').slice(processedLength);
        const parsed = parseSseFrames(buffer);
        buffer = parsed.remainder;
        for (const frame of parsed.frames) {
          const result = processFrame(frame);
          result.events.forEach((event) => queue.push(event));
          if (result.done) {
            settled = true;
            queue.close();
            cleanup();
            return;
          }
        }
        if (buffer.trim()) {
          const result = processFrame(buffer);
          result.events.forEach((event) => queue.push(event));
          if (result.done) {
            settled = true;
            queue.close();
            cleanup();
            return;
          }
        }

        if (this.options.protocol === 'openai-responses') {
          throw new RemoteHostError(
            'INVALID_PROVIDER_EVENT',
            'Responses API stream ended without a terminal response event',
          );
        }

        if (!chatState.receivedFinishReason) {
          queue.push({ type: 'finish', reason: null });
        }
        settled = true;
        queue.close();
        cleanup();
      } catch (error) {
        fail(error);
      }
    };

    controller.signal.addEventListener('abort', () => {
      if (!settled) xhr.abort();
    });

    xhr.open('POST', this.endpointUrl, true);
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
        fail(
          new RemoteHostError(
            'PROVIDER_REQUEST_FAILED',
            xhr.responseText?.slice(0, 512) ||
              `Provider request failed with HTTP ${xhr.status}`,
            xhr.status,
          ),
        );
        return;
      }
      try {
        processChunk();
        if (!settled) complete();
      } catch (error) {
        fail(error);
      }
    };
    xhr.onerror = () =>
      fail(new RemoteHostError('NETWORK_ERROR', 'Unable to reach Provider'));
    xhr.ontimeout = () =>
      fail(new RemoteHostError('PROVIDER_TIMEOUT', 'Provider request timed out'));
    xhr.onabort = () => {
      if (controller.signal.aborted) {
        fail(
          wasTimedOut()
            ? new RemoteHostError(
                'PROVIDER_TIMEOUT',
                'Provider request timed out',
              )
            : new RemoteHostError(
                'REQUEST_ABORTED',
                'Provider request was cancelled',
              ),
        );
      }
    };

    xhr.send(JSON.stringify(buildWireRequest(this.options.protocol, request)));
  }
}
