import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CheckCircle2, AlertCircle, KeyRound, Server } from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import { SettingsPageHeader } from '../settings/SettingsPageHeader';
import {
  SettingsGroup as RowGroup,
  SettingsRow as Row,
  SettingsSectionHeader as SectionHeader,
} from '../settings/SettingsComponents';
import {
  formatSavedAt,
  loadSecurityStatus,
  type SecurityStatus,
} from '../security/securityStatus';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

interface OverviewItemProps {
  ok: boolean;
  title: string;
  description: string;
}

function OverviewItem({ ok, title, description }: OverviewItemProps) {
  const { colors } = useTheme();
  const Icon = ok ? CheckCircle2 : AlertCircle;
  const tint = ok ? colors.status.success ?? '#3aaf62' : colors.status.warning ?? '#c08400';
  return (
    <View style={[styles.overviewItem, { borderColor: colors.border.default, backgroundColor: colors.bg.card }]}>
      <Icon size={22} color={tint} />
      <View style={styles.overviewText}>
        <Text style={[styles.overviewTitle, { color: colors.text.ink }]}>{title}</Text>
        <Text style={[styles.overviewDescription, { color: colors.text.soft }]}>{description}</Text>
      </View>
    </View>
  );
}

/**
 * 凭据行副标题：必须区分「读取失败」「当前构建不支持安全存储」与「尚未保存」，
 * 否则用户会把读不出来的凭据误判为已清除（AGENTS.md §3）。
 */
function credentialSubtitle(
  section: { supported: boolean; error: boolean; available: boolean },
  savedText: string,
): string {
  if (section.error) return '读取失败，请用上方「重试」重新读取';
  if (!section.supported) return '当前构建没有可用的安全存储';
  return section.available ? savedText : '尚未保存';
}

export function SecurityScreen() {
  const navigation = useNavigation<NavProp>();
  const { colors } = useTheme();
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++generationRef.current;
    setBusy(true);
    setError(null);
    try {
      const next = await loadSecurityStatus();
      if (generation !== generationRef.current) return;
      setStatus(next);
    } catch (err) {
      if (generation !== generationRef.current) return;
      setError(err instanceof Error ? err.message : '无法读取安全状态。');
      setStatus(null);
    } finally {
      if (generation === generationRef.current) setBusy(false);
    }
  }, []);

  // 页面离开焦点后仍会挂载（React Navigation 默认行为）。必须按焦点重新读取，
  // 否则从凭据管理页返回时会继续展示过期状态；同时让在途的旧读取失效，
  // 避免旧结果覆盖新结果。
  useFocusEffect(
    useCallback(() => {
      void refresh();
      return () => {
        generationRef.current += 1;
      };
    }, [refresh]),
  );

  const remoteSavedAt = status ? formatSavedAt(status.remoteHost.savedAt) : null;
  const desktopSavedAt = status ? formatSavedAt(status.desktopHost.savedAt) : null;
  const providersCount = status?.providers.total ?? 0;
  const providersWithKey = status?.providers.withApiKey ?? 0;
  const shiyanConfigured = status?.shiyan.available ?? false;
  const hasReadError = status?.hasError ?? false;

  const hostOverview = status
    ? status.remoteHost.error
      ? { ok: false, title: '无法读取 Remote Host 凭据', description: '本次读取失败；凭据可能仍然存在，请重试。' }
      : status.desktopHost.error
        ? { ok: false, title: '无法读取 Desktop Host 登录态', description: '本次读取失败；凭据可能仍然存在，请重试。' }
        : status.remoteHost.available
          ? { ok: true, title: '已配对 Mira Host', description: '设备凭据已写入设备安全存储。' }
          : status.desktopHost.available
            ? { ok: true, title: '已登录 Desktop Mira Host', description: '桌面 Host 登录态已写入设备安全存储。' }
            : { ok: false, title: '尚未连接 Mira Host', description: '前往「设置 → 连接 → 远程连接」开始配对。' }
    : null;

  const providersOverview = status
    ? status.providers.error
      ? { ok: false, title: '无法读取 Local Provider 配置', description: '本次读取失败，请重试。' }
      : !status.providers.supported
        ? { ok: false, title: '当前构建没有可用的安全存储', description: '无法读取 Provider API Key 状态。' }
        : status.providers.keyReadErrors > 0
          ? {
              ok: false,
              title: '部分 Provider API Key 读取失败',
              description: `${status.providers.keyReadErrors} 个 Provider 的 Key 本次读取失败，请重试。`,
            }
          : providersCount === 0
            ? { ok: false, title: '尚未配置 Local Provider', description: '前往「设置 → 连接 → 本地连接」新增 Provider。' }
            : providersWithKey === providersCount
              ? { ok: true, title: 'Local Provider API Key 已全部保存', description: 'API Key 仅存放在设备安全存储中。' }
              : {
                  ok: false,
                  title: `${providersWithKey}/${providersCount} 个 Provider 已保存 API Key`,
                  description: '有 Provider 缺少 API Key，前往「本地连接」补全。',
                }
    : null;

  const shiyanOverview = status
    ? status.shiyan.error
      ? { ok: false, title: '无法读取拾言 Cloud 配置', description: '本次读取失败，请重试。' }
      : shiyanConfigured
        ? {
            ok: true,
            title: '拾言 Cloud 已配置',
            description: '拾言设备凭证已写入设备安全存储，与 Desktop Host 凭据彼此独立。',
          }
        : { ok: false, title: '拾言 Cloud 未配置', description: '前往「设置 → 插件 → 拾言 → Cloud 配置」填入。' }
    : null;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg.canvas }]} edges={['top', 'bottom']}>
      <SettingsPageHeader title="安全" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: colors.text.soft }]}>
          下面展示设备本地保存的所有安全凭据与外部连接入口。本页不展示 Token 或 API Key 本身；如需修改，请进入对应管理页。
        </Text>

        {busy && !status ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}

        {error ? (
          <Text style={[styles.error, { color: colors.status.error ?? '#c0392b' }]}>{error}</Text>
        ) : null}

        {hasReadError ? (
          <View
            style={[
              styles.banner,
              { borderColor: colors.status.warning ?? '#c08400', backgroundColor: colors.bg.card },
            ]}
          >
            <View style={styles.bannerText}>
              <Text style={[styles.bannerTitle, { color: colors.text.ink }]}>部分安全凭据读取失败</Text>
              <Text style={[styles.bannerDescription, { color: colors.text.soft }]}>
                下面显示的结果可能不完整；读取失败的凭据并不代表已被清除。
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="重试读取安全凭据"
              disabled={busy}
              onPress={() => void refresh()}
              style={({ pressed }) => [
                styles.retryButton,
                { borderColor: colors.border.default, backgroundColor: colors.bg.soft },
                pressed && { opacity: 0.72 },
              ]}
            >
              <Text style={{ color: colors.text.ink, fontWeight: '600' }}>
                {busy ? '正在重试…' : '重试'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {status && hostOverview && providersOverview && shiyanOverview ? (
          <>
            <SectionHeader>总览</SectionHeader>
            <View style={styles.overviewGroup}>
              <OverviewItem {...hostOverview} />
              <OverviewItem {...providersOverview} />
              <OverviewItem {...shiyanOverview} />
            </View>

            <SectionHeader>安全凭据</SectionHeader>
            <RowGroup onAction={(actionId) => navigation.navigate(actionId as never)}>
              <Row
                icon={KeyRound}
                title="Remote Host 设备凭据"
                subtitle={credentialSubtitle(
                  status.remoteHost,
                  [status.remoteHost.hostUrl ?? '仅 Relay', remoteSavedAt].filter(Boolean).join(' · '),
                )}
                actionId="HostConfig"
                isFirst
                isLast={false}
              />
              <Row
                icon={Server}
                title="Desktop Host 登录态"
                subtitle={`${credentialSubtitle(
                  status.desktopHost,
                  [status.desktopHost.username, status.desktopHost.hostUrl, desktopSavedAt]
                    .filter(Boolean)
                    .join(' · '),
                )}（暂无管理入口）`}
                isLast={false}
              />
              <Row
                icon={KeyRound}
                title="Local Provider API Key"
                subtitle={
                  status.providers.error
                    ? '读取失败，请用上方「重试」重新读取'
                    : !status.providers.supported
                      ? '当前构建没有可用的安全存储'
                      : providersCount === 0
                        ? '尚未配置 Provider'
                        : `${providersWithKey}/${providersCount} 个 Provider 已保存`
                }
                actionId="LocalProviderConfig"
                isLast={false}
              />
              <Row
                icon={KeyRound}
                title="拾言 Cloud 设备凭证"
                subtitle={credentialSubtitle(
                  status.shiyan,
                  `${status.shiyan.baseUrl ?? status.shiyan.defaultBaseUrl} · 已在设备安全存储中保存`,
                )}
                actionId="ShiyanCloudConfig"
                isLast
              />
            </RowGroup>

          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 48,
  },
  intro: {
    fontSize: fontSize.md,
    lineHeight: 22,
    paddingVertical: spacing.md,
  },
  loading: {
    minHeight: sizing.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  error: {
    fontSize: fontSize.md,
    paddingVertical: spacing.md,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bannerText: { flex: 1 },
  bannerTitle: {
    fontSize: fontSize.titleMd,
    fontWeight: '600',
  },
  bannerDescription: {
    fontSize: fontSize.md,
    marginTop: 2,
    lineHeight: 20,
  },
  retryButton: {
    minHeight: sizing.touchTarget,
    minWidth: sizing.touchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overviewGroup: {
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  overviewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  overviewText: { flex: 1 },
  overviewTitle: {
    fontSize: fontSize.titleMd,
    fontWeight: '600',
  },
  overviewDescription: {
    fontSize: fontSize.md,
    marginTop: 2,
    lineHeight: 20,
  },
});
