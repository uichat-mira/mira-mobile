import { OpenAiStandardClient } from './openAiStandardClient';
import {
  FakeXhr,
  HangingXhr,
  collect,
  interleavedToolTranscript,
  request,
} from './openAiStandardClientTestSupport';

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

    const firstStream = await client.streamMessages(request('first'));
    const firstPending = collect(firstStream);
    await Promise.resolve();

    await expect(
      client.streamMessages(
        request('invalid', {
          messages: interleavedToolTranscript('search'),
        }),
      ),
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
