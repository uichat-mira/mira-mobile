import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  AlertCircle,
  Cloud,
  LogIn,
  LogOut,
  RefreshCw,
} from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, spacing } from '../theme/tokens';
import { SettingsPageHeader } from '../settings/SettingsPageHeader';
import {
  useCloudAccountStore,
  type CloudAccountStatus,
} from '../cloud/cloudAccountStore';
import { CloudActionButton, cloudLayout } from './CloudAccountUi';
import { CloudDevicesSection } from './CloudDevicesSection';

const accountStatusText = (status: CloudAccountStatus) => {
  switch (status) {
    case 'cloud_unavailable':
      return '暂时无法连接';
    case 'session_rejected':
      return '登录已失效';
    case 'authorizing':
      return '等待浏览器完成登录';
    case 'loading':
      return '正在检查登录状态';
    default:
      return '尚未登录';
  }
};

export function CloudAccountScreen() {
  const { colors } = useTheme();
  const status = useCloudAccountStore(state => state.status);
  const account = useCloudAccountStore(state => state.account);
  const message = useCloudAccountStore(state => state.message);
  const busy = useCloudAccountStore(state => state.busy);
  const initialized = useCloudAccountStore(state => state.initialized);
  const refresh = useCloudAccountStore(state => state.refresh);
  const signIn = useCloudAccountStore(state => state.signIn);
  const cancelSignIn = useCloudAccountStore(state => state.cancelSignIn);
  const signOut = useCloudAccountStore(state => state.signOut);
  const hasAccount =
    account !== null &&
    (status === 'signed_in' || status === 'cloud_unavailable');
  const online = status === 'signed_in';

  useFocusEffect(
    useCallback(() => {
      if (
        !initialized ||
        useCloudAccountStore.getState().status === 'authorizing'
      )
        return;
      const sync = async () => {
        await refresh();
        if (useCloudAccountStore.getState().status === 'signed_in') {
          await useCloudAccountStore.getState().loadDevices();
        }
      };
      sync();
    }, [initialized, refresh]),
  );

  const requestSignOut = () =>
    Alert.alert(
      '退出 Mira Cloud？',
      '将清除这台设备的云账户登录状态。本地模型、独立远程连接和推送身份不会被删除。',
      [
        { text: '取消', style: 'cancel' },
        { text: '退出登录', style: 'destructive', onPress: () => signOut() },
      ],
    );

  return (
    <SafeAreaView
      style={[cloudLayout.screen, { backgroundColor: colors.bg.canvas }]}
      edges={['top', 'bottom']}
    >
      <SettingsPageHeader title="Mira Cloud" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View
          style={[
            styles.accountCard,
            {
              backgroundColor: colors.bg.card,
              borderColor: colors.border.default,
            },
          ]}
        >
          <View style={[styles.avatar, { backgroundColor: colors.bg.soft }]}>
            <Cloud size={26} color={colors.primary} />
          </View>
          <View style={styles.accountText}>
            <View style={styles.accountTitleRow}>
              <Text
                style={[styles.accountName, { color: colors.text.ink }]}
                numberOfLines={1}
              >
                {hasAccount ? account.username : 'Mira Cloud'}
              </Text>
              {hasAccount ? (
                <View
                  style={[
                    styles.statusChip,
                    { backgroundColor: colors.bg.soft },
                  ]}
                >
                  <View
                    style={[
                      styles.statusDot,
                      {
                        backgroundColor: online
                          ? colors.status.success
                          : colors.status.warning,
                      },
                    ]}
                  />
                  <Text
                    style={[styles.statusChipText, { color: colors.text.base }]}
                  >
                    {online ? '已连接' : '连接中断'}
                  </Text>
                </View>
              ) : null}
            </View>
            {hasAccount ? (
              <Text style={[styles.helper, { color: colors.text.muted }]}>
                Mira Cloud 为可选能力，不影响本地模型与独立直连。
              </Text>
            ) : (
              <Text style={[styles.helper, { color: colors.text.muted }]}>
                {accountStatusText(status)} · Mira Cloud
                不影响本地模型与独立直连。
              </Text>
            )}
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

        {status === 'loading' ? (
          <View style={styles.spinner}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}

        {hasAccount ? <CloudDevicesSection /> : null}

        {status === 'session_rejected' && !message ? (
          <View style={styles.inlineInfo}>
            <AlertCircle size={18} color={colors.status.error} />
            <Text
              style={[
                cloudLayout.description,
                { color: colors.text.base },
                styles.flexText,
              ]}
            >
              云账户登录已失效，请重新登录。你仍可以使用本地模型和独立直连。
            </Text>
          </View>
        ) : null}

        {status === 'authorizing' ? (
          <View style={styles.inlineInfo}>
            <ActivityIndicator color={colors.primary} />
            <Text
              style={[
                cloudLayout.description,
                { color: colors.text.base },
                styles.flexText,
              ]}
            >
              在系统浏览器中完成登录，然后返回 Mira。
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={cloudLayout.actions}>
        {hasAccount ? (
          <CloudActionButton
            icon={LogOut}
            label="退出 Mira Cloud"
            tone="secondary"
            onPress={requestSignOut}
            disabled={busy}
          />
        ) : status === 'loading' ? null : status === 'authorizing' ? (
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
              label={
                status === 'session_rejected'
                  ? '重新登录 Mira Cloud'
                  : '使用浏览器登录 Mira Cloud'
              }
              onPress={() => signIn()}
              disabled={busy}
            />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.xl,
  },
  accountCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 110,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountText: { flex: 1, gap: spacing.sm },
  accountTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  accountName: { fontSize: fontSize.titleLg, fontWeight: '700', flexShrink: 1 },
  helper: { fontSize: fontSize.caption, lineHeight: 19 },
  statusChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusChipText: { fontSize: fontSize.caption, fontWeight: '600' },
  statusDot: { width: 7, height: 7, borderRadius: radius.full },
  spinner: { padding: spacing.lg },
  flexText: { flex: 1 },
  inlineInfo: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
});
