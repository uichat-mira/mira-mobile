import React, { useCallback, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronRight, Mic2 } from 'lucide-react-native';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import { accountMcpServiceDirectory, type AuthorizedServiceListItem } from '../mcp/accountServiceRegistry';
import { SettingsPageHeader } from '../settings/SettingsPageHeader';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import type { RootStackParamList } from '../types/navigation';

type LoadState = {
  accountId: string;
  expiresAt: string | null;
  status: 'loading' | 'ready' | 'error';
  items: readonly AuthorizedServiceListItem[];
};

export const pluginInitial = (name: string): string =>
  Array.from(name.trim()).find(char => !/\s|\p{C}|\p{M}/u.test(char)) || '?';

function PluginRow({ title, subtitle, local, onPress }: {
  title: string;
  subtitle: string;
  local?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const contents = (
    <>
      <View accessible={false} style={[styles.avatar, { backgroundColor: colors.bg.soft }]}>
        {local ? <Mic2 size={22} color={colors.primary} /> :
          <Text style={[styles.initial, { color: colors.text.ink }]}>{pluginInitial(title)}</Text>}
      </View>
      <View style={styles.description}>
        <Text style={[styles.name, { color: colors.text.ink }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: colors.text.muted }]}>{subtitle}</Text>
      </View>
      {onPress ? <ChevronRight size={20} color={colors.text.soft} /> : null}
    </>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bg.soft }]}>
      {contents}
    </Pressable>
  ) : (
    <View style={styles.row} accessible accessibilityLabel={title + '，' + subtitle}>
      {contents}
    </View>
  );
}

export function PluginsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const status = useCloudAccountStore(state => state.status);
  const accountId = useCloudAccountStore(state => state.account?.id ?? null);
  const expiresAt = useCloudAccountStore(state => state.expiresAt);
  const [load, setLoad] = useState<LoadState | null>(null);
  const retryRef = useRef<(() => Promise<void>) | null>(null);

  useFocusEffect(useCallback(() => {
    if (status !== 'signed_in' || !accountId) {
      setLoad(null);
      return;
    }
    let focused = true;
    let generation = 0;
    let previousState = AppState.currentState;
    const refresh = async () => {
      const request = ++generation;
      setLoad({ accountId, expiresAt, status: 'loading', items: [] });
      try {
        // Do not abort the shared catalog transport when this screen blurs.
        // The local generation fence discards obsolete UI results instead.
        const items = await accountMcpServiceDirectory.listAuthorizedServices({ accountId, force: true });
        if (focused && request === generation) {
          setLoad({ accountId, expiresAt, status: 'ready', items });
        }
      } catch {
        if (focused && request === generation) {
          setLoad({ accountId, expiresAt, status: 'error', items: [] });
        }
      }
    };
    retryRef.current = refresh;
    if (previousState === 'active' || previousState == null) refresh();
    const subscription = AppState.addEventListener('change', nextState => {
      const resumed = nextState === 'active' && previousState !== 'active';
      previousState = nextState;
      if (nextState !== 'active') generation += 1;
      // Let the global lifecycle owner invalidate before requesting the list.
      if (resumed) Promise.resolve().then(() => { if (focused && previousState === 'active') return refresh(); });
    });
    return () => {
      focused = false;
      retryRef.current = null;
      subscription.remove();
    };
  }, [status, accountId, expiresAt]));

  const signedIn = status === 'signed_in' && accountId !== null;
  const current = signedIn && load?.accountId === accountId && load.expiresAt === expiresAt ? load : null;
  const items = current?.items ?? [];
  const unavailable = current?.status === 'error' || status === 'cloud_unavailable';
  const rejected = status === 'session_rejected' || status === 'device_revoked';

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg.canvas }]} edges={['top', 'bottom']}>
      <SettingsPageHeader title="插件" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.groupTitle, { color: colors.text.muted }]}>已添加</Text>
        <View style={[styles.group, { backgroundColor: colors.bg.card }]}>
          <PluginRow title="拾言" subtitle="Mira 官方插件" local
            onPress={() => navigation.navigate('ShiyanHome')} />
          {items.map(item => (
            <React.Fragment key={item.id}>
              <View style={[styles.separator, { backgroundColor: colors.border.soft }]} />
              <PluginRow title={item.name} subtitle="Mira ID" />
            </React.Fragment>
          ))}
        </View>
        {signedIn && (!current || current.status === 'loading') ? (
          <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: colors.text.muted }]}>正在更新云端插件…</Text>
        ) : null}
        {unavailable ? (
          <View style={styles.noticeRow}>
            <Text style={[styles.notice, { color: colors.text.muted }]}>云端插件暂时无法更新</Text>
            {signedIn ? <Pressable accessibilityRole="button" accessibilityLabel="重试更新云端插件"
              onPress={() => retryRef.current?.()} style={styles.retry}>
              <Text style={[styles.subtitle, { color: colors.primary }]}>重试</Text>
            </Pressable> : null}
          </View>
        ) : null}
        {rejected ? <Text style={[styles.notice, { color: colors.text.muted }]}>请在 Mira Cloud 账户中重新登录</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  groupTitle: { fontSize: fontSize.button, fontWeight: '500', marginBottom: spacing.sm, marginLeft: spacing.xs },
  group: { borderRadius: radius.lg, overflow: 'hidden' },
  row: { minHeight: 60, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  initial: { fontSize: fontSize.titleLg, fontWeight: '600' },
  description: { flex: 1, gap: spacing.xs },
  name: { fontSize: fontSize.bodyMd, fontWeight: '500' },
  subtitle: { fontSize: fontSize.caption },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 40 + spacing.md * 2 },
  notice: { fontSize: fontSize.caption, marginTop: spacing.md, marginLeft: spacing.xs, flexShrink: 1 },
  noticeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  retry: { minHeight: sizing.touchTarget, justifyContent: 'center', paddingHorizontal: spacing.sm },
});
