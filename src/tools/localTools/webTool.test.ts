import { createWebTool } from './webTool';
import { WebTransportError, type WebFetchResponse, type WebTransport } from '../../web/webTransport';

const response = (overrides: Partial<WebFetchResponse> = {}): WebFetchResponse => ({
  status: 200,
  finalUrl: 'https://example.com/article',
  contentType: 'text/html; charset=utf-8',
  body: '<html><head><title>Example</title></head><body><main><p>' +
    'A sufficiently long readable paragraph with useful information and context. '.repeat(4) +
    '</p><p><a href="../next">Next page</a> <a href="https://other.example.org/x">Other</a></p>' +
    '</main></body></html>',
  truncated: false,
  redirectCount: 0,
  ...overrides,
});

const toolWith = (fetch: jest.Mock) => createWebTool({ fetch } as WebTransport);

const call = async (
  tool: ReturnType<typeof createWebTool>,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => {
  const result = await tool.call(args, signal ? { signal } : {});
  return JSON.parse(result.content) as Record<string, unknown>;
};

describe('local web(url) tool', () => {
  it('manifests exactly one required URL and no search/provider mode', () => {
    const tool = createWebTool({ fetch: jest.fn() });
    expect(tool.manifest.name).toBe('web');
    expect(tool.manifest.requiresApproval).toBe(false);
    expect(tool.manifest.parameters).toMatchObject({
      type: 'object',
      required: ['url'],
      properties: { url: { type: 'string' } },
      additionalProperties: false,
    });
    expect(tool.manifest.parameters.properties).not.toHaveProperty('query');
    expect(tool.manifest.parameters.properties).not.toHaveProperty('mode');
    expect(tool.manifest.parameters.properties).not.toHaveProperty('provider');
    expect(tool.manifest.description).toContain('搜索引擎');
  });

  it('validates and executes a public URL with bounded transport options', async () => {
    const fetch = jest.fn(async () => response());
    const result = await call(toolWith(fetch), {
      url: 'https://example.com/article#ignored',
    });

    expect(fetch).toHaveBeenCalledWith({
      url: 'https://example.com/article',
      maxBytes: 1_048_576,
      timeoutMs: 30_000,
    });
    expect(result).toMatchObject({
      marker: 'UNTRUSTED_WEB_CONTENT',
      requestedUrl: 'https://example.com/article',
      finalUrl: 'https://example.com/article',
      httpStatus: 200,
      title: 'Example',
      truncated: false,
      downloadLimitBytes: 1_048_576,
      resultLimitBytes: 16_384,
    });
    expect(result.content).toContain('A sufficiently long readable paragraph');
    expect(result.content).toContain('https://example.com/next');
    expect(result.links).toContainEqual({
      text: 'Next page',
      url: 'https://example.com/next',
    });
  });

  it('uses the final URL for relative links and reports redirects implicitly', async () => {
    const fetch = jest.fn(async () => response({
      finalUrl: 'https://example.com/final/path/page',
      redirectCount: 2,
      body: '<html><head><title>Final</title></head><body><main>' +
        '<p>' + 'Final page text that is long enough to be read. '.repeat(10) +
        '</p><a href="child">Child</a></main></body></html>',
    }));
    const result = await call(toolWith(fetch), { url: 'https://example.com/start' });
    expect(result.content).toContain('https://example.com/final/path/child');
    expect(result.links).toEqual([
      { text: 'Child', url: 'https://example.com/final/path/child' },
    ]);
  });

  it('fits large pages into the 16 KiB result limit and reports truncation', async () => {
    const huge = '<html><head><title>Huge</title></head><body><main><p>' +
      '网页内容 '.repeat(100_000) + '</p></main></body></html>';
    const fetch = jest.fn(async () => response({ body: huge }));
    const result = await call(toolWith(fetch), { url: 'https://example.com/huge' });
    const serialized = JSON.stringify(result);
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(16_384);
    expect(result.truncated).toBe(true);
    expect(String(result.content).length).toBeGreaterThan(1_000);
  });

  it('drops surplus long links instead of failing the whole page', async () => {
    const links = Array.from({ length: 40 }, (_, index) =>
      `<a href="https://example.com/${'p'.repeat(900)}/${index}">link ${index}</a>`).join('');
    const fetch = jest.fn(async () => response({
      body: `<html><head><title>Links</title></head><body><main>${links}<p>${'text '.repeat(500)}</p></main></body></html>`,
    }));
    const result = await call(toolWith(fetch), { url: 'https://example.com/links' });
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(16_384);
    expect(result.truncated).toBe(true);
    expect((result.links as unknown[]).length).toBeLessThan(40);
  });

  it('reports a native download truncation without pretending the page was complete', async () => {
    const fetch = jest.fn(async () => response({ truncated: true }));
    const result = await call(toolWith(fetch), { url: 'https://example.com/big' });
    expect(result.truncated).toBe(true);
    expect((result.notes as string[]).join(' ')).toContain('download limit');
  });

  it('returns a clear error for invalid and non-public targets', async () => {
    const fetch = jest.fn();
    const tool = toolWith(fetch);
    await expect(tool.call({ url: 'not a url' }, {})).rejects.toMatchObject({
      code: 'WEB_URL_FORBIDDEN',
    });
    await expect(tool.call({ url: 'file:///etc/passwd' }, {})).rejects.toMatchObject({
      code: 'WEB_URL_FORBIDDEN',
    });
    await expect(tool.call({ url: 'http://127.0.0.1:8080/' }, {})).rejects.toMatchObject({
      code: 'WEB_URL_FORBIDDEN',
    });
    await expect(tool.call({ url: 'https://user:pass@example.com/' }, {})).rejects.toMatchObject({
      code: 'WEB_URL_FORBIDDEN',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects missing URL and extra search/provider arguments', async () => {
    const tool = toolWith(jest.fn());
    await expect(tool.call({}, {})).rejects.toMatchObject({ code: 'WEB_ARGUMENTS_INVALID' });
    await expect(tool.call({ url: 'https://example.com', query: 'weather' }, {}))
      .rejects.toMatchObject({ code: 'WEB_ARGUMENTS_INVALID' });
  });

  it('maps transport limits, HTTP and content-type failures to explicit errors', async () => {
    await expect(call(toolWith(jest.fn(async () => {
      throw new WebTransportError('WEB_RESPONSE_TOO_LARGE', 'too large');
    })), { url: 'https://example.com/' })).rejects.toMatchObject({
      code: 'WEB_RESPONSE_TOO_LARGE',
    });

    await expect(call(toolWith(jest.fn(async () => response({ status: 503 }))), {
      url: 'https://example.com/',
    })).rejects.toMatchObject({ code: 'WEB_HTTP_ERROR', retryable: true });

    await expect(call(toolWith(jest.fn(async () => {
      throw new WebTransportError('WEB_UNSUPPORTED_CONTENT_TYPE', 'binary');
    })), { url: 'https://example.com/' })).rejects.toMatchObject({
      code: 'WEB_UNSUPPORTED_CONTENT_TYPE',
    });

    await expect(call(toolWith(jest.fn(async () => {
      throw new WebTransportError('WEB_REDIRECT_FORBIDDEN', 'redirect blocked');
    })), { url: 'https://example.com/' })).rejects.toMatchObject({
      code: 'WEB_REDIRECT_FORBIDDEN',
    });

    await expect(call(toolWith(jest.fn(async () => {
      throw new WebTransportError('WEB_REDIRECT_LIMIT', 'too many redirects');
    })), { url: 'https://example.com/' })).rejects.toMatchObject({
      code: 'WEB_REDIRECT_LIMIT',
    });

    await expect(call(toolWith(jest.fn(async () => {
      throw new WebTransportError('WEB_DNS_FAILED', 'dns failed');
    })), { url: 'https://example.com/' })).rejects.toMatchObject({
      code: 'WEB_DNS_FAILED',
      retryable: true,
    });
  });

  it('supports timeout and cancellation without leaving a pending request', async () => {
    await expect(call(toolWith(jest.fn(async () => {
      throw new WebTransportError('WEB_TIMEOUT', 'timed out');
    })), { url: 'https://example.com/' })).rejects.toMatchObject({
      code: 'WEB_TIMEOUT',
      retryable: true,
    });

    const controller = new AbortController();
    const fetch = jest.fn(async () => {
      controller.abort();
      throw new WebTransportError('WEB_CANCELLED', 'cancelled');
    });
    const tool = toolWith(fetch);
    await expect(tool.call({ url: 'https://example.com/' }, { signal: controller.signal }))
      .rejects.toMatchObject({ code: 'TOOL_CANCELLED' });
  });

  it('does not call the transport for an already-aborted run', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = jest.fn();
    await expect(toolWith(fetch).call({ url: 'https://example.com/' }, { signal: controller.signal }))
      .rejects.toMatchObject({ code: 'TOOL_CANCELLED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows another page after one failed call', async () => {
    const fetch = jest.fn()
      .mockRejectedValueOnce(new WebTransportError('WEB_UPSTREAM_FAILED', 'offline'))
      .mockResolvedValueOnce(response());
    const tool = toolWith(fetch);

    await expect(tool.call({ url: 'https://example.com/one' }, {})).rejects.toMatchObject({
      code: 'WEB_UPSTREAM_FAILED',
    });
    await expect(tool.call({ url: 'https://example.com/two' }, {})).resolves.toMatchObject({
      content: expect.stringContaining('UNTRUSTED_WEB_CONTENT'),
    });
  });

  it('does not fabricate search results for a page with no readable content', async () => {
    const fetch = jest.fn(async () => response({
      body: '<html><head><title>App</title></head><body><div id="app"></div><script>x()</script></body></html>',
    }));
    const result = await call(toolWith(fetch), { url: 'https://app.example.com/' });
    expect(result.content).toBe('');
    expect(result.links).toEqual([]);
    expect((result.notes as string[]).join(' ')).toContain('JavaScript');
  });

  it('treats plain text as text, not HTML', async () => {
    const fetch = jest.fn(async () => response({
      contentType: 'text/plain; charset=utf-8',
      body: 'plain body <not html>',
      finalUrl: 'https://example.com/a.txt',
    }));
    const result = await call(toolWith(fetch), { url: 'https://example.com/a.txt' });
    expect(result.content).toBe('plain body <not html>');
    expect(result.links).toEqual([]);
  });
});
