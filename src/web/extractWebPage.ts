import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { checkPublicWebUrl } from './urlPolicy';

export interface WebPageLink {
  text: string;
  url: string;
}

export interface ExtractedWebPage {
  title: string;
  markdown: string;
  links: readonly WebPageLink[];
  notes: readonly string[];
  usedArticleExtraction: boolean;
}

interface DomNode {
  textContent?: string | null;
  innerHTML?: string | null;
  tagName?: string;
  getAttribute?: (name: string) => string | null;
  querySelectorAll?: (selector: string) => ArrayLike<DomNode>;
  remove?: () => void;
}

interface DomDocument {
  title?: string;
  body?: DomNode | null;
  documentElement?: DomNode | null;
  querySelector: (selector: string) => DomNode | null;
  querySelectorAll: (selector: string) => ArrayLike<DomNode>;
}

const MAX_PAGE_LINKS = 40;
const MAX_LINK_TEXT = 120;
const MIN_ARTICLE_CHARS = 120;
const ARTICLE_MIN_WITHOUT_LINKS = 5;

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
  linkStyle: 'inlined',
});
turndown.remove(['script', 'style', 'noscript', 'template']);

const collapse = (value: string | null | undefined): string =>
  (value ?? '').replace(/\s+/gu, ' ').trim();

const absolutizeLinks = (document: DomDocument, baseUrl: string): void => {
  const anchors = document.querySelectorAll('a[href]');
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    if (!anchor?.getAttribute) continue;
    const raw = anchor.getAttribute('href');
    if (!raw) continue;
    try {
      const resolved = new URL(raw, baseUrl);
      const policy = checkPublicWebUrl(resolved.href);
      if (policy.ok) {
        // linkedom exposes the standard Element API at runtime; the narrow
        // structural type above only exists to keep DOM globals out of TS.
        (anchor as unknown as { setAttribute(name: string, value: string): void })
          .setAttribute('href', policy.href);
      } else {
        (anchor as unknown as { removeAttribute(name: string): void })
          .removeAttribute('href');
      }
    } catch {
      (anchor as unknown as { removeAttribute(name: string): void })
        .removeAttribute('href');
    }
  }
};

const collectLinks = (root: DomNode | null, baseUrl: string): WebPageLink[] => {
  if (!root?.querySelectorAll) return [];
  const anchors = root.querySelectorAll('a[href]');
  const seen = new Set<string>();
  const links: WebPageLink[] = [];
  for (let index = 0; index < anchors.length && links.length < MAX_PAGE_LINKS; index += 1) {
    const anchor = anchors[index];
    const raw = anchor?.getAttribute?.('href');
    if (!raw) continue;
    try {
      const resolved = new URL(raw, baseUrl);
      const policy = checkPublicWebUrl(resolved.href);
      if (!policy.ok || seen.has(policy.href)) continue;
      seen.add(policy.href);
      const text = collapse(anchor.textContent).slice(0, MAX_LINK_TEXT) || policy.href;
      links.push({ text, url: policy.href });
    } catch {
      // Ignore malformed model-facing links instead of inventing a target.
    }
  }
  return links;
};

const genericRoot = (document: DomDocument): DomNode | null => {
  for (const selector of ['main', '[role="main"]', 'article', '#content', '#main']) {
    const candidate = document.querySelector(selector);
    if (candidate && collapse(candidate.textContent).length > 0) return candidate;
  }
  return document.body ?? document.documentElement ?? null;
};

const cleanForMarkdown = (html: string, baseUrl: string): string => {
  const { document } = parseHTML(
    `<!doctype html><html><body>${html}</body></html>`,
  ) as unknown as { document: DomDocument };
  for (const selector of [
    'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe',
    'object', 'embed', 'picture', 'video', 'audio', 'source', 'img',
    'form', 'button', 'input', 'select', 'textarea',
  ]) {
    const nodes = document.querySelectorAll(selector);
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      nodes[index]?.remove?.();
    }
  }
  absolutizeLinks(document, baseUrl);
  return document.body?.innerHTML ?? '';
};

const markdownFromHtml = (html: string, baseUrl: string): string => {
  const cleaned = cleanForMarkdown(html, baseUrl);
  if (!cleaned.trim()) return '';
  return turndown.turndown(cleaned)
    .replace(/[ \t]+$/gmu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
};

const metaTitle = (document: DomDocument): string => {
  const fromTitle = collapse(document.title);
  if (fromTitle) return fromTitle;
  const og = document.querySelector('meta[property="og:title"]')
    ?.getAttribute?.('content');
  const ogTitle = collapse(og);
  if (ogTitle) return ogTitle;
  return collapse(document.querySelector('h1')?.textContent);
};

const titleFromUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last).slice(0, 160) : parsed.hostname;
  } catch {
    return 'Web page';
  }
};

const countLinksInHtml = (html: string | null | undefined): number => {
  if (!html) return 0;
  return (html.match(/<a\b/giu) ?? []).length;
};

/**
 * Extracts reader text or generic page content without executing scripts.
 * Readability is preferred for articles; pages such as search results keep the
 * generic DOM text and absolute links so navigation remains usable.
 *
 * Parsing is synchronous on the JavaScript thread. The transport caps the input
 * at 1 MiB, so the work is bounded but cannot be interrupted by the network
 * timeout once the body has been received.
 */
export const extractWebPage = (
  html: string,
  finalUrl: string,
  isHtml: boolean,
): ExtractedWebPage => {
  if (!isHtml) {
    return {
      title: titleFromUrl(finalUrl),
      markdown: html.trim(),
      links: [],
      notes: [],
      usedArticleExtraction: false,
    };
  }

  const { document } = parseHTML(html) as unknown as { document: DomDocument };
  const title = metaTitle(document);
  const root = genericRoot(document);
  const pageLinks = collectLinks(root, finalUrl);
  const genericHtml = root?.innerHTML ?? '';
  const notes: string[] = [];

  const readabilityDocument = parseHTML(html) as unknown as {
    document: DomDocument & { defaultView?: unknown };
  };
  let article: {
    title?: string | null;
    content?: string | null;
    textContent?: string | null;
  } | null = null;
  try {
    article = new Readability(readabilityDocument.document, {
      charThreshold: MIN_ARTICLE_CHARS,
      keepClasses: false,
      disableJSONLD: true,
    }).parse();
  } catch {
    article = null;
  }

  const articleText = collapse(article?.textContent);
  const articleHtml = article?.content ?? '';
  const articleLinks = countLinksInHtml(articleHtml);
  const shouldUseArticle = Boolean(
    articleHtml &&
    articleText.length >= MIN_ARTICLE_CHARS &&
    !(articleLinks === 0 && pageLinks.length >= ARTICLE_MIN_WITHOUT_LINKS),
  );

  let usedArticleExtraction = false;
  let sourceHtml = genericHtml;
  if (shouldUseArticle) {
    const candidate = markdownFromHtml(articleHtml, finalUrl);
    if (candidate) {
      sourceHtml = articleHtml;
      usedArticleExtraction = true;
    }
  }

  let markdown = markdownFromHtml(sourceHtml, finalUrl);

  const articleLinkList = usedArticleExtraction
    ? collectLinks(
      (parseHTML(`<html><body>${articleHtml}</body></html>`) as unknown as { document: DomDocument })
        .document.body ?? null,
      finalUrl,
    )
    : [];
  const links: WebPageLink[] = [];
  const seen = new Set<string>();
  for (const link of [...articleLinkList, ...pageLinks]) {
    if (links.length >= MAX_PAGE_LINKS) break;
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    links.push(link);
  }

  if (!usedArticleExtraction && genericHtml) {
    notes.push('Readability did not yield a standalone article; generic page text and links were returned.');
  }
  if (collapse(markdown).length < 200 && /\bscript\b/iu.test(html)) {
    notes.push(
      'This page yielded little readable text. It may require JavaScript, a login, a CAPTCHA, or bot verification. ' +
      'Scripts are not executed and access restrictions are not bypassed.',
    );
  }
  if (!markdown && links.length === 0) {
    notes.push('No readable text or navigable links were present in the returned document.');
  }

  return {
    title: collapse(article?.title) || title || titleFromUrl(finalUrl),
    markdown,
    links,
    notes,
    usedArticleExtraction,
  };
};
