import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CheckCircle2, AlertCircle, KeyRound, Server } from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import { SettingsPageHeader } from '../components/settings/SettingsPageHeader';
import {
  SettingsGroup as RowGroup,
  SettingsRow as Row,
  SettingsSectionHeader as SectionHeader,
} from '../components/settings/SettingsComponents';
import {
  formatSavedAt,
  loadSecurityStatus,
  type SecurityStatus,
} from './securityStatus';

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

export function SecurityScreen() {
  const navigation = useNavigation<NavProp>();
  const { colors } = useTheme();
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await loadSecurityStatus();
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法读取安全状态。');
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remoteSavedAt = status ? formatSavedAt(status.remoteHost.savedAt) : null;
  const desktopSavedAt = status ? formatSavedAt(status.desktopHost.savedAt) : null;
  const providersCount = status?.providers.total ?? 0;
  const providersWithKey = status?.providers.withApiKey ?? 0;
  const shiyanConfigured = status?.shiyan.available ?? false;

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

        {status ? (
          <>
            <SectionHeader>总览</SectionHeader>
            <View style={styles.overviewGroup}>
              <OverviewItem
                ok={status.remoteHost.available || status.desktopHost.available}
                title={
                  status.remoteHost.available
                    ? '已配对 Mira Host'
                    : status.desktopHost.available
                      ? '已登录 Desktop Mira Host'
                      : '尚未连接 Mira Host'
                }
                description={
                  status.remoteHost.available
                    ? '设备凭据已写入设备安全存储。'
                    : status.desktopHost.available
                      ? '桌面 Host 登录态已写入设备安全存储。'
                      : '前往「设置 → 连接 → 远程连接」开始配对。'
                }
              />
              <OverviewItem
                ok={providersCount > 0 && providersWithKey === providersCount}
                title={
                  providersCount === 0
                    ? '尚未配置 Local Provider'
                    : providersWithKey === providersCount
                      ? 'Local Provider API Key 已全部保存'
                      : `${providersWithKey}/${providersCount} 个 Provider 已保存 API Key`
                }
                description={
                  providersCount === 0
                    ? '前往「设置 → 连接 → 本地连接」新增 Provider。'
                    : providersWithKey === providersCount
                      ? 'API Key 仅存放在设备安全存储中。'
                      : '有 Provider 缺少 API Key，前往「本地连接」补全。'
                }
              />
              <OverviewItem
                ok={shiyanConfigured}
                title={shiyanConfigured ? '拾言 Cloud 已配置' : '拾言 Cloud 未配置'}
                description={
                  shiyanConfigured
                    ? '拾言设备凭证已写入设备安全存储，与 Desktop Host 凭据彼此独立。'
                    : '前往「设置 → 插件 → 拾言 → Cloud 配置」填入。'
                }
              />
            </View>

            <SectionHeader>安全凭据</SectionHeader>
            <RowGroup onAction={(actionId) => navigation.navigate(actionId as never)}>
              <Row
                icon={KeyRound}
                title="Remote Host 设备凭据"
                subtitle={
                  status.remoteHost.available
                    ? [
                        status.remoteHost.hostUrl ?? '仅 Relay',
                        remoteSavedAt,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : '尚未保存'
                }
                actionId="HostConfig"
                isFirst
                isLast={false}
              />
              <Row
                icon={Server}
                title="Desktop Host 登录态"
                subtitle={
                  status.desktopHost.available
                    ? [
                        status.desktopHost.username,
                        status.desktopHost.hostUrl,
                        desktopSavedAt,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : '尚未保存'
                }
                actionId="HostConfig"
                isLast={false}
              />
              <Row
                icon={KeyRound}
                title="Local Provider API Key"
                subtitle={
                  providersCount === 0
                    ? '尚未配置 Provider'
                    : `${providersWithKey}/${providersCount} 个 Provider 已保存`
                }
                actionId="LocalProviderConfig"
                isLast={false}
              />
              <Row
                icon={KeyRound}
                title="拾言 Cloud 设备凭证"
                subtitle={
                  shiyanConfigured
                    ? `${status.shiyan.baseUrl ?? status.shiyan.defaultBaseUrl} · 已在设备安全存储中保存`
                    : '尚未保存'
                }
                actionId="ShiyanCloudConfig"
                isLast
              />
            </RowGroup>

            <SectionHeader>其它</SectionHeader>
            <RowGroup onAction={(actionId) => navigation.navigate(actionId as never)}>
              <Row
                icon={AlertCircle}
                title="关于设备安全存储"
                subtitle="说明各类凭据的存储方式与边界"
                actionId="About"
                isFirst
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