import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Globe2, Monitor, RefreshCw, Smartphone } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import type { MiraDevice } from '../cloud/cloudAuthApi';

// Cloud Auth owns device identity and effective Session authority. Filtering
// tombstones here is defensive only: it does not prove an active Session.
// The server must return only devices with a valid Session (OPS-029).
export const nonRevokedCloudDevices = (devices: MiraDevice[]): MiraDevice[] =>
  devices.filter(device => device.revokedAt === null);

const devicePlatform = (device: MiraDevice) => {
  switch (device.platform) {
    case 'mobile':
      return '移动设备';
    case 'web':
      return '浏览器';
    default:
      return '桌面设备';
  }
};

const deviceTitle = (device: MiraDevice) =>
  device.clientName?.trim() || devicePlatform(device);

// Unnamed devices need a stable distinguishing label. Only use a real
// server-owned device ID; never infer hardware/OS or current-device identity.
const deviceDetail = (device: MiraDevice) => {
  const details: string[] = [];
  if (device.clientName?.trim()) details.push(devicePlatform(device));
  if (device.clientVersion)
    details.push(`v${device.clientVersion.replace(/^v/, '')}`);
  if (!device.clientName?.trim())
    details.push(`设备标识 ${device.id.slice(0, 8)}`);
  return details.join(' · ');
};

const activityLabel = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export function CloudDevicesSection() {
  const { colors } = useTheme();
  const status = useCloudAccountStore(state => state.status);
  const account = useCloudAccountStore(state => state.account);
  const busy = useCloudAccountStore(state => state.busy);
  const devices = useCloudAccountStore(state => state.devices);
  const devicesStatus = useCloudAccountStore(state => state.devicesStatus);
  const devicesMessage = useCloudAccountStore(state => state.devicesMessage);
  const revokingDeviceId = useCloudAccountStore(
    state => state.revokingDeviceId,
  );
  const refresh = useCloudAccountStore(state => state.refresh);
  const revokeDevice = useCloudAccountStore(state => state.revokeDevice);
  const visibleDevices = nonRevokedCloudDevices(devices);
  const canRevoke =
    account !== null && status === 'signed_in' && devicesStatus === 'loaded';
  const hasSession =
    account !== null &&
    (status === 'signed_in' || status === 'cloud_unavailable');
  // Never present cached devices as currently authorized when Cloud is
  // unreachable, the query failed, or verification is still in progress.
  const showVerifiedList =
    status === 'signed_in' && devicesStatus === 'loaded' && !busy;
  const refreshing =
    busy || devicesStatus === 'loading' || revokingDeviceId !== null;

  const refreshDevices = async () => {
    await refresh();
    if (useCloudAccountStore.getState().status === 'signed_in') {
      await useCloudAccountStore.getState().loadDevices();
    }
  };

  const requestRevoke = (device: MiraDevice) =>
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

  if (!hasSession) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text.ink }]}>
          我的设备
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="刷新设备列表"
          accessibilityState={{ disabled: refreshing }}
          disabled={refreshing}
          onPress={() => refreshDevices()}
          style={({ pressed }) => [
            styles.refresh,
            { borderColor: colors.border.default },
            pressed && styles.pressed,
            refreshing && styles.dimmed,
          ]}
        >
          <RefreshCw size={19} color={colors.text.muted} />
        </Pressable>
      </View>

      {status === 'cloud_unavailable' ? (
        <Text style={[styles.note, { color: colors.text.muted }]}>
          云服务暂不可用，无法确认哪些设备仍有有效会话。请恢复连接后刷新。
        </Text>
      ) : null}

      {status === 'signed_in' &&
      (devicesStatus === 'loading' || devicesStatus === 'idle') &&
      !showVerifiedList ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.note, { color: colors.text.soft }]}>
            正在读取设备…
          </Text>
        </View>
      ) : null}

      {devicesMessage ? (
        <Text style={[styles.note, { color: colors.status.error }]}>
          {devicesMessage}
        </Text>
      ) : null}

      {showVerifiedList && visibleDevices.length === 0 ? (
        <View
          style={[
            styles.empty,
            {
              borderColor: colors.border.default,
              backgroundColor: colors.bg.card,
            },
          ]}
        >
          <Monitor size={22} color={colors.text.soft} />
          <Text style={[styles.note, { color: colors.text.muted }]}>
            暂无有效会话设备
          </Text>
        </View>
      ) : null}

      {showVerifiedList && visibleDevices.length > 0 ? (
        <View
          style={[
            styles.list,
            {
              backgroundColor: colors.bg.card,
              borderColor: colors.border.default,
            },
          ]}
        >
          {visibleDevices.map((device, index) => (
            <View key={device.id} style={styles.deviceRow}>
              <View
                style={[styles.deviceIcon, { backgroundColor: colors.bg.soft }]}
              >
                {device.platform === 'mobile' ? (
                  <Smartphone size={21} color={colors.primary} />
                ) : device.platform === 'web' ? (
                  <Globe2 size={21} color={colors.primary} />
                ) : (
                  <Monitor size={21} color={colors.primary} />
                )}
              </View>
              <View
                style={[
                  styles.deviceContent,
                  index < visibleDevices.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border.default,
                  },
                ]}
              >
                <View style={styles.deviceInfo}>
                  <Text
                    style={[styles.deviceName, { color: colors.text.ink }]}
                    numberOfLines={2}
                  >
                    {deviceTitle(device)}
                  </Text>
                  <Text
                    style={[styles.deviceMeta, { color: colors.text.muted }]}
                    numberOfLines={1}
                  >
                    {deviceDetail(device)}
                  </Text>
                  <Text
                    style={[styles.deviceMeta, { color: colors.text.soft }]}
                    numberOfLines={1}
                  >
                    最近活动 {activityLabel(device.lastSeenAt)}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`撤销设备 ${deviceTitle(device)}`}
                  accessibilityState={{
                    disabled: !canRevoke || busy || revokingDeviceId !== null,
                  }}
                  disabled={!canRevoke || busy || revokingDeviceId !== null}
                  onPress={() => requestRevoke(device)}
                  style={({ pressed }) => [
                    styles.revoke,
                    pressed && styles.pressed,
                    (!canRevoke || busy || revokingDeviceId !== null) &&
                      styles.dimmed,
                  ]}
                >
                  <Text
                    style={[styles.revokeText, { color: colors.status.error }]}
                  >
                    {revokingDeviceId === device.id ? '撤销中' : '撤销'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { fontSize: fontSize.titleMd, fontWeight: '700' },
  refresh: {
    width: sizing.touchTarget,
    height: sizing.touchTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.md,
  },
  deviceIcon: {
    width: 43,
    height: 43,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deviceContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 100,
    paddingRight: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  deviceInfo: { flex: 1, minWidth: 0, gap: spacing.xs },
  deviceName: { fontSize: fontSize.bodyMd, fontWeight: '600' },
  deviceMeta: { fontSize: fontSize.caption, lineHeight: 18 },
  revoke: {
    minHeight: sizing.touchTarget,
    minWidth: 54,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  revokeText: { fontSize: fontSize.button, fontWeight: '600' },
  empty: {
    minHeight: 100,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  note: { fontSize: fontSize.button, lineHeight: 20 },
  pressed: { opacity: 0.75 },
  dimmed: { opacity: 0.45 },
});
