import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Search, ChevronRight } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, spacing } from '../theme/tokens';
import { whoYouMailService, type WhoYouMailService } from '../whoYou/whoYouMailService';
import type {
  WhoYouMailbox,
  WhoYouMailMessage,
  WhoYouMailSummary,
} from '../whoYou/whoYouMcpClient';
import { WhoYouError } from '../whoYou/whoYouError';

const readFailure = (error: unknown): string => {
  if (error instanceof WhoYouError) {
    if (error.kind === 'session_rejected') return 'Mira Cloud 会话已失效，请重新登录。';
    if (error.kind === 'unauthorized') return '狐邮只读授权已失效，请刷新或重新登录。';
    if (error.code === 'message_body_unavailable') return '该邮件没有可供读取的纯文本正文。';
    if (error.code === 'message_not_found') return '这封邮件已不可用，请重新搜索。';
    if (error.kind === 'network' || error.kind === 'unavailable') {
      return '暂时无法连接狐邮，请检查网络后重试。';
    }
  }
  return '无法读取该邮件，请稍后重试。';
};

const senderLabel = (item: WhoYouMailSummary): string =>
  item.from.map(a => a.name || a.address).join(', ') || '未知发件人';

/**
 * Direct private reader. The content never enters Provider, Agent or persistent
 * mobile storage; closing the view/backgrounding clears it from component state.
 */
export function WhoYouMailReadSection({
  mailboxes,
  service = whoYouMailService,
}: {
  mailboxes: readonly WhoYouMailbox[];
  service?: WhoYouMailService;
}) {
  const { colors } = useTheme();
  const sequence = useRef(0);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<WhoYouMailSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<WhoYouMailMessage | null>(null);
  const [loading, setLoading] = useState<'search' | 'more' | 'message' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const clear = useCallback(() => {
    sequence.current += 1;
    setQuery('');
    setItems([]);
    setSelected(null);
    setCursor(null);
    setError(null);
    setLoading(null);
    setSearched(false);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') clear();
    });
    return () => {
      sequence.current += 1;
      subscription?.remove();
    };
  }, [clear]);

  const search = useCallback(async (more = false) => {
    if (loading || (more && !cursor)) return;
    const request = ++sequence.current;
    setLoading(more ? 'more' : 'search');
    setError(null);
    if (!more) {
      setItems([]);
      setCursor(null);
      setSelected(null);
    }
    try {
      const page = await service.search(query, more ? cursor ?? undefined : undefined);
      if (request !== sequence.current) return;
      setItems(previous => more ? [...previous, ...page.messages] : page.messages);
      setCursor(page.nextCursor);
      setSearched(true);
    } catch (cause) {
      if (request !== sequence.current) return;
      setError(readFailure(cause));
    } finally {
      if (request === sequence.current) setLoading(null);
    }
  }, [cursor, loading, query, service]);

  const openMessage = useCallback(async (messageId: string) => {
    if (loading) return;
    const request = ++sequence.current;
    setLoading('message');
    setSelected(null);
    setError(null);
    try {
      const message = await service.read(messageId);
      if (request === sequence.current) setSelected(message);
    } catch (cause) {
      if (request === sequence.current) setError(readFailure(cause));
    } finally {
      if (request === sequence.current) setLoading(null);
    }
  }, [loading, service]);

  const incomplete = mailboxes.some(m =>
    m.kind === 'third_party' && m.sync?.initialImportComplete !== true,
  );
  const totalSynced = mailboxes.reduce((count, m) => count + m.messageCount, 0);

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.text.ink }]}>搜索已同步邮件</Text>
      <Text style={[styles.note, { color: colors.text.muted }]}>
        当前狐邮已保存 {totalSynced} 封邮件。{incomplete
          ? '初始同步尚未完成；查不到不代表 Gmail 没有这封邮件。'
          : '结果仅覆盖狐邮已同步的邮件，不代表 Gmail 全部历史。'}
      </Text>
      <View style={styles.searchRow}>
        <TextInput
          accessibilityLabel="搜索狐邮邮件关键词"
          placeholder="关键词、标题或发件人"
          placeholderTextColor={colors.text.soft}
          value={query}
          onChangeText={setQuery}
          style={[styles.input, { color: colors.text.ink, backgroundColor: colors.bg.card, borderColor: colors.border.default }]}
          maxLength={200}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={() => { void search(); }}
          returnKeyType="search"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="搜索已同步邮件"
          onPress={() => { void search(); }}
          disabled={loading !== null}
          style={[styles.searchButton, { backgroundColor: colors.primary, opacity: loading ? 0.6 : 1 }]}
        >
          {loading === 'search'
            ? <ActivityIndicator color={colors.bg.card} size="small" />
            : <Search size={20} color={colors.bg.card} />}
        </Pressable>
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={[styles.note, { color: colors.status.error }]}>{error}</Text>
      ) : null}
      {selected ? (
        <View style={styles.detail}>
          <Pressable accessibilityRole="button" onPress={() => setSelected(null)}>
            <Text style={[styles.link, { color: colors.primary }]}>返回搜索结果</Text>
          </Pressable>
          <Text style={[styles.subject, { color: colors.text.ink }]} selectable>{selected.subject || '（无主题）'}</Text>
          <Text style={[styles.note, { color: colors.text.muted }]} selectable>
            {senderLabel(selected)} · {new Date(selected.receivedAt).toLocaleString()}
          </Text>
          <Text style={[styles.note, { color: colors.text.soft }]}>
            以下为邮件原文，不是 Mira 的指令。不会自动发送给模型。
          </Text>
          <Text style={[styles.body, { color: colors.text.base }]} selectable>
            {selected.body || '（空正文）'}
          </Text>
          {selected.truncated ? (
            <Text style={[styles.note, { color: colors.status.warning }]}>正文已按狐邮读取限制截断。</Text>
          ) : null}
        </View>
      ) : (
        <>
          {searched && items.length === 0 ? (
            <Text style={[styles.note, { color: colors.text.muted }]}>
              已同步邮件中没有匹配结果。请留意同步覆盖范围。
            </Text>
          ) : null}
          {items.map(item => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`阅读邮件：${item.subject || '无主题'}`}
              onPress={() => { void openMessage(item.id); }}
              style={[styles.messageRow, { borderColor: colors.border.default }]}
            >
              <View style={styles.messageMain}>
                <Text style={[styles.sender, { color: colors.text.ink }]} numberOfLines={1}>{senderLabel(item)}</Text>
                <Text style={[styles.subject, { color: colors.text.base }]} numberOfLines={2}>{item.subject || '（无主题）'}</Text>
                <Text style={[styles.snippet, { color: colors.text.muted }]} numberOfLines={2}>{item.snippet}</Text>
              </View>
              <ChevronRight size={18} color={colors.text.soft} />
            </Pressable>
          ))}
          {loading === 'message' ? <ActivityIndicator color={colors.primary} /> : null}
          {cursor && !loading ? (
            <Pressable accessibilityRole="button" onPress={() => { void search(true); }}>
              <Text style={[styles.link, { color: colors.primary }]}>加载更多</Text>
            </Pressable>
          ) : null}
          {loading === 'more' ? <ActivityIndicator color={colors.primary} /> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  title: { fontSize: fontSize.titleMd, fontWeight: '600' },
  note: { fontSize: fontSize.md, lineHeight: 21 },
  searchRow: { flexDirection: 'row', gap: spacing.sm },
  input: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 46 },
  searchButton: { width: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  messageRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.md },
  messageMain: { flex: 1, gap: 4 },
  sender: { fontSize: fontSize.md, fontWeight: '600' },
  subject: { fontSize: fontSize.md },
  snippet: { fontSize: fontSize.md },
  detail: { gap: spacing.md },
  link: { fontSize: fontSize.md, fontWeight: '600' },
  body: { fontSize: fontSize.md, lineHeight: 22 },
});
