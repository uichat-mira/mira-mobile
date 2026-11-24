import { PiCoreAgentLoop } from '../../runtime/piAgentLoop';
import { LocalToolGatewayClient } from '../localToolGatewayClient';
import { createWebTool } from './webTool';
import type { WebFetchRequest, WebTransport } from '../../web/webTransport';

const page = (title: string, body: string, links = ''): string =>
  `<html><head><title>${title}</title></head><body><main>` +
  `<p>${body}</p>${links}</main></body></html>`;

const responses: Record<string, string> = {
  'https://search.example.com/s?q=mira+web': page(
    'Search results',
    'Ordinary search result page with enough text to be usable.',
    '<a href="https://news.example.com/article">Source article</a>' +
    '<a href="https://docs.example.com/other">Other result</a>',
  ),
  'https://news.example.com/article': page(
    'Source article',
    'The source article body explains the search result in more detail. '.repeat(4),
    '<a href="https://docs.example.com/other">Next reading</a>',
  ),
  'https://docs.example.com/other': page(
    'Other page',
    'A third page reached only from links discovered in earlier results. '.repeat(4),
  ),
};

const drain = async <T>(stream: AsyncIterable<T>): Promise<T[]> => {
  const events: T[] = [];
  for await (const event of stream) events.push(event);
  return events;
};

describe('web(url) through real Pi Core and Local Tool Gateway', () => {
  it('lets the model construct a search URL, read it, and follow returned links', async () => {
    const transport: WebTransport = {
      fetch: jest.fn(async (request: WebFetchRequest) => ({
        status: 200,
        finalUrl: request.url,
        contentType: 'text/html; charset=utf-8',
        body: responses[request.url] ?? page('Missing', 'missing'),
        truncated: false,
        redirectCount: 0,
      })),
    };
    const gateway = new LocalToolGatewayClient([createWebTool(transport)]);
    const calls = [
      { callId: 'search-1', url: 'https://search.example.com/s?q=mira+web' },
      { callId: 'source-2', url: 'https://news.example.com/article' },
      { callId: 'other-3', url: 'https://docs.example.com/other' },
    ];
    let round = 0;
    const seenTools: string[][] = [];
    const loop = new PiCoreAgentLoop(gateway);

    const events = await drain(await loop.run(
      [{ role: 'user', content: '上网查一下 Mira 并继续读相关页面' }],
      async (_messages, tools) => {
        seenTools.push(tools.map(tool => tool.function.name));
        const call = calls[round];
        round += 1;
        if (call != null) {
          return (async function* () {
            yield {
              type: 'tool-call' as const,
              callId: call.callId,
              name: 'web',
              arguments: JSON.stringify({ url: call.url }),
            };
            yield { type: 'finish' as const, reason: 'tool_calls' };
          })();
        }
        return (async function* () {
          yield { type: 'text-delta' as const, delta: '已读取搜索结果和两个来源页面。' };
          yield { type: 'finish' as const, reason: 'stop' };
        })();
      },
    ));

    expect(seenTools[0]).toContain('web');
    expect(round).toBe(4);
    expect(transport.fetch).toHaveBeenCalledTimes(3);
    expect(transport.fetch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      url: 'https://search.example.com/s?q=mira+web',
      maxBytes: 1_048_576,
      timeoutMs: 30_000,
    }));

    const toolResults = events.filter(event => event.type === 'tool-result');
    expect(toolResults).toHaveLength(3);
    expect(JSON.stringify(toolResults[0])).toContain('https://news.example.com/article');
    expect(JSON.stringify(toolResults[1])).toContain('https://docs.example.com/other');
    expect(toolResults.every(result =>
      JSON.stringify(result).includes('UNTRUSTED_WEB_CONTENT'))).toBe(true);
    expect(events).toContainEqual({
      type: 'text-delta',
      delta: '已读取搜索结果和两个来源页面。',
    });
  });
});
