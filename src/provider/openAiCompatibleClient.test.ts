import type { RuntimeEvent } from '../runtime/conversationRuntime';
import { OpenAiCompatibleClient } from './openAiCompatibleClient';

const SSE_SEPARATOR = String.fromCharCode(10, 10);
type SseFrame = Record<string, unknown> | '[DONE]';

const sse = (...frames: SseFrame[]) =>
  frames
    .map((frame) => `data: ${frame === '[DONE]' ? frame : JSON.stringify(frame)}${SSE_SEPARATOR}`)
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

  constructor(private readonly fixture = sse('[DONE]')) {}

  open(_method: string, url: string) {
    this.requestUrl = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(body: string) {
    this.requestBody = body;
    this.responseText = this.fixture;
    this.onprogress?.();
    this.onload?.();
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

class HangingXhr extends FakeXhr {
  send(body: string) {
    this.requestBody = body;
  }
}

const collect = async (stream: AsyncIterable<RuntimeEvent>) => {
  const events: RuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
};

const createClient = (xhr: FakeXhr, baseUrl = 'https://provider.example.com') =>
  new OpenAiCompatibleClient({
    baseUrl,
    apiKey: 'secret',
    xhrFactory: () => xhr as unknown as XMLHttpRequest,
  });

describe('OpenAiCompatibleClient', () => {
  it.each([
    ['https://provider.example.com', 'https://provider.example.com/v1/chat/completions'],
    ['https://provider.example.com/v1', 'https://provider.example.com/v1/chat/completions'],
    ['https://provider.example.com/api/v1/', 'https://provider.example.com/api/v1/chat/completions'],
  ])('resolves %s to the Chat Completions endpoint', async (baseUrl, expectedUrl) => {
    const xhr = new FakeXhr();
    const stream = await createClient(xhr, baseUrl).streamChat({
      model: 'model-1',
      messages: [{ role: 'user', content: 'hello' }],
    });

    await collect(stream);
    expect(xhr.requestUrl).toBe(expectedUrl);
  });

  it('preserves finish_reason when [DONE] closes a normal text stream', async () => {
    const xhr = new FakeXhr(
      sse(
        { choices: [{ delta: { content: 'hello' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
        '[DONE]',
      ),
    );
    const client = createClient(xhr);

    const stream = await client.streamChat({
      model: 'model-1',
      messages: [{ role: 'user', content: 'hello' }],
    });

    await expect(collect(stream)).resolves.toEqual([
      { type: 'text-delta', delta: 'hello' },
      { type: 'finish', reason: 'stop' },
    ]);
    expect(JSON.parse(xhr.requestBody ?? '{}')).toMatchObject({ model: 'model-1', stream: true });
    expect(xhr.headers.Authorization).toBe('Bearer secret');
  });

  it('keeps the legacy null finish fallback when a provider sends only [DONE]', async () => {
    const stream = await createClient(new FakeXhr()).streamChat({
      model: 'model-1',
      messages: [{ role: 'user', content: 'hello' }],
    });

    await expect(collect(stream)).resolves.toEqual([{ type: 'finish', reason: null }]);
  });

  it('preserves tool_calls finish semantics through [DONE]', async () => {
    const xhr = new FakeXhr(
      sse(
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call-1',
                function: { name: 'search', arguments: '{}' },
              }],
            },
          }],
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        '[DONE]',
      ),
    );

    const stream = await createClient(xhr).streamChat({
      model: 'model-1',
      messages: [{ role: 'user', content: 'find' }],
    });

    await expect(collect(stream)).resolves.toEqual([
      { type: 'tool-call', callId: 'call-1', name: 'search', arguments: '{}' },
      { type: 'finish', reason: 'tool_calls' },
    ]);
  });

  it('aggregates interleaved tool call fragments by protocol index', async () => {
    const xhr = new FakeXhr(
      sse(
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call-0',
                function: { name: 'search', arguments: '{"q":' },
              }],
            },
          }],
        },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 1,
                id: 'call-1',
                function: { name: 'weather', arguments: '{"city":' },
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
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 1,
                function: { arguments: '"Sydney"}' },
              }],
            },
          }],
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        '[DONE]',
      ),
    );

    const stream = await createClient(xhr).streamChat({
      model: 'model-1',
      messages: [{ role: 'user', content: 'compare' }],
    });

    await expect(collect(stream)).resolves.toEqual([
      { type: 'tool-call', callId: 'call-0', name: 'search', arguments: '{"q":"mira"}' },
      { type: 'tool-call', callId: 'call-1', name: 'weather', arguments: '{"city":"Sydney"}' },
      { type: 'finish', reason: 'tool_calls' },
    ]);
  });

  it('retains an id-only tool fragment until the function fields arrive', async () => {
    const xhr = new FakeXhr(
      sse(
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call-split',
              }],
            },
          }],
        },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { name: 'search', arguments: '{"q":"mira"}' },
              }],
            },
          }],
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        '[DONE]',
      ),
    );

    const stream = await createClient(xhr).streamChat({
      model: 'model-1',
      messages: [{ role: 'user', content: 'find' }],
    });

    await expect(collect(stream)).resolves.toEqual([
      { type: 'tool-call', callId: 'call-split', name: 'search', arguments: '{"q":"mira"}' },
      { type: 'finish', reason: 'tool_calls' },
    ]);
  });

  it('falls back to the fragment array position when tool call index is omitted', async () => {
    const xhr = new FakeXhr(
      sse(
        {
          choices: [{
            delta: {
              tool_calls: [{
                id: 'call-1',
                function: { name: 'search', arguments: '{}' },
              }],
            },
          }],
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        '[DONE]',
      ),
    );

    const stream = await createClient(xhr).streamChat({
      model: 'model-1',
      messages: [{ role: 'user', content: 'find' }],
    });

    await expect(collect(stream)).resolves.toEqual([
      { type: 'tool-call', callId: 'call-1', name: 'search', arguments: '{}' },
      { type: 'finish', reason: 'tool_calls' },
    ]);
  });

  it('rejects insecure URLs outside development through the shared URL policy', () => {
    if (__DEV__) return;
    expect(
      () => new OpenAiCompatibleClient({ baseUrl: 'http://provider.example.com', apiKey: 'secret' }),
    ).toThrow('HTTPS');
  });

  it('reports an explicit cancellation when the active request is cancelled', async () => {
    const xhr = new HangingXhr();
    const client = createClient(xhr);

    const stream = await client.streamChat({
      model: 'model-1',
      messages: [{ role: 'user', content: 'hello' }],
    });
    const pending = collect(stream);
    await Promise.resolve();
    client.cancelActiveRun();

    await pending.catch((error) => {
      expect(error).toMatchObject({ code: 'REQUEST_ABORTED' });
    });
  });

  it('reports a timeout separately from user cancellation', async () => {
    jest.useFakeTimers();
    try {
      const xhr = new HangingXhr();
      const client = new OpenAiCompatibleClient({
        baseUrl: 'https://provider.example.com',
        apiKey: 'secret',
        requestTimeoutMs: 1000,
        xhrFactory: () => xhr as unknown as XMLHttpRequest,
      });

      const stream = await client.streamChat({
        model: 'model-1',
        messages: [{ role: 'user', content: 'hello' }],
      });
      const pending = collect(stream).catch((error) => {
        expect(error).toMatchObject({ code: 'PROVIDER_TIMEOUT' });
      });
      await jest.advanceTimersByTimeAsync(1000);

      await pending;
    } finally {
      jest.useRealTimers();
    }
  });
});
