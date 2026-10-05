import React, { Fragment, type ReactNode, useMemo, useState } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {
  MarkedTokenizer,
  Renderer,
  useMarkdown,
  type MarkedStyles,
  type RendererInterface,
  type Tokens,
} from 'react-native-marked';
import CodeHighlighter from 'react-native-code-highlighter';
import Katex from 'react-native-katex';
import { atomOneDark, atomOneLight } from 'react-syntax-highlighter/dist/cjs/styles/hljs';
import { renderMermaidSVG } from 'beautiful-mermaid';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ThemeColors } from '../theme/palette';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, spacing } from '../theme/tokens';

const INLINE_MATH_PREFIX = 'mira-inline-math:';
const DISPLAY_MATH_LANGUAGE = 'mira-katex';
const MAX_DIAGRAM_LENGTH = 12_000;
const MAX_HIGHLIGHT_LENGTH = 30_000;

const mathViewportScript = `
  (function () {
    var viewport = document.createElement('meta');
    viewport.setAttribute('name', 'viewport');
    viewport.setAttribute(
      'content',
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'
    );
    (document.head || document.documentElement).appendChild(viewport);
  })();
  true;
`;

const mathMeasurementScript = `
  (function ensureViewport() {
    var viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) {
      viewport = document.createElement('meta');
      viewport.setAttribute('name', 'viewport');
      document.head.appendChild(viewport);
    }
    viewport.setAttribute(
      'content',
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'
    );
  })();

  (function measure(attempt) {
    var formula = document.querySelector('.katex');
    if (!formula) {
      if (attempt < 30) setTimeout(function () { measure(attempt + 1); }, 16);
      return;
    }
    setTimeout(function () {
      requestAnimationFrame(function () {
        var rect = formula.getBoundingClientRect();
        window.ReactNativeWebView.postMessage(JSON.stringify({
          width: Math.ceil(rect.width),
          height: Math.ceil(rect.height)
        }));
      });
    }, 50);
  })(0);
  true;
`;

const createMathStyle = (color: string, displayMode: boolean) => `
  html, body {
    display: flex;
    align-items: center;
    justify-content: ${displayMode ? 'center' : 'flex-start'};
    width: max-content;
    min-width: ${displayMode ? '100%' : '0'};
    min-height: 100%;
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: transparent;
    color: ${color};
  }
  .katex {
    display: flex;
    margin: 0;
    color: ${color};
    font-size: ${displayMode ? '22px' : '18px'};
  }
`;

export class AssistantMarkdownTokenizer extends MarkedTokenizer {
  fences(src: string): Tokens.Code | undefined {
    const match = /^\$\$[ \t]*\n?([\s\S]+?)\n?\$\$(?:\n+|$)/.exec(src);
    if (match?.[1]) {
      return {
        type: 'code',
        raw: match[0],
        text: match[1].trim(),
        lang: DISPLAY_MATH_LANGUAGE,
      };
    }
    return super.fences(src);
  }

  codespan(src: string): Tokens.Codespan | undefined {
    const match = /^\$(?!\$)((?:\\.|[^\\\n$])+?)\$(?!\$)/.exec(src);
    const expression = match?.[1];
    if (expression && expression.trim() === expression) {
      return {
        type: 'codespan',
        raw: match[0],
        text: `${INLINE_MATH_PREFIX}${expression}`,
      };
    }
    return super.codespan(src);
  }

  inlineText(src: string): Tokens.Text | undefined {
    const nextMath = /(^|[^\\])\$(?!\$)(?=(?:\\.|[^\\\n$])+?\$(?!\$))/.exec(src);
    if (nextMath) {
      const delimiterIndex = nextMath.index + nextMath[1].length;
      if (delimiterIndex > 0) {
        return super.inlineText(src.slice(0, delimiterIndex));
      }
    }

    return super.inlineText(src);
  }
}

interface MathExpressionProps {
  expression: string;
  displayMode: boolean;
  color: string;
}

function MathExpression({ expression, displayMode, color }: MathExpressionProps) {
  const { width: windowWidth } = useWindowDimensions();
  const maxWidth = Math.max(220, windowWidth - 80);
  const [size, setSize] = useState({
    width: displayMode ? maxWidth : Math.min(maxWidth, Math.max(36, expression.length * 9)),
    height: displayMode ? 44 : 30,
  });

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const measurement = JSON.parse(event.nativeEvent.data) as {
        width?: unknown;
        height?: unknown;
      };
      const measuredWidth =
        typeof measurement.width === 'number' && Number.isFinite(measurement.width)
          ? measurement.width
          : size.width;
      const measuredHeight =
        typeof measurement.height === 'number' && Number.isFinite(measurement.height)
          ? measurement.height
          : size.height;
      setSize({
        width: displayMode ? maxWidth : Math.min(maxWidth, Math.max(28, measuredWidth + 4)),
        height: Math.min(160, Math.max(displayMode ? 40 : 28, measuredHeight + 8)),
      });
    } catch {
      // Keep the estimated dimensions when a WebView reports malformed measurements.
    }
  };

  return (
    <View style={displayMode ? styles.mathBlock : styles.mathInline}>
      <Katex
        expression={expression}
        displayMode={displayMode}
        throwOnError={false}
        trust={false}
        strict="warn"
        maxExpand={1000}
        errorColor="#b53333"
        inlineStyle={createMathStyle(color, displayMode)}
        style={[styles.mathWebView, { width: size.width, height: size.height }]}
        originWhitelist={['about:blank', 'data:text/html']}
        onShouldStartLoadWithRequest={({ url }) =>
          url === 'about:blank' || url.startsWith('data:text/html')
        }
        injectedJavaScriptBeforeContentLoaded={mathViewportScript}
        injectedJavaScript={mathMeasurementScript}
        onMessage={handleMessage}
        javaScriptCanOpenWindowsAutomatically={false}
        textZoom={100}
      />
    </View>
  );
}

interface MermaidDiagramProps {
  source: string;
  colors: ThemeColors;
}

const sanitizeGeneratedSvg = (svg: string) =>
  svg
    .replace(/@import\s+url\([^)]*\);?/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(
      /<svg\b(?![^>]*\bpreserveAspectRatio=)/i,
      '<svg preserveAspectRatio="xMidYMid meet"',
    );

const readSvgAspectRatio = (svg: string) => {
  const match = /viewBox="[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)"/.exec(svg);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width / height
    : 1.5;
};

export const createMermaidDocument = (source: string, colors: ThemeColors) => {
  if (source.length > MAX_DIAGRAM_LENGTH) {
    throw new Error('Mermaid 图表内容过长');
  }
  const svg = sanitizeGeneratedSvg(
    renderMermaidSVG(source, {
      bg: colors.bg.elevated,
      fg: colors.text.ink,
      accent: colors.primary,
      muted: colors.text.muted,
      surface: colors.bg.soft,
      border: colors.border.default,
      transparent: false,
      font: 'Arial',
      padding: 20,
    }),
  );
  return {
    aspectRatio: readSvgAspectRatio(svg),
    html: `<!doctype html>
      <html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
        <style>
          html,body{width:100%;height:100%;margin:0;padding:0;background:transparent;overflow:hidden}
          svg{display:block;width:100%!important;height:100%!important;max-width:100%;max-height:100%}
        </style>
      </head><body>${svg}</body></html>`,
  };
};

function MermaidDiagram({ source, colors }: MermaidDiagramProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const result = useMemo(() => {
    try {
      return { document: createMermaidDocument(source, colors), error: null };
    } catch (error) {
      return {
        document: null,
        error: error instanceof Error ? error.message : 'Mermaid 图表无法渲染',
      };
    }
  }, [colors, source]);

  if (!result.document) {
    return (
      <View style={[styles.renderError, { borderColor: colors.status.error }]}>
        <Text style={[styles.renderErrorText, { color: colors.status.error }]}>{result.error}</Text>
        <Text selectable style={[styles.fallbackCode, { color: colors.text.base }]}>
          {source}
        </Text>
      </View>
    );
  }

  const height = containerWidth
    ? Math.min(480, Math.max(180, containerWidth / result.document.aspectRatio))
    : 240;
  const handleLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    if (nextWidth > 0 && nextWidth !== containerWidth) {
      setContainerWidth(nextWidth);
    }
  };

  return (
    <View
      onLayout={handleLayout}
      style={[styles.diagram, { borderColor: colors.border.default, height }]}
    >
      <KatexWebView
        html={result.document.html}
        style={styles.fillWebView}
      />
    </View>
  );
}

function KatexWebView({ html, style }: { html: string; style: ViewStyle }) {
  return (
    <WebView
      source={{ html }}
      style={style}
      originWhitelist={['about:blank', 'data:text/html']}
      onShouldStartLoadWithRequest={({ url }) =>
        url === 'about:blank' || url.startsWith('data:text/html')
      }
      javaScriptEnabled={false}
      scrollEnabled={false}
      bounces={false}
      cacheEnabled={false}
      setSupportMultipleWindows={false}
      mixedContentMode="never"
    />
  );
}

interface CodeBlockProps {
  source: string;
  language?: string;
  colors: MarkdownPalette;
  dark: boolean;
}

function CodeBlock({ source, language, colors, dark }: CodeBlockProps) {
  const normalizedLanguage = language?.trim().toLowerCase() || 'text';
  const shouldHighlight = source.length <= MAX_HIGHLIGHT_LENGTH;
  return (
    <View
      style={[
        styles.codeBlock,
        { backgroundColor: colors.codeBackground, borderColor: colors.codeBorder },
      ]}
    >
      <View style={[styles.codeHeader, { borderBottomColor: colors.codeBorder }]}>
        <Text style={[styles.codeLanguage, { color: colors.codeMuted }]}>
          {normalizedLanguage}
        </Text>
      </View>
      {shouldHighlight ? (
        <CodeHighlighter
          hljsStyle={dark ? atomOneDark : atomOneLight}
          language={normalizedLanguage}
          textStyle={styles.codeText}
          scrollViewProps={{
            contentContainerStyle: styles.codeContent,
            showsHorizontalScrollIndicator: false,
          }}
        >
          {source}
        </CodeHighlighter>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Text selectable style={[styles.codeText, styles.codeContent, { color: colors.codeText }]}>
            {source}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

type MarkdownPalette = ThemeColors & {
  codeBackground: string;
  codeBorder: string;
  codeMuted: string;
  codeText: string;
};

class AssistantRenderer extends Renderer implements RendererInterface {
  constructor(
    private readonly colors: MarkdownPalette,
    private readonly dark: boolean,
  ) {
    super();
  }

  paragraph(children: ReactNode[], paragraphStyle?: ViewStyle): ReactNode {
    return (
      <View key={this.getKey()} style={[paragraphStyle, styles.paragraph]}>
        {children}
      </View>
    );
  }

  code(text: string, language?: string): ReactNode {
    const normalizedLanguage = language?.trim().toLowerCase();
    if (normalizedLanguage === DISPLAY_MATH_LANGUAGE) {
      return (
        <MathExpression
          key={this.getKey()}
          expression={text}
          displayMode
          color={this.colors.text.ink}
        />
      );
    }
    if (normalizedLanguage === 'mermaid') {
      return <MermaidDiagram key={this.getKey()} source={text} colors={this.colors} />;
    }
    return (
      <CodeBlock
        key={this.getKey()}
        source={text}
        language={normalizedLanguage}
        colors={this.colors}
        dark={this.dark}
      />
    );
  }

  codespan(text: string, codeStyle?: TextStyle): ReactNode {
    if (text.startsWith(INLINE_MATH_PREFIX)) {
      return (
        <MathExpression
          key={this.getKey()}
          expression={text.slice(INLINE_MATH_PREFIX.length)}
          displayMode={false}
          color={this.colors.text.ink}
        />
      );
    }
    return (
      <Text selectable key={this.getKey()} style={codeStyle}>
        {text}
      </Text>
    );
  }

  link(children: string | ReactNode[], href: string, linkStyle?: TextStyle): ReactNode {
    const isSafeLink = /^https?:\/\//i.test(href);
    return (
      <Text
        selectable
        key={this.getKey()}
        accessibilityRole={isSafeLink ? 'link' : undefined}
        onPress={isSafeLink ? () => Linking.openURL(href) : undefined}
        style={linkStyle}
      >
        {children}
      </Text>
    );
  }

  image(_uri: string, alt?: string, _style?: ImageStyle, title?: string): ReactNode {
    return (
      <Text selectable key={this.getKey()} style={{ color: this.colors.text.muted }}>
        [图片：{alt || title || '未命名'}]
      </Text>
    );
  }
}

export function AssistantMarkdown({ content }: { content: string }) {
  const { colors, theme } = useTheme();
  const markdownColors = useMemo<MarkdownPalette>(
    () => ({
      ...colors,
      codeBackground: theme === 'dark' ? '#181715' : colors.bg.elevated,
      codeBorder: theme === 'dark' ? '#3d3b36' : colors.border.default,
      codeMuted: theme === 'dark' ? '#a09d96' : colors.text.muted,
      codeText: theme === 'dark' ? '#faf9f5' : colors.text.ink,
    }),
    [colors, theme],
  );
  const renderer = useMemo(
    () => new AssistantRenderer(markdownColors, theme === 'dark'),
    [markdownColors, theme],
  );
  const tokenizer = useMemo(() => new AssistantMarkdownTokenizer(), []);
  const markdownStyles = useMemo<MarkedStyles>(
    () => ({
      text: { color: colors.text.ink, fontSize: fontSize.md, lineHeight: 24 },
      paragraph: { paddingVertical: spacing.xs },
      strong: { color: colors.text.strong, fontSize: fontSize.md, lineHeight: 24 },
      em: { color: colors.text.base, fontSize: fontSize.md, lineHeight: 24 },
      link: { color: colors.primary, textDecorationLine: 'underline' },
      codespan: {
        color: colors.text.strong,
        backgroundColor: colors.bg.soft,
        fontFamily: 'monospace',
        fontSize: fontSize.caption,
      },
      blockquote: {
        borderLeftColor: colors.primary,
        borderLeftWidth: 3,
        paddingLeft: spacing.md,
        marginVertical: spacing.sm,
      },
      h1: styles.headingLarge,
      h2: styles.headingMedium,
      h3: styles.headingSmall,
      h4: styles.headingSmall,
      h5: styles.headingSmall,
      h6: styles.headingSmall,
      hr: { borderBottomColor: colors.border.default, marginVertical: spacing.md },
      li: { color: colors.text.ink, fontSize: fontSize.md, lineHeight: 24 },
      table: { borderColor: colors.border.default, borderRadius: radius.sm },
      tableCell: { borderColor: colors.border.default, padding: spacing.sm },
    }),
    [colors],
  );
  const elements = useMarkdown(content, {
    renderer,
    tokenizer,
    styles: markdownStyles,
    colorScheme: theme,
  });

  return (
    <View style={styles.root}>
      {elements.map((element, index) => (
        <Fragment key={`assistant-markdown-${index}`}>{element}</Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexShrink: 1, width: '100%' },
  paragraph: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  headingLarge: { fontSize: 22, lineHeight: 28, fontWeight: '700', marginVertical: spacing.sm },
  headingMedium: { fontSize: 19, lineHeight: 26, fontWeight: '700', marginVertical: spacing.sm },
  headingSmall: { fontSize: 17, lineHeight: 24, fontWeight: '600', marginVertical: spacing.xs },
  mathInline: {
    alignSelf: 'center',
    overflow: 'hidden',
    transform: [{ translateY: 3 }],
  },
  mathBlock: { alignSelf: 'stretch', alignItems: 'center', marginVertical: spacing.sm, overflow: 'hidden' },
  mathWebView: { backgroundColor: 'transparent' },
  fillWebView: { flex: 1, backgroundColor: 'transparent' },
  diagram: { width: '100%', overflow: 'hidden', borderWidth: 1, borderRadius: radius.md, marginVertical: spacing.sm },
  renderError: { borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginVertical: spacing.sm },
  renderErrorText: { fontSize: fontSize.caption, fontWeight: '600', marginBottom: spacing.sm },
  fallbackCode: { fontFamily: 'monospace', fontSize: fontSize.caption, lineHeight: 19 },
  codeBlock: { overflow: 'hidden', borderWidth: 1, borderRadius: radius.md, marginVertical: spacing.sm },
  codeHeader: { minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  codeLanguage: { fontSize: fontSize.sm, fontFamily: 'monospace' },
  codeContent: { padding: spacing.md, minWidth: '100%' },
  codeText: { fontFamily: 'monospace', fontSize: fontSize.caption, lineHeight: 20 },
});
