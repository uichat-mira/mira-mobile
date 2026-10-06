import type { OpenAiMessage } from './openAiStandardClient';
import {
  FakeXhr,
  HangingXhr,
  collect,
  completedResponse,
  createClient,
  interleavedToolTranscript,
  request,
  searchTool,
  sse,
} from './openAiStandardClientTestSupport';

describe('OpenAiStandardClient Responses', () => {
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
        completedResponse([]),
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
      sse(completedResponse()),
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
        completedResponse(),
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
        completedResponse(),
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
      sse(completedResponse()),
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
      client.streamMessages(
        request('invalid', {
          messages: interleavedToolTranscript('lookup'),
        }),
      ),
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
        completedResponse(),
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
