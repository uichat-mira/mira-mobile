/**
 * Device-resolution regression for HTML-to-Markdown extraction.
 *
 * Metro resolves packages through their "browser" field first, so the device
 * bundle loads Turndown's browser build. That build ships no DOM parser and
 * falls back to a global `document`, which React Native does not provide. Jest
 * resolves the Node build instead, so a serialized-HTML input passed every
 * existing test while real pages failed on device with WEB_EXTRACT_FAILED.
 *
 * This suite pins the browser build explicitly so the device-only failure mode
 * stays visible in CI.
 */
jest.mock('turndown', () =>
  jest.requireActual('turndown/lib/turndown.browser.cjs.js'),
);

import TurndownService from 'turndown';
import { extractWebPage } from './extractWebPage';

const articleHtml = `<!doctype html>
<html lang="zh">
  <head><title>海边的下午</title></head>
  <body>
    <article>
      <h1>海边的下午</h1>
      <p>${'这是一个描述海边下午天气与散步体验的段落，包含足够多的真实内容。'.repeat(6)}</p>
      <p>相关阅读：<a href="../notes/2">第二篇笔记</a>。</p>
    </article>
  </body>
</html>`;

const searchHtml = `<!doctype html>
<html>
  <head><title>搜索 result</title></head>
  <body>
    <main>
      <h2>搜索结果</h2>
      <ol>
        <li><a href="/result/one">结果一</a><p>一段搜索摘要。</p></li>
        <li><a href="https://example.net/result/two">Result two</a><p>Another snippet.</p></li>
      </ol>
    </main>
  </body>
</html>`;

describe('web extraction with device module resolution', () => {
  it('pins the browser build that needs a global document for string input', () => {
    // If this stops throwing, the environment is no longer the device one and
    // the cases below would silently stop protecting the real failure mode.
    expect(() => new TurndownService().turndown('<p>x</p>')).toThrow(
      ReferenceError,
    );
  });

  it('converts article HTML to Markdown without a global document', () => {
    const page = extractWebPage(
      articleHtml,
      'https://example.com/posts/2026/hello',
      true,
    );

    expect(page.title).toBe('海边的下午');
    expect(page.markdown).toContain('海边的下午');
    expect(page.markdown).toContain('https://example.com/posts/notes/2');
    expect(page.usedArticleExtraction).toBe(true);
  });

  it('keeps search-result pages usable without a global document', () => {
    const page = extractWebPage(
      searchHtml,
      'https://search.example.com/s?q=sea',
      true,
    );

    expect(page.markdown).toContain('结果一');
    expect(page.markdown).toContain('Result two');
    expect(page.links).toContainEqual({
      text: '结果一',
      url: 'https://search.example.com/result/one',
    });
  });
});
