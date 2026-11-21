import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Monitor, RefreshCw, Smartphone } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import { SettingsPageHeader } from '../settings/SettingsPageHeader';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import type { MiraDevice } from '../cloud/cloudAuthApi';
import type { RootStackParamList } from '../types/navigation';
import { CloudActionButton, cloudLayout } from './CloudAccountUi';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// Device identity comes from the Cloud Auth server. A server device UUID is
// not the Mobile installation ID, so never infer "this device" from a name,
// platform, recent activity or array position.
export const activeCloudDevices = (devices: MiraDevice[]): MiraDevice[] =>
  devices.filter(device => device.revokedAt === null);

const deviceTitle = (device: MiraDevice): string =>
  device.clientName?.trim() ||
  (device.platform === 'mobile' ? '移动设备' : '桌面设备');

const devicePlatformLabel = (device: MiraDevice): string =>
  device.platform === 'mobile' ? '移动设备' : '桌面设备';

const activityLabel = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export function CloudDevicesScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<Nav>();
  const status = useCloudAccountStore(state => state.status);
  const account = useCloudAccountStore(state => state.account);
  const busy = useCloudAccountStore(state => state.busy);
  const devices = useCloudAccountStore(state => state.devices);
  const devicesStatus = useCloudAccountStore(state => state.devicesStatus);
  const devicesMessage = useCloudAccountStore(state => state.devicesMessage);
  const accountMessage = useCloudAccountStore(state => state.message);
  const revokingDeviceId = useCloudAccountStore(
    state => state.revokingDeviceId,
  );
  const loadDevices = useCloudAccountStore(state => state.loadDevices);
  const refresh = useCloudAccountStore(state => state.refresh);
  const revokeDevice = useCloudAccountStore(state => state.revokeDevice);
  const canManage = account !== null && status === 'signed_in';
  const visibleDevices = activeCloudDevices(devices);

  useFocusEffect(
    useCallback(() => {
      if (useCloudAccountStore.getState().status === 'signed_in') loadDevices();
    }, [loadDevices]),
  );

  const refreshDevices = useCallback(async () => {
    await refresh();
    if (useCloudAccountStore.getState().status === 'signed_in') {
      await useCloudAccountStore.getState().loadDevices();
    }
  }, [refresh]);

  const requestRevoke = (device: MiraDevice) => {
    Alert.alert(
      `撤销「${deviceTitle(device)}」的云授权？`,
      '撤销后，该设备的 Mira Cloud 登录将失效。如果撤销的是本机，需要重新登录。本地模型和独立远程连接不受影响。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '撤销设备',
          style: 'destructive',
          onPress: () => revokeDevice(device.id),
        },
      ],
    );
  };

  return (
    <SafeAreaView
      style={[cloudLayout.screen, { backgroundColor: colors.bg.canvas }]}
      edges={['top', 'bottom']}
    >
      <SettingsPageHeader title="我的设备" />
      <ScrollView contentContainerStyle={cloudLayout.scrollContent}>
        <Text style={[cloudLayout.description, { color: colors.text.soft }]}>
          仅显示当前 Mira Cloud 账户的已授权设备。
        </Text>

        {status === 'cloud_unavailable' ? (
          <View
            style={[cloudLayout.notice, { backgroundColor: colors.bg.soft }]}
          >
            <Text style={[cloudLayout.noticeText, { color: colors.text.base }]}>
              暂时无法连接 Mira
              Cloud。设备信息可能不是最新的，恢复连接后再管理设备。
            </Text>
          </View>
        ) : null}

        {!account ||
        status === 'session_rejected' ||
        status === 'signed_out' ? (
          <View style={cloudLayout.section}>
            <Text
              style={[cloudLayout.description, { color: colors.text.base }]}
            >
              {status === 'session_rejected'
                ? '登录已失效，请重新登录后查看设备。'
                : '登录 Mira Cloud 后可以查看和管理设备。'}
            </Text>
            <CloudActionButton
              icon={RefreshCw}
              label="返回云账户"
              onPress={() => navigation.navigate('CloudAccount')}
            />
          </View>
        ) : (
          <>
            {devicesStatus === 'loading' || devicesStatus === 'idle' ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[cloudLayout.muted, { color: colors.text.soft }]}>
                  正在读取设备列表…
                </Text>
              </View>
            ) : null}

            {devicesMessage ? (
              <Text
                style={[cloudLayout.noticeText, { color: colors.status.error }]}
              >
                {devicesMessage}
              </Text>
            ) : accountMessage && accountMessage.includes('撤销') ? (
              <Text
                style={[cloudLayout.noticeText, { color: colors.text.base }]}
              >
                {accountMessage}
              </Text>
            ) : null}

            {devicesStatus === 'unavailable' ? (
              <CloudActionButton
                icon={RefreshCw}
                label="重试读取设备列表"
                tone="secondary"
                onPress={() => refreshDevices()}
                disabled={busy || revokingDeviceId !== null}
              />
            ) : null}

            {devicesStatus === 'loaded' && visibleDevices.length === 0 ? (
              <View
                style={[
                  styles.empty,
                  {
                    backgroundColor: colors.bg.card,
                    borderColor: colors.border.default,
                  },
                ]}
              >
                <Monitor size={24} color={colors.text.soft} />
                <Text
                  style={[cloudLayout.description, { color: colors.text.soft }]}
                >
                  暂无已授权设备
                </Text>
              </View>
            ) : null}

            {devicesStatus === 'loaded'
              ? visibleDevices.map(device => (
                  <View
                    key={device.id}
                    style={[
                      styles.device,
                      {
                        backgroundColor: colors.bg.card,
                        borderColor: colors.border.default,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.deviceIcon,
                        { backgroundColor: colors.bg.soft },
                      ]}
                    >
                      {device.platform === 'mobile' ? (
                        <Smartphone size={21} color={colors.primary} />
                      ) : (
                        <Monitor size={21} color={colors.primary} />
                      )}
                    </View>
                    <View style={styles.deviceInfo}>
                      <Text
                        style={[styles.name, { color: colors.text.ink }]}
                        numberOfLines={2}
                      >
                        {deviceTitle(device)}
                      </Text>
                      <Text
                        style={[styles.detail, { color: colors.text.muted }]}
                      >
                        {devicePlatformLabel(device)}
                        {device.clientVersion
                          ? ` · v${device.clientVersion.replace(/^v/, '')}`
                          : ''}
                      </Text>
                      <Text
                        style={[styles.detail, { color: colors.text.soft }]}
                      >
                        最近活动 {activityLabel(device.lastSeenAt)}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`撤销设备 ${deviceTitle(device)}`}
                      accessibilityState={{
                        disabled:
                          !canManage || busy || revokingDeviceId !== null,
                      }}
                      disabled={!canManage || busy || revokingDeviceId !== null}
                      onPress={() => requestRevoke(device)}
                      style={({ pressed }) => [
                        styles.revoke,
                        { borderColor: colors.border.default },
                        pressed && { opacity: 0.7 },
                        (!canManage || busy || revokingDeviceId !== null) && {
                          opacity: 0.5,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.revokeLabel,
                          { color: colors.status.error },
                        ]}
                      >
                        {revokingDeviceId === device.id ? '撤销中' : '撤销'}
                      </Text>
                    </Pressable>
                  </View>
                ))
              : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  device: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 92,
  },
  deviceIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceInfo: { flex: 1, gap: spacing.xs, minWidth: 0 },
  name: { fontSize: fontSize.bodyMd, fontWeight: '600' },
  detail: { fontSize: fontSize.caption, lineHeight: 18 },
  revoke: {
    minHeight: sizing.touchTarget,
    minWidth: 58,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  revokeLabel: { fontSize: fontSize.button, fontWeight: '600' },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  empty: {
    padding: spacing.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    alignItems: 'center',
    gap: spacing.sm,
  },
});
