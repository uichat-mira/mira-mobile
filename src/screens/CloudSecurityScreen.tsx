import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LogIn, LogOut, RefreshCw, ShieldCheck } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, spacing } from '../theme/tokens';
import { SettingsPageHeader } from '../settings/SettingsPageHeader';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import { CloudActionButton, cloudLayout } from './CloudAccountUi';

const expiryLabel = (expiresAt: string | null): string | null => {
  if (!expiresAt) return null;
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function CloudSecurityScreen() {
  const { colors } = useTheme();
  const status = useCloudAccountStore(state => state.status);
  const account = useCloudAccountStore(state => state.account);
  const expiresAt = useCloudAccountStore(state => state.expiresAt);
  const busy = useCloudAccountStore(state => state.busy);
  const message = useCloudAccountStore(state => state.message);
  const signIn = useCloudAccountStore(state => state.signIn);
  const cancelSignIn = useCloudAccountStore(state => state.cancelSignIn);
  const signOut = useCloudAccountStore(state => state.signOut);
  const refresh = useCloudAccountStore(state => state.refresh);
  const hasAccount =
    account !== null &&
    (status === 'signed_in' || status === 'cloud_unavailable');

  const requestSignOut = () =>
    Alert.alert(
      '退出 Mira Cloud？',
      '仅清除本机的云账户登录状态。不会删除本地模型凭据、独立远程配对或推送身份。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '退出登录',
          style: 'destructive',
          onPress: () => signOut(),
        },
      ],
    );

  return (
    <SafeAreaView
      style={[cloudLayout.screen, { backgroundColor: colors.bg.canvas }]}
      edges={['top', 'bottom']}
    >
      <SettingsPageHeader title="登录与安全" />
      <ScrollView contentContainerStyle={cloudLayout.scrollContent}>
        <View
          style={[
            styles.statusPanel,
            {
              backgroundColor: colors.bg.card,
              borderColor: colors.border.default,
            },
          ]}
        >
          <View style={[styles.icon, { backgroundColor: colors.bg.soft }]}>
            <ShieldCheck size={22} color={colors.primary} />
          </View>
          <View style={styles.statusCopy}>
            <Text style={[styles.title, { color: colors.text.ink }]}>
              {status === 'signed_in'
                ? '已登录 Mira Cloud'
                : status === 'cloud_unavailable'
                ? '云服务暂时不可用'
                : status === 'session_rejected'
                ? '登录已失效'
                : status === 'authorizing'
                ? '正在登录'
                : status === 'loading'
                ? '正在检查登录状态'
                : '未登录'}
            </Text>
            {account ? (
              <Text style={[cloudLayout.muted, { color: colors.text.muted }]}>
                {account.username}
              </Text>
            ) : null}
            {hasAccount && expiryLabel(expiresAt) ? (
              <Text style={[cloudLayout.muted, { color: colors.text.soft }]}>
                会话有效期至 {expiryLabel(expiresAt)}
              </Text>
            ) : null}
          </View>
        </View>
        {message ? (
          <View
            style={[cloudLayout.notice, { backgroundColor: colors.bg.soft }]}
          >
            <Text style={[cloudLayout.noticeText, { color: colors.text.base }]}>
              {message}
            </Text>
          </View>
        ) : null}
        <Text style={[cloudLayout.description, { color: colors.text.muted }]}>
          Mira Cloud
          登录只用于云服务。退出不会影响这台设备上的模型配置和独立远程连接。
        </Text>
        <View style={cloudLayout.section}>
          {hasAccount ? (
            <>
              <CloudActionButton
                icon={RefreshCw}
                label={
                  busy
                    ? '正在检查…'
                    : status === 'cloud_unavailable'
                    ? '重试连接'
                    : '检查登录状态'
                }
                onPress={() => refresh()}
                disabled={busy}
              />
              <CloudActionButton
                icon={LogOut}
                label="退出登录"
                tone="destructive"
                onPress={requestSignOut}
                disabled={busy}
              />
            </>
          ) : status === 'authorizing' ? (
            <CloudActionButton
              icon={LogOut}
              label="取消登录"
              tone="secondary"
              onPress={() => cancelSignIn()}
              disabled={busy}
            />
          ) : (
            <>
              {status === 'cloud_unavailable' ? (
                <CloudActionButton
                  icon={RefreshCw}
                  label="重试连接"
                  tone="secondary"
                  onPress={() => refresh()}
                  disabled={busy}
                />
              ) : null}
              <CloudActionButton
                icon={LogIn}
                label="使用浏览器登录 Mira Cloud"
                onPress={() => signIn()}
                disabled={busy}
              />
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  statusPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusCopy: { flex: 1, gap: spacing.xs },
  title: { fontSize: fontSize.bodyMd, fontWeight: '600' },
});
