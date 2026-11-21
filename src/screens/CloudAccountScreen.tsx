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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  AlertCircle,
  Cloud,
  LogIn,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, spacing } from '../theme/tokens';
import { SettingsPageHeader } from '../settings/SettingsPageHeader';
import {
  useCloudAccountStore,
  type CloudAccountStatus,
} from '../cloud/cloudAccountStore';
import type { RootStackParamList } from '../types/navigation';
import { CloudActionButton, CloudMenuRow, cloudLayout } from './CloudAccountUi';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const accountStatusText = (status: CloudAccountStatus): string => {
  switch (status) {
    case 'signed_in':
      return '会话正常';
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
  const navigation = useNavigation<Nav>();
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
      refresh();
    }, [initialized, refresh]),
  );

  const requestSignOut = () =>
    Alert.alert(
      '退出 Mira Cloud？',
      '将清除这台设备的云账户登录状态。本地模型、独立远程连接和推送身份不会被删除。',
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
      <SettingsPageHeader title="Mira Cloud" />
      <ScrollView contentContainerStyle={cloudLayout.scrollContent}>
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
            <Cloud size={27} color={colors.primary} />
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
            <Text style={[styles.accountCaption, { color: colors.text.muted }]}>
              {accountStatusText(status)}
            </Text>
          </View>
        </View>

        <Text style={[cloudLayout.description, { color: colors.text.soft }]}>
          Mira Cloud 为可选能力，不影响本地模型与独立直连。
        </Text>

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

        {hasAccount ? (
          <View
            style={[
              styles.menuGroup,
              {
                backgroundColor: colors.bg.card,
                borderColor: colors.border.default,
              },
            ]}
          >
            <CloudMenuRow
              icon={MonitorSmartphone}
              title="我的设备"
              subtitle="管理已授权设备"
              onPress={() => navigation.navigate('CloudDevices')}
            />
            <CloudMenuRow
              icon={ShieldCheck}
              title="登录与安全"
              subtitle="检查登录状态、退出登录"
              last
              onPress={() => navigation.navigate('CloudSecurity')}
            />
          </View>
        ) : null}

        {status === 'session_rejected' ? (
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
              tone="secondary"
              onPress={requestSignOut}
              disabled={busy}
            />
          </>
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
  accountCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 114,
  },
  avatar: {
    width: 56,
    height: 56,
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
  accountCaption: { fontSize: fontSize.button },
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
  menuGroup: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  spinner: { padding: spacing.xl },
  flexText: { flex: 1 },
  inlineInfo: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
});
