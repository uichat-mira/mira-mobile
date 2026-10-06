import {
  FakeXhr,
  collect,
  createClient,
  request,
  searchTool,
  sse,
} from './openAiStandardClientTestSupport';

const collectChatFrame = async (frame: Record<string, unknown>) =>
  collect(
    await createClient(
      'openai-chat-completions',
      new FakeXhr(sse(frame)),
    ).streamMessages(request('find')),
  );

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
    await expect(
      collectChatFrame({
        choices: [{
          delta: {
            tool_calls: [{
              id: 'call-private',
              function: { name: 'search', arguments: '{}' },
            }],
          },
        }],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PROVIDER_EVENT' });
  });

  it('rejects a Chat Completions stream truncated during a tool call', async () => {
    await expect(
      collectChatFrame({
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
    ).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_EVENT',
      message: 'Chat Completions stream ended during a tool call',
    });
  });

});
