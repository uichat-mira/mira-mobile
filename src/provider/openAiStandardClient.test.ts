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

const MODEL = 'model-1';

const searchTool: OpenAiTool = {
  type: 'function',
  function: {
    name: 'search',
    description: 'Search',
    parameters: { type: 'object' },
  },
};

const request = (
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

const completedResponse = (
  output: Array<Record<string, unknown>> = [],
): Record<string, unknown> => ({
  type: 'response.completed',
  response: {
    status: 'completed',
    ...(output.length > 0 ? { output } : {}),
  },
});

const outputItemDone = (
  outputIndex: number,
  item: Record<string, unknown>,
): Record<string, unknown> => ({
  type: 'response.output_item.done',
  output_index: outputIndex,
  item,
});

const reasoningItem = (
  id: string,
  encryptedContent: string,
): Record<string, unknown> => ({
  id,
  type: 'reasoning',
  summary: [],
  encrypted_content: encryptedContent,
});

const functionCallItem = (
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

const searchCallMessage = (
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

const toolResultMessage = (
  callId: string,
  content: string,
): OpenAiMessage => ({
  role: 'tool',
  content,
  tool_call_id: callId,
});

const createQueuedResponsesClient = (xhrs: readonly FakeXhr[]) => {
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
    ).streamMessages(request('hello'));

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
    ).streamMessages(request('find', { tools: [searchTool] }));

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
    ).streamMessages(request('find'));

    await expect(collect(stream)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_EVENT',
    });
  });
});

  it('rejects a Chat Completions stream truncated during a tool call', async () => {
    const xhr = new FakeXhr(
      sse({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call-1',
              function: { name: 'search', arguments: '{"q":' },
            }],
          },
        }],
      }),
    );

    const stream = await createClient(
      'openai-chat-completions',
      xhr,
    ).streamMessages(request('find'));

    await expect(collect(stream)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_EVENT',
      message: 'Chat Completions stream ended during a tool call',
    });
  });

describe('OpenAiStandardClient Responses', () => {
  it('replays opaque reasoning output items across a Responses tool round', async () => {
    const reasoningItem = {
      id: 'rs-1',
      type: 'reasoning',
      summary: [],
      encrypted_content: 'opaque-reasoning',
    };
    const functionCallItem = {
      id: 'fc-1',
      type: 'function_call',
      call_id: 'call-1',
      name: 'search',
      arguments: '{"q":"mira"}',
      status: 'completed',
    };
    const firstXhr = new FakeXhr(
      sse(
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: reasoningItem,
        },
        {
          type: 'response.output_item.done',
          output_index: 1,
          item: functionCallItem,
        },
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            output: [reasoningItem, functionCallItem],
          },
        },
      ),
    );
    const secondXhr = new FakeXhr(
      sse({
        type: 'response.completed',
        response: { status: 'completed', output: [] },
      }),
    );
    const xhrs = [firstXhr, secondXhr];
    let xhrIndex = 0;
    const client = new OpenAiStandardClient({
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

    const firstStream = await client.streamMessages(request('find', { tools: [searchTool] }));
    await expect(collect(firstStream)).resolves.toEqual([
      {
        type: 'tool-call',
        callId: 'call-1',
        name: 'search',
        arguments: '{"q":"mira"}',
      },
      { type: 'finish', reason: 'tool_calls' },
    ]);

    const secondStream = await client.streamMessages({
      model: 'model-1',
      messages: [
        { role: 'user', content: 'find' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"mira"}' },
          }],
        },
        {
          role: 'tool',
          content: '{"result":"ok"}',
          tool_call_id: 'call-1',
        },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'search',
          parameters: { type: 'object' },
        },
      }],
    });
    await collect(secondStream);

    const secondRequest = JSON.parse(secondXhr.requestBody ?? '{}');
    expect(secondRequest.include).toEqual(['reasoning.encrypted_content']);
    expect(secondRequest.input).toEqual([
      { role: 'user', content: 'find' },
      reasoningItem,
      functionCallItem,
      {
        type: 'function_call_output',
        call_id: 'call-1',
        output: '{"result":"ok"}',
      },
    ]);
  });

  it('clears chat continuation before a later same-client consolidation request', async () => {
    const reasoningItem = {
      id: 'rs-chat',
      type: 'reasoning',
      summary: [],
      encrypted_content: 'chat-reasoning',
    };
    const functionCallItem = {
      id: 'fc-chat',
      type: 'function_call',
      call_id: 'call-chat',
      name: 'search',
      arguments: '{"q":"mira"}',
      status: 'completed',
    };
    const firstXhr = new FakeXhr(
      sse(
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: reasoningItem,
        },
        {
          type: 'response.output_item.done',
          output_index: 1,
          item: functionCallItem,
        },
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            output: [reasoningItem, functionCallItem],
          },
        },
      ),
    );
    const secondXhr = new FakeXhr(
      sse(
        {
          type: 'response.output_text.delta',
          output_index: 0,
          content_index: 0,
          delta: 'done',
        },
        {
          type: 'response.completed',
          response: { status: 'completed', output: [] },
        },
      ),
    );
    const consolidationXhr = new FakeXhr(
      sse({
        type: 'response.completed',
        response: { status: 'completed', output: [] },
      }),
    );
    const xhrs = [firstXhr, secondXhr, consolidationXhr];
    let xhrIndex = 0;
    const client = new OpenAiStandardClient({
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

    await collect(await client.streamMessages({
      model: 'model-1',
      messages: [{ role: 'user', content: 'find' }],
      tools: [{
        type: 'function',
        function: { name: 'search', parameters: { type: 'object' } },
      }],
    }));

    await collect(await client.streamMessages({
      model: 'model-1',
      messages: [
        { role: 'user', content: 'find' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call-chat',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"mira"}' },
          }],
        },
        {
          role: 'tool',
          content: '{"result":"ok"}',
          tool_call_id: 'call-chat',
        },
      ],
      tools: [{
        type: 'function',
        function: { name: 'search', parameters: { type: 'object' } },
      }],
    }));

    await collect(await client.streamMessages({
      model: 'model-1',
      messages: [
        { role: 'system', content: 'Consolidate memory.' },
        { role: 'user', content: 'Return JSON only.' },
      ],
    }));

    const consolidationInput =
      JSON.parse(consolidationXhr.requestBody ?? '{}').input;
    expect(consolidationInput).toEqual([
      { role: 'system', content: 'Consolidate memory.' },
      { role: 'user', content: 'Return JSON only.' },
    ]);
    expect(JSON.stringify(consolidationInput)).not.toContain('chat-reasoning');
    expect(JSON.stringify(consolidationInput)).not.toContain('call-chat');
  });

  it('drops a stale Responses continuation batch when canonical tool-call identity no longer matches', async () => {
    const reasoningItem = {
      id: 'rs-stale',
      type: 'reasoning',
      summary: [],
      encrypted_content: 'stale-reasoning',
    };
    const staleCall = {
      id: 'fc-stale',
      type: 'function_call',
      call_id: 'stale-call',
      name: 'search',
      arguments: '{"q":"old"}',
      status: 'completed',
    };
    const firstXhr = new FakeXhr(
      sse(
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: reasoningItem,
        },
        {
          type: 'response.output_item.done',
          output_index: 1,
          item: staleCall,
        },
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            output: [reasoningItem, staleCall],
          },
        },
      ),
    );
    const secondXhr = new FakeXhr(
      sse({
        type: 'response.completed',
        response: { status: 'completed', output: [] },
      }),
    );
    const xhrs = [firstXhr, secondXhr];
    let xhrIndex = 0;
    const client = new OpenAiStandardClient({
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

    await collect(await client.streamMessages(request('old request', { tools: [searchTool] })));

    await collect(await client.streamMessages({
      model: 'model-1',
      messages: [
        { role: 'user', content: 'replacement request' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'replacement-call',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"new"}' },
          }],
        },
        {
          role: 'tool',
          content: '{"result":"new"}',
          tool_call_id: 'replacement-call',
        },
      ],
    }));

    const secondInput = JSON.parse(secondXhr.requestBody ?? '{}').input;
    expect(secondInput).toEqual([
      { role: 'user', content: 'replacement request' },
      {
        type: 'function_call',
        call_id: 'replacement-call',
        name: 'search',
        arguments: '{"q":"new"}',
      },
      {
        type: 'function_call_output',
        call_id: 'replacement-call',
        output: '{"result":"new"}',
      },
    ]);
    expect(JSON.stringify(secondInput)).not.toContain('stale-reasoning');
    expect(JSON.stringify(secondInput)).not.toContain('stale-call');
  });

  it('surfaces standard Responses refusal deltas as visible assistant text', async () => {
    const xhr = new FakeXhr(
      sse(
        {
          type: 'response.refusal.delta',
          item_id: 'msg-1',
          output_index: 0,
          content_index: 0,
          delta: 'I cannot help with that.',
        },
        {
          type: 'response.completed',
          response: { status: 'completed', output: [] },
        },
      ),
    );

    const stream = await createClient(
      'openai-responses',
      xhr,
    ).streamMessages(request('request'));

    await expect(collect(stream)).resolves.toEqual([
      { type: 'text-delta', delta: 'I cannot help with that.' },
      { type: 'finish', reason: 'stop' },
    ]);
  });


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
    ).streamMessages(request('hello'));

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
    ).streamMessages(request('hello'));

    await expect(collect(stream)).resolves.toEqual([
      { type: 'finish', reason: 'stop' },
    ]);
  });

  it('rejects a Responses stream that ends without a typed terminal event', async () => {
    const xhr = new FakeXhr(sse('[DONE]'));

    const stream = await createClient(
      'openai-responses',
      xhr,
    ).streamMessages(request('hello'));

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
      include: ['reasoning.encrypted_content'],
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

  it('preserves mixed assistant text and multiple tool-call outputs in standard order', async () => {
    const xhr = new FakeXhr(
      sse({
        type: 'response.completed',
        response: { status: 'completed' },
      }),
    );

    const stream = await createClient(
      'openai-responses',
      xhr,
    ).streamMessages({
      model: 'model-1',
      messages: [
        { role: 'user', content: 'compare' },
        {
          role: 'assistant',
          content: 'I will check both.',
          tool_calls: [
            {
              id: 'call-a',
              type: 'function',
              function: { name: 'lookup', arguments: '{"id":"a"}' },
            },
            {
              id: 'call-b',
              type: 'function',
              function: { name: 'lookup', arguments: '{"id":"b"}' },
            },
          ],
        },
        { role: 'tool', content: '{"value":1}', tool_call_id: 'call-a' },
        { role: 'tool', content: '{"value":2}', tool_call_id: 'call-b' },
      ],
    });

    await collect(stream);

    expect(JSON.parse(xhr.requestBody ?? '{}').input).toEqual([
      { role: 'user', content: 'compare' },
      { role: 'assistant', content: 'I will check both.' },
      {
        type: 'function_call',
        call_id: 'call-a',
        name: 'lookup',
        arguments: '{"id":"a"}',
      },
      {
        type: 'function_call',
        call_id: 'call-b',
        name: 'lookup',
        arguments: '{"id":"b"}',
      },
      {
        type: 'function_call_output',
        call_id: 'call-a',
        output: '{"value":1}',
      },
      {
        type: 'function_call_output',
        call_id: 'call-b',
        output: '{"value":2}',
      },
    ]);
  });

  it('rejects an interleaved Responses transcript before opening the transport', async () => {
    const xhr = new HangingXhr();
    const client = createClient('openai-responses', xhr);

    await expect(
      client.streamMessages({
        model: 'model-1',
        messages: [
          {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call-1',
              type: 'function',
              function: { name: 'lookup', arguments: '{}' },
            }],
          },
          { role: 'assistant', content: 'interleaved' },
          { role: 'tool', content: '{}', tool_call_id: 'call-1' },
        ],
      }),
    ).rejects.toThrow(
      'Responses transcript has a function call without its tool output',
    );
    expect(xhr.requestUrl).toBeNull();
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
    ).streamMessages(request('find', { tools: [searchTool] }));

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
    ).streamMessages(request('long answer'));

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
    ).streamMessages(request('hello'));

    await expect(collect(stream)).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_FAILED',
      message: 'model failed',
    });
  });
});

describe('OpenAiStandardClient transport', () => {
  it('rejects insecure URLs outside development builds', () => {
    if (__DEV__) return;
    expect(
      () =>
        new OpenAiStandardClient({
          baseUrl: 'http://provider.example.com',
          apiKey: 'secret',
          protocol: 'openai-chat-completions',
        }),
    ).toThrow('HTTPS');
  });


  it('preempts an active Responses request before a replacement request fails transcript validation', async () => {
    const firstXhr = new HangingXhr();
    const xhrFactory = jest.fn(
      () => firstXhr as unknown as XMLHttpRequest,
    );
    const client = new OpenAiStandardClient({
      baseUrl: 'https://provider.example.com',
      apiKey: 'secret',
      protocol: 'openai-responses',
      xhrFactory,
    });

    const firstStream = await client.streamMessages({
      model: 'model-1',
      messages: [{ role: 'user', content: 'first' }],
    });
    const firstPending = collect(firstStream);
    await Promise.resolve();

    await expect(
      client.streamMessages({
        model: 'model-1',
        messages: [
          {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call-1',
              type: 'function',
              function: { name: 'search', arguments: '{}' },
            }],
          },
          { role: 'assistant', content: 'interleaved' },
          { role: 'tool', content: '{}', tool_call_id: 'call-1' },
        ],
      }),
    ).rejects.toThrow(
      'Responses transcript has a function call without its tool output',
    );

    expect(firstXhr.aborted).toBe(true);
    await expect(firstPending).rejects.toMatchObject({
      code: 'REQUEST_ABORTED',
    });
    expect(xhrFactory).toHaveBeenCalledTimes(1);
  });

  it('reports explicit cancellation', async () => {
    const xhr = new HangingXhr();
    const client = createClient('openai-responses', xhr);

    const stream = await client.streamMessages(request('hello'));
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
      const timeoutExpectation = expect(collect(stream)).rejects.toMatchObject({
        code: 'PROVIDER_TIMEOUT',
      });
      await jest.advanceTimersByTimeAsync(1000);

      await timeoutExpectation;
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
    ).streamMessages(request('hello'));

    await expect(collect(stream)).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_FAILED',
      status: 401,
    });
  });
});
