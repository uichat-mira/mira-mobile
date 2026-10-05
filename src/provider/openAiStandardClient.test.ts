import type { RuntimeEvent } from '../runtime/conversationRuntime';
import {
  OpenAiStandardClient,
  type OpenAiMessage,
} from './openAiStandardClient';
import type { OpenAiStandardProtocol } from './openAiStandardProtocol';

const SSE_SEPARATOR = String.fromCharCode(10, 10);
type SseFrame = Record<string, unknown> | '[DONE]';

const sse = (...frames: SseFrame[]) =>
  frames
    .map((frame) =>
      `data: ${frame === '[DONE]' ? frame : JSON.stringify(frame)}${SSE_SEPARATOR}`
    )
    .join('');

class FakeXhr {
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

class HangingXhr extends FakeXhr {
  constructor() {
    super('');
  }

  send(body: string): void {
    this.requestBody = body;
  }
}

const collect = async (stream: AsyncIterable<RuntimeEvent>) => {
  const events: RuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
};

const createClient = (
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

describe('OpenAiStandardClient Chat Completions', () => {
  it.each([
    ['https://provider.example.com', 'https://provider.example.com/v1/chat/completions'],
    ['https://provider.example.com/v1', 'https://provider.example.com/v1/chat/completions'],
    ['https://provider.example.com/v1/', 'https://provider.example.com/v1/chat/completions'],
  ])('uses only the standard endpoint for %s', async (baseUrl, expectedUrl) => {
    const xhr = new FakeXhr(
      sse(
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
        '[DONE]',
      ),
    );

    const stream = await createClient(
      'openai-chat-completions',
      xhr,
      baseUrl,
    ).streamMessages({
      model: 'model-1',
      messages: [{ role: 'user', content: 'hello' }],
    });

    await collect(stream);
    expect(xhr.requestUrl).toBe(expectedUrl);
  });

  it('rejects private or guessed Base URL paths', () => {
    expect(() =>
      createClient(
        'openai-chat-completions',
        new FakeXhr(''),
        'https://provider.example.com/api/v1',
      ),
    ).toThrow('API root or standard /v1 root');
  });

  it('streams text and standard indexed tool calls', async () => {
    const xhr = new FakeXhr(
      sse(
        { choices: [{ delta: { content: 'hello' } }] },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call-1',
                function: { name: 'search', arguments: '{"q":' },
              }],
            },
          }],
        },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: '"mira"}' },
              }],
            },
          }],
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        '[DONE]',
      ),
    );

    const stream = await createClient(
      'openai-chat-completions',
      xhr,
    ).streamMessages({
      model: 'model-1',
      messages: [{ role: 'user', content: 'find' }],
      tools: [{
        type: 'function',
        function: {
          name: 'search',
          description: 'Search',
          parameters: { type: 'object' },
        },
      }],
    });

    await expect(collect(stream)).resolves.toEqual([
      { type: 'text-delta', delta: 'hello' },
      {
        type: 'tool-call',
        callId: 'call-1',
        name: 'search',
        arguments: '{"q":"mira"}',
      },
      { type: 'finish', reason: 'tool_calls' },
    ]);

    expect(JSON.parse(xhr.requestBody ?? '{}')).toMatchObject({
      model: 'model-1',
      stream: true,
      messages: [{ role: 'user', content: 'find' }],
      tools: [{
        type: 'function',
        function: { name: 'search' },
      }],
    });
    expect(xhr.headers.Authorization).toBe('Bearer secret');
  });

  it('rejects a non-standard tool call delta without index', async () => {
    const xhr = new FakeXhr(
      sse({
        choices: [{
          delta: {
            tool_calls: [{
              id: 'call-private',
              function: { name: 'search', arguments: '{}' },
            }],
          },
        }],
      }),
    );

    const stream = await createClient(
      'openai-chat-completions',
      xhr,
    ).streamMessages({
      model: 'model-1',
      messages: [{ role: 'user', content: 'find' }],
    });

    await expect(collect(stream)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_EVENT',
    });
  });
});

describe('OpenAiStandardClient Responses', () => {
  it.each([
    ['https://provider.example.com', 'https://provider.example.com/v1/responses'],
    ['https://provider.example.com/v1', 'https://provider.example.com/v1/responses'],
  ])('uses only the standard endpoint for %s', async (baseUrl, expectedUrl) => {
    const xhr = new FakeXhr(
      sse({
        type: 'response.completed',
        response: { status: 'completed' },
      }),
    );

    const stream = await createClient(
      'openai-responses',
      xhr,
      baseUrl,
    ).streamMessages({
      model: 'model-1',
      messages: [{ role: 'user', content: 'hello' }],
    });

    await expect(collect(stream)).resolves.toEqual([
      { type: 'finish', reason: 'stop' },
    ]);
    expect(xhr.requestUrl).toBe(expectedUrl);
  });

  it('accepts a trailing SSE done sentinel after response.completed', async () => {
    const xhr = new FakeXhr(
      sse(
        {
          type: 'response.completed',
          response: { status: 'completed' },
        },
        '[DONE]',
      ),
    );

    const stream = await createClient(
      'openai-responses',
      xhr,
    ).streamMessages({
      model: 'model-1',
      messages: [{ role: 'user', content: 'hello' }],
    });

    await expect(collect(stream)).resolves.toEqual([
      { type: 'finish', reason: 'stop' },
    ]);
  });

  it('rejects a Responses stream that ends without a typed terminal event', async () => {
    const xhr = new FakeXhr(sse('[DONE]'));

    const stream = await createClient(
      'openai-responses',
      xhr,
    ).streamMessages({
      model: 'model-1',
      messages: [{ role: 'user', content: 'hello' }],
    });

    await expect(collect(stream)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_EVENT',
    });
  });

  it('streams output text and maps canonical transcript to Responses input items', async () => {
    const xhr = new FakeXhr(
      sse(
        {
          type: 'response.output_text.delta',
          item_id: 'msg-1',
          output_index: 0,
          content_index: 0,
          delta: 'hello',
        },
        {
          type: 'response.completed',
          response: { status: 'completed' },
        },
      ),
    );

    const messages: OpenAiMessage[] = [
      { role: 'system', content: 'be useful' },
      { role: 'user', content: 'question' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: { name: 'search', arguments: '{"q":"mira"}' },
        }],
      },
      { role: 'tool', content: '{"ok":true}', tool_call_id: 'call-1' },
      { role: 'assistant', content: 'previous answer' },
    ];

    const stream = await createClient(
      'openai-responses',
      xhr,
    ).streamMessages({
      model: 'model-1',
      messages,
    });

    await expect(collect(stream)).resolves.toEqual([
      { type: 'text-delta', delta: 'hello' },
      { type: 'finish', reason: 'stop' },
    ]);

    expect(JSON.parse(xhr.requestBody ?? '{}')).toEqual({
      model: 'model-1',
      stream: true,
      store: false,
      input: [
        { role: 'system', content: 'be useful' },
        { role: 'user', content: 'question' },
        {
          type: 'function_call',
          call_id: 'call-1',
          name: 'search',
          arguments: '{"q":"mira"}',
        },
        {
          type: 'function_call_output',
          call_id: 'call-1',
          output: '{"ok":true}',
        },
        { role: 'assistant', content: 'previous answer' },
      ],
    });
  });

  it('maps standard function-call streaming to the existing Agent lifecycle', async () => {
    const xhr = new FakeXhr(
      sse(
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: {
            id: 'fc-1',
            type: 'function_call',
            call_id: 'call-1',
            name: 'search',
            arguments: '',
            status: 'in_progress',
          },
        },
        {
          type: 'response.function_call_arguments.delta',
          item_id: 'fc-1',
          output_index: 0,
          delta: '{"q":',
        },
        {
          type: 'response.function_call_arguments.delta',
          item_id: 'fc-1',
          output_index: 0,
          delta: '"mira"}',
        },
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: {
            id: 'fc-1',
            type: 'function_call',
            call_id: 'call-1',
            name: 'search',
            arguments: '{"q":"mira"}',
            status: 'completed',
          },
        },
        {
          type: 'response.completed',
          response: { status: 'completed' },
        },
      ),
    );

    const stream = await createClient(
      'openai-responses',
      xhr,
    ).streamMessages({
      model: 'model-1',
      messages: [{ role: 'user', content: 'find' }],
      tools: [{
        type: 'function',
        function: {
          name: 'search',
          description: 'Search',
          parameters: { type: 'object' },
        },
      }],
    });

    await expect(collect(stream)).resolves.toEqual([
      {
        type: 'tool-call',
        callId: 'call-1',
        name: 'search',
        arguments: '{"q":"mira"}',
      },
      { type: 'finish', reason: 'tool_calls' },
    ]);

    expect(JSON.parse(xhr.requestBody ?? '{}')).toMatchObject({
      tools: [{
        type: 'function',
        name: 'search',
        description: 'Search',
        parameters: { type: 'object' },
      }],
    });
  });

  it('maps incomplete max-output termination to length', async () => {
    const xhr = new FakeXhr(
      sse({
        type: 'response.incomplete',
        response: {
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
        },
      }),
    );

    const stream = await createClient(
      'openai-responses',
      xhr,
    ).streamMessages({
      model: 'model-1',
      messages: [{ role: 'user', content: 'long answer' }],
    });

    await expect(collect(stream)).resolves.toEqual([
      { type: 'finish', reason: 'length' },
    ]);
  });

  it('surfaces a failed Responses event as a Provider error', async () => {
    const xhr = new FakeXhr(
      sse({
        type: 'response.failed',
        response: {
          status: 'failed',
          error: { message: 'model failed' },
        },
      }),
    );

    const stream = await createClient(
      'openai-responses',
      xhr,
    ).streamMessages({
      model: 'model-1',
      messages: [{ role: 'user', content: 'hello' }],
    });

    await expect(collect(stream)).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_FAILED',
      message: 'model failed',
    });
  });
});

describe('OpenAiStandardClient transport', () => {
  it('reports explicit cancellation', async () => {
    const xhr = new HangingXhr();
    const client = createClient('openai-responses', xhr);

    const stream = await client.streamMessages({
      model: 'model-1',
      messages: [{ role: 'user', content: 'hello' }],
    });
    const pending = collect(stream);
    await Promise.resolve();

    client.cancelActiveRun();

    await expect(pending).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
    expect(xhr.aborted).toBe(true);
  });

  it('reports timeout separately from cancellation', async () => {
    jest.useFakeTimers();
    try {
      const xhr = new HangingXhr();
      const client = new OpenAiStandardClient({
        baseUrl: 'https://provider.example.com',
        apiKey: 'secret',
        protocol: 'openai-chat-completions',
        requestTimeoutMs: 1000,
        xhrFactory: () => xhr as unknown as XMLHttpRequest,
      });

      const stream = await client.streamMessages({
        model: 'model-1',
        messages: [{ role: 'user', content: 'hello' }],
      });
      const pending = collect(stream);
      await jest.advanceTimersByTimeAsync(1000);

      await expect(pending).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('preserves HTTP status on Provider errors', async () => {
    const xhr = new FakeXhr('{"error":"bad key"}');
    xhr.status = 401;

    const stream = await createClient(
      'openai-chat-completions',
      xhr,
    ).streamMessages({
      model: 'model-1',
      messages: [{ role: 'user', content: 'hello' }],
    });

    await expect(collect(stream)).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_FAILED',
      status: 401,
    });
  });
});
