import type { RuntimeEvent } from '../runtime/conversationRuntime';
import {
  OpenAiStandardClient,
  type OpenAiMessage,
  type OpenAiModelRequest,
  type OpenAiTool,
} from './openAiStandardClient';
import type { OpenAiStandardProtocol } from './openAiStandardProtocol';

const SSE_SEPARATOR = String.fromCharCode(10, 10);
type SseFrame = Record<string, unknown> | '[DONE]';

export const sse = (...frames: SseFrame[]) =>
  frames
    .map((frame) =>
      `data: ${frame === '[DONE]' ? frame : JSON.stringify(frame)}${SSE_SEPARATOR}`
    )
    .join('');

export class FakeXhr {
  status = 200;
  responseText = '';
  timeout = 0;
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  requestBody: string | null = null;
  requestUrl: string | null = null;
  aborted = false;
  readonly headers: Record<string, string> = {};

  constructor(private readonly fixture: string) {}

  open(_method: string, url: string): void {
    this.requestUrl = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  send(body: string): void {
    this.requestBody = body;
    this.responseText = this.fixture;
    this.onprogress?.();
    this.onload?.();
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }
}

export class HangingXhr extends FakeXhr {
  constructor() {
    super('');
  }

  send(body: string): void {
    this.requestBody = body;
  }
}

export const collect = async (stream: AsyncIterable<RuntimeEvent>) => {
  const events: RuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
};

export const createClient = (
  protocol: OpenAiStandardProtocol,
  xhr: FakeXhr,
  baseUrl = 'https://provider.example.com',
) =>
  new OpenAiStandardClient({
    baseUrl,
    apiKey: 'secret',
    protocol,
    xhrFactory: () => xhr as unknown as XMLHttpRequest,
  });

const MODEL = 'model-1';

export const searchTool: OpenAiTool = {
  type: 'function',
  function: {
    name: 'search',
    description: 'Search',
    parameters: { type: 'object' },
  },
};

export const request = (
  content: string,
  options: {
    messages?: OpenAiMessage[];
    tools?: OpenAiTool[];
  } = {},
): OpenAiModelRequest => ({
  model: MODEL,
  messages: options.messages ?? [{ role: 'user', content }],
  ...(options.tools ? { tools: options.tools } : {}),
});

export const completedResponse = (
  output?: Array<Record<string, unknown>>,
): Record<string, unknown> => ({
  type: 'response.completed',
  response: {
    status: 'completed',
    ...(output !== undefined ? { output } : {}),
  },
});

export const outputItemDone = (
  outputIndex: number,
  item: Record<string, unknown>,
): Record<string, unknown> => ({
  type: 'response.output_item.done',
  output_index: outputIndex,
  item,
});

export const reasoningItem = (
  id: string,
  encryptedContent: string,
): Record<string, unknown> => ({
  id,
  type: 'reasoning',
  summary: [],
  encrypted_content: encryptedContent,
});

export const functionCallItem = (
  id: string,
  callId: string,
  argumentsJson: string,
): Record<string, unknown> => ({
  id,
  type: 'function_call',
  call_id: callId,
  name: 'search',
  arguments: argumentsJson,
  status: 'completed',
});

export const searchCallMessage = (
  callId: string,
  argumentsJson: string,
): OpenAiMessage => ({
  role: 'assistant',
  content: null,
  tool_calls: [{
    id: callId,
    type: 'function',
    function: { name: 'search', arguments: argumentsJson },
  }],
});

export const toolResultMessage = (
  callId: string,
  content: string,
): OpenAiMessage => ({
  role: 'tool',
  content,
  tool_call_id: callId,
});

export const interleavedToolTranscript = (
  toolName: string,
): OpenAiMessage[] => [
  {
    role: 'assistant',
    content: null,
    tool_calls: [{
      id: 'call-1',
      type: 'function',
      function: { name: toolName, arguments: '{}' },
    }],
  },
  { role: 'assistant', content: 'interleaved' },
  toolResultMessage('call-1', '{}'),
];

export const createQueuedResponsesClient = (xhrs: readonly FakeXhr[]) => {
  let xhrIndex = 0;
  return new OpenAiStandardClient({
    baseUrl: 'https://provider.example.com',
    apiKey: 'secret',
    protocol: 'openai-responses',
    xhrFactory: () => {
      const xhr = xhrs[xhrIndex];
      xhrIndex += 1;
      if (!xhr) throw new Error('Unexpected extra Responses request');
      return xhr as unknown as XMLHttpRequest;
    },
  });
};
