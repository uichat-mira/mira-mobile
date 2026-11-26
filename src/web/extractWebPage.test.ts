import { extractWebPage } from './extractWebPage';

const articleHtml = `<!doctype html>
<html lang="zh">
  <head>
    <title>海边的下午</title>
    <meta property="og:title" content="海边的下午" />
  </head>
  <body>
    <nav><a href="/">首页</a><a href="/about">关于</a></nav>
    <article>
      <h1>海边的下午</h1>
      <p>${'这是一个描述海边下午天气与散步体验的段落，包含足够多的真实内容。'.repeat(6)}</p>
      <p>相关阅读：<a href="../notes/2">第二篇笔记</a>，以及<a href="https://example.org/global">外部资料</a>。</p>
      <img src="https://cdn.example.com/photo.jpg" alt="photo" />
    </article>
    <footer><a href="/privacy">隐私</a></footer>
  </body>
</html>`;

const searchHtml = `<!doctype html>
<html>
  <head><title>搜索 result</title></head>
  <body>
    <main>
      <form action="/search"><input name="q" /><button>搜索</button></form>
      <h2>搜索结果</h2>
      <ol>
        <li><a href="/result/one">结果一：海边的下午</a><p>一段搜索摘要。</p></li>
        <li><a href="https://example.net/result/two">Result two</a><p>Another snippet.</p></li>
        <li><a href="/result/three">结果三</a><p>第三条摘要。</p></li>
        <li><a href="/result/four">结果四</a><p>第四条摘要。</p></li>
        <li><a href="/result/five">结果五</a><p>第五条摘要。</p></li>
        <li><a href="/result/six">结果六</a><p>第六条摘要。</p></li>
      </ol>
    </main>
  </body>
</html>`;

describe('generic web extraction', () => {
  it('extracts the real IANA example.com page', () => {
    // Captured public document body; no network access is used by this test.
    const exampleCom = `<!doctype html>
<html>
<head><title>Example Domain</title>
<meta charset="utf-8" />
<meta http-equiv="Content-type" content="text/html; charset=utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style type="text/css">body { background-color: #f0f0f2; }</style>
</head>
<body>
<div>
<h1>Example Domain</h1>
<p>This domain is for use in illustrative examples in documents. You may use this
domain in literature without prior coordination or asking for permission.</p>
<p><a href="https://www.iana.org/domains/example">More information...</a></p>
</div>
</body>
</html>`;
    const page = extractWebPage(exampleCom, 'https://example.com/', true);
    expect(page.title).toBe('Example Domain');
    expect(page.markdown).toContain('illustrative examples in documents');
    expect(page.markdown).not.toContain('background-color');
    expect(page.links).toContainEqual({
      text: 'More information...',
      url: 'https://www.iana.org/domains/example',
    });
  });

  it('keeps readable article text with absolute navigable links', () => {
    const page = extractWebPage(articleHtml, 'https://example.com/posts/2026/hello', true);

    expect(page.title).toBe('海边的下午');
    expect(page.markdown).toContain('海边的下午');
    expect(page.markdown).toContain('https://example.com/posts/notes/2');
    expect(page.markdown).not.toContain('photo.jpg');
    expect(page.links).toEqual(expect.arrayContaining([
      { text: '第二篇笔记', url: 'https://example.com/posts/notes/2' },
      { text: '外部资料', url: 'https://example.org/global' },
    ]));
  });

  it('keeps search-result style pages usable without site-specific selectors', () => {
    const page = extractWebPage(searchHtml, 'https://search.example.com/s?q=sea', true);

    expect(page.title).toBe('搜索 result');
    expect(page.markdown).toContain('结果一');
    expect(page.markdown).toContain('Result two');
    expect(page.links.length).toBeGreaterThanOrEqual(6);
    expect(page.links).toContainEqual({
      text: '结果一：海边的下午',
      url: 'https://search.example.com/result/one',
    });
    expect(page.links.some(link => link.url.includes('/search?'))).toBe(false);
  });

  it('returns generic text and links when article extraction cannot produce content', () => {
    const directory = `<html><head><title>目录</title></head><body>
      <div><a href="/a">条目 A</a></div><div><a href="/b">条目 B</a></div>
      <div><a href="/c">条目 C</a></div><div><a href="/d">条目 D</a></div>
      <div><a href="/e">条目 E</a></div><div><a href="/f">条目 F</a></div>
    </body></html>`;

    const page = extractWebPage(directory, 'https://example.com/dir/', true);
    expect(page.markdown).toContain('条目 A');
    expect(page.links).toHaveLength(6);
    expect(page.usedArticleExtraction).toBe(false);
  });

  it('does not invent content for script-only or empty pages', () => {
    const page = extractWebPage(
      '<html><head><title>App</title></head><body><div id="app"></div><script>render()</script></body></html>',
      'https://app.example.com/',
      true,
    );
    expect(page.markdown).toBe('');
    expect(page.title).toBe('App');
    expect(page.links).toEqual([]);
    expect(page.notes.join(' ')).toContain('JavaScript');
  });

  it('returns plain text unchanged without link fabrication', () => {
    const page = extractWebPage('plain text body', 'https://example.com/a.txt', false);
    expect(page.markdown).toBe('plain text body');
    expect(page.links).toEqual([]);
  });

  it('drops links with credentials or non-public literals', () => {
    const page = extractWebPage(
      '<html><body><a href="https://user:pass@example.com/x">credential</a>' +
      '<a href="http://127.0.0.1/admin">local</a><a href="https://example.com/ok">ok</a></body></html>',
      'https://example.com/',
      true,
    );
    expect(page.links).toEqual([{ text: 'ok', url: 'https://example.com/ok' }]);
  });
});
