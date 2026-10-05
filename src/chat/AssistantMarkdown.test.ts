import { Lexer, type Tokens } from 'marked';
import { AssistantMarkdownTokenizer } from './AssistantMarkdown';

jest.mock('beautiful-mermaid', () => ({
  renderMermaidSVG: jest.fn(() => '<svg viewBox="0 0 100 100"></svg>'),
}), { virtual: true });
jest.mock('react-native-marked', () => {
  const { Tokenizer } = jest.requireActual<typeof import('marked')>('marked');
  return {
    MarkedTokenizer: Tokenizer,
    Renderer: class {
      getKey() {
        return 'markdown-test-key';
      }
    },
    useMarkdown: jest.fn(() => []),
  };
});
jest.mock('react-native-code-highlighter', () => 'CodeHighlighter');
jest.mock('react-native-katex', () => 'Katex');
jest.mock('react-native-webview', () => ({ WebView: 'WebView' }));

describe('AssistantMarkdownTokenizer', () => {
  it('separates inline formulas from surrounding text', () => {
    const tokens = Lexer.lex('before $x^2$ middle $y + 1$ after', {
      tokenizer: new AssistantMarkdownTokenizer(),
    });
    const paragraph = tokens[0] as Tokens.Paragraph;

    expect(paragraph.tokens).toMatchObject([
      { type: 'text', raw: 'before ' },
      { type: 'codespan', raw: '$x^2$', text: 'mira-inline-math:x^2' },
      { type: 'text', raw: ' middle ' },
      { type: 'codespan', raw: '$y + 1$', text: 'mira-inline-math:y + 1' },
      { type: 'text', raw: ' after' },
    ]);
  });

  it('converts display formulas into dedicated code tokens', () => {
    const tokens = Lexer.lex('$$\n\\int_0^1 x^2 dx\n$$', {
      tokenizer: new AssistantMarkdownTokenizer(),
    });

    expect(tokens[0]).toMatchObject({
      type: 'code',
      lang: 'mira-katex',
      text: '\\int_0^1 x^2 dx',
    });
  });
});
