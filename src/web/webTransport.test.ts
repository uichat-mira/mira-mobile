import { NativeModules } from 'react-native';
import { isNativeWebTransportAvailable, nativeWebTransport, WebTransportError } from './webTransport';

interface FetchOptions {
  requestId: string;
  url: string;
  maxBytes: number;
  timeoutMs: number;
}

const install = (fetch: jest.Mock, cancel: jest.Mock = jest.fn()) => {
  (NativeModules as unknown as Record<string, unknown>).MiraWebFetcher = { fetch, cancel };
};

const valid = (options: FetchOptions) => ({
  status: 200,
  finalUrl: options.url,
  contentType: 'text/html',
  body: '<html></html>',
  truncated: false,
  redirectCount: 0,
});

describe('native web transport', () => {
  afterEach(() => {
    delete (NativeModules as unknown as Record<string, unknown>).MiraWebFetcher;
  });

  it('reports availability only when the native module is present', () => {
    expect(isNativeWebTransportAvailable()).toBe(false);
    install(jest.fn());
    expect(isNativeWebTransportAvailable()).toBe(true);
  });

  it('passes strict limits and a fresh request id to the platform', async () => {
    const fetch = jest.fn(async (options: FetchOptions) => valid(options));
    install(fetch);

    const response = await nativeWebTransport.fetch({
      url: 'https://example.com/page#fragment',
      maxBytes: 1024,
      timeoutMs: 30000,
    });

    expect(fetch).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^web-\d+-\d+$/u),
      url: 'https://example.com/page',
      maxBytes: 1024,
      timeoutMs: 30000,
    });
    expect(response).toMatchObject({ finalUrl: 'https://example.com/page', status: 200 });
  });

  it('cancels the native call and rejects when the Agent aborts', async () => {
    const cancel = jest.fn();
    const resolver: { resolve?: (value: unknown) => void } = {};
    const fetch = jest.fn((_options: FetchOptions) => new Promise(resolve => {
      resolver.resolve = resolve;
    }));
    install(fetch, cancel);

    const controller = new AbortController();
    const removeListener = jest.spyOn(controller.signal, 'removeEventListener');
    const pending = nativeWebTransport.fetch({
      url: 'https://example.com/slow',
      maxBytes: 1024,
      timeoutMs: 30000,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    expect(cancel).toHaveBeenCalledTimes(1);
    resolver.resolve?.(valid({
      requestId: 'web-1-1',
      url: 'https://example.com/slow',
      maxBytes: 1024,
      timeoutMs: 30000,
    }));
    await expect(pending).rejects.toMatchObject({ code: 'WEB_CANCELLED' });
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('refuses a non-public URL before invoking the native module', async () => {
    const fetch = jest.fn();
    install(fetch);
    await expect(nativeWebTransport.fetch({
      url: 'http://169.254.169.254/latest/meta-data',
      maxBytes: 1024,
      timeoutMs: 30000,
    })).rejects.toBeInstanceOf(WebTransportError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('defensively rejects a non-public final URL reported by native code', async () => {
    install(jest.fn(async () => ({
      status: 200,
      finalUrl: 'http://127.0.0.1/admin',
      contentType: 'text/html',
      body: 'secret',
      truncated: false,
      redirectCount: 1,
    })));
    await expect(nativeWebTransport.fetch({
      url: 'https://example.com/',
      maxBytes: 1024,
      timeoutMs: 30000,
    })).rejects.toMatchObject({ code: 'WEB_REDIRECT_FORBIDDEN' });
  });

  it('preserves native error codes and rejects malformed responses', async () => {
    install(jest.fn(async () => {
      throw { code: 'WEB_RESPONSE_TOO_LARGE', message: 'too large' };
    }));
    await expect(nativeWebTransport.fetch({
      url: 'https://example.com/',
      maxBytes: 1024,
      timeoutMs: 30000,
    })).rejects.toMatchObject({ code: 'WEB_RESPONSE_TOO_LARGE' });

    install(jest.fn(async () => ({ status: '200' })));
    await expect(nativeWebTransport.fetch({
      url: 'https://example.com/',
      maxBytes: 1024,
      timeoutMs: 30000,
    })).rejects.toMatchObject({ code: 'WEB_UPSTREAM_FAILED' });
  });

  it('fails clearly when the native module is missing', async () => {
    await expect(nativeWebTransport.fetch({
      url: 'https://example.com/',
      maxBytes: 1024,
      timeoutMs: 30000,
    })).rejects.toMatchObject({ code: 'WEB_TRANSPORT_UNAVAILABLE' });
  });
});
