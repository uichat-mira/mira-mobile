import React, { useRef, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ChevronLeft,
  ChevronDown,
  Smile,
  BookOpen,
  Grid3x3,
  Monitor,
  Sun,
  Moon,
  Settings as GearIcon,
  Bell,
  ShieldCheck,
  HardDrive,
  Bug,
  Info,
  LogOut,
  MessageCircle,
  Palette,
  Cloud,
} from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import { useTheme, type AccentColor, type ThemeMode } from '../theme/ThemeContext';
import { themePresets } from '../theme/palette';
import { useTailscaleConnectivityStore } from '../store/tailscaleConnectivityStore';
import { useDesktopConnectionStore, type DesktopConnectionMode } from '../connectivity/desktopConnectionAuthority';
import {
  SettingsGroup as RowGroup,
  SettingsRow as Row,
  SettingsSectionHeader as SectionHeader,
} from '../settings/SettingsComponents';
import { SettingsChoiceModal, type SettingsChoice } from '../settings/SettingsChoiceModal';
import { ConnectionStatusDot, type ConnectionVisualStatus } from '../connectivity/ConnectionStatusDot';
import { ProviderConfigStore } from '../provider/providerConfigStore';
import { useHostStore } from '../store/hostStore';
import { useCloudAccountStore, type CloudAccountStatus } from '../cloud/cloudAccountStore';

type NavProp = NativeStackNavigationProp<RootStackParamList>;
const miraLogo = require('../../assets/branding/mira-logo-square.png');

const appearanceOptions: readonly SettingsChoice<ThemeMode>[] = [
  { value: 'system', label: '系统（默认）' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

const accentOptionDefinitions: readonly SettingsChoice<AccentColor>[] = [
  { value: 'default', label: themePresets.default.label, swatch: themePresets.default.swatch },
  { value: 'knowledge-blue', label: themePresets['knowledge-blue'].label, swatch: themePresets['knowledge-blue'].swatch },
  { value: 'archive-green', label: themePresets['archive-green'].label, swatch: themePresets['archive-green'].swatch },
  { value: 'slate-ocean', label: themePresets['slate-ocean'].label, swatch: themePresets['slate-ocean'].swatch },
];

type LogoutMethod = 'tailscale' | 'mira-id';

interface LogoutSnapshot {
  method: LogoutMethod;
  desktopMode: DesktopConnectionMode;
  cloudAccountId: string | null;
}

const hasCloudIdentity = (
  status: CloudAccountStatus,
  account: { id: string } | null,
): boolean =>
  account !== null &&
  (status === 'signed_in' || status === 'cloud_unavailable');

const resolveLogoutMethod = (
  desktopMode: DesktopConnectionMode,
  status: CloudAccountStatus,
  account: { id: string } | null,
): LogoutMethod | null => {
  // An active Tailscale transport owns the exit action even while a Mira ID is
  // also signed in: logout must never silently revoke the cloud identity.
  if (desktopMode === 'direct') return 'tailscale';
  return hasCloudIdentity(status, account) ? 'mira-id' : null;
};

export function SettingsScreen() {
  const navigation = useNavigation<NavProp>();
  const {
    colors,
    theme,
    mode,
    accentColor,
    persistenceError,
    setMode,
    setAccentColor,
  } = useTheme();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [accentOpen, setAccentOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const logoutInFlightRef = useRef(false);
  const { config: hostConfig, connectionStatus } = useHostStore();
  const remoteConnectivityState = useTailscaleConnectivityStore((state) => state.state);
  const [providerCount, setProviderCount] = useState(0);
  const cloudStatus = useCloudAccountStore((state) => state.status);
  const cloudAccount = useCloudAccountStore((state) => state.account);
  const cloudSignOut = useCloudAccountStore((state) => state.signOut);
  const desktopConnectionMode = useDesktopConnectionStore((state) => state.mode);
  const disconnectDesktop = useDesktopConnectionStore((state) => state.disconnect);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      void new ProviderConfigStore()
        .load()
        .then((configs) => {
          if (!cancelled) setProviderCount(configs.length);
        })
        .catch(() => {
          if (!cancelled) setProviderCount(0);
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const remoteHasError = !['idle', 'probing', 'ready'].includes(remoteConnectivityState);
  const remoteVisualStatus: ConnectionVisualStatus = remoteHasError
    ? 'error'
    : connectionStatus === 'connected'
      ? 'connected'
      : connectionStatus === 'connecting' || connectionStatus === 'reconnecting'
        ? 'connecting'
        : hostConfig
          ? 'disconnected'
          : 'not-configured';

  const logoutMethod = resolveLogoutMethod(
    desktopConnectionMode,
    cloudStatus,
    cloudAccount,
  );
  const cloudIdentityPresent = hasCloudIdentity(cloudStatus, cloudAccount);

  const isLogoutSnapshotCurrent = (snapshot: LogoutSnapshot): boolean => {
    const currentDesktop = useDesktopConnectionStore.getState();
    const currentCloud = useCloudAccountStore.getState();
    return (
      resolveLogoutMethod(
        currentDesktop.mode,
        currentCloud.status,
        currentCloud.account,
      ) === snapshot.method &&
      currentDesktop.mode === snapshot.desktopMode &&
      (currentCloud.account?.id ?? null) === snapshot.cloudAccountId
    );
  };

  const rejectChangedLogout = () => {
    Alert.alert('状态已变化', '连接或账号状态已更新，请重新确认退出操作。');
  };

  const beginLogout = (): boolean => {
    // The confirm button holds the handler from the render that opened the
    // dialog, so React state alone cannot stop a second tap.
    if (logoutInFlightRef.current) return false;
    logoutInFlightRef.current = true;
    setLoggingOut(true);
    return true;
  };

  const finishLogout = () => {
    logoutInFlightRef.current = false;
    setLoggingOut(false);
  };

  const performTailscaleLogout = async (snapshot: LogoutSnapshot) => {
    if (!beginLogout()) return;
    try {
      if (snapshot.method !== 'tailscale' || !isLogoutSnapshotCurrent(snapshot)) {
        rejectChangedLogout();
        return;
      }

      await disconnectDesktop();
      const modeAfterRelease = useDesktopConnectionStore.getState().mode;
      if (modeAfterRelease !== 'none') {
        if (modeAfterRelease !== snapshot.desktopMode) {
          rejectChangedLogout();
        } else {
          Alert.alert('退出失败', '未能释放 Tailscale 直连，请稍后重试。');
        }
        return;
      }

      // Only the active transport and its transient health are released. The
      // retained Direct pairing authorization and every Cloud identity stay.
      useTailscaleConnectivityStore.getState().reset();
      useHostStore.getState().setConnectionStatus('disconnected');
      navigation.reset({
        index: 0,
        routes: [{ name: 'HostConfig' }],
      });
    } catch (error) {
      Alert.alert(
        '退出失败',
        error instanceof Error
          ? error.message
          : '无法断开 Tailscale 直连，请稍后重试。',
      );
    } finally {
      finishLogout();
    }
  };

  const performMiraIdLogout = async (snapshot: LogoutSnapshot) => {
    if (!beginLogout()) return;
    try {
      if (snapshot.method !== 'mira-id' || !isLogoutSnapshotCurrent(snapshot)) {
        rejectChangedLogout();
        return;
      }

      // The Cloud Account store owns secure-session clearing, Relay/device
      // invalidation and the Cloud-connection lifecycle fence.
      await cloudSignOut();
      const state = useCloudAccountStore.getState();
      if (state.status !== 'signed_out' || state.account !== null) {
        Alert.alert(
          '退出失败',
          state.message ?? '退出 Mira ID 未完成，请稍后重试。',
        );
        return;
      }

      navigation.navigate('CloudAccount');
    } catch (error) {
      Alert.alert(
        '退出失败',
        error instanceof Error
          ? error.message
          : '退出 Mira ID 未完成，请稍后重试。',
      );
    } finally {
      finishLogout();
    }
  };

  const requestLogout = () => {
    if (logoutInFlightRef.current) return;
    const method = logoutMethod;
    if (!method) return;

    const snapshot: LogoutSnapshot = {
      method,
      desktopMode: desktopConnectionMode,
      cloudAccountId: cloudAccount?.id ?? null,
    };

    if (method === 'tailscale') {
      Alert.alert(
        '退出登录（Tailscale）？',
        cloudIdentityPresent
          ? '将断开 Tailscale，Mira ID 保持登录。'
          : '将断开当前 Tailscale 直连；本地模型、历史与桌面配对授权保留。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '退出',
            style: 'destructive',
            onPress: () => {
              void performTailscaleLogout(snapshot);
            },
          },
        ],
      );
      return;
    }

    Alert.alert('退出登录（Mira ID）？', '退出后云端功能不可用。', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: () => {
          void performMiraIdLogout(snapshot);
        },
      },
    ]);
  };

  const handleSettingAction = (actionId: string) => {
    switch (actionId) {
      case 'personalization':
        navigation.navigate('Personalization');
        break;
      case 'memory':
        navigation.navigate('Memory');
        break;
      case 'appearance':
        setAppearanceOpen(true);
        break;
      case 'accent':
        setAccentOpen(true);
        break;
      case 'notifications':
        navigation.navigate('Notifications');
        break;
      case 'host-config':
        navigation.navigate('HostConfig');
        break;
      case 'local-provider':
        navigation.navigate('LocalProviderList');
        break;
      case 'logout':
        requestLogout();
        break;
      case 'cloud-account':
        navigation.navigate('CloudAccount');
        break;
      case 'plugins':
        navigation.navigate('Plugins');
        break;
      case 'storage':
        navigation.navigate('Storage');
        break;
      case 'report-error':
        navigation.navigate('ReportError');
        break;
      case 'about':
        navigation.navigate('About');
        break;
      case 'security':
        navigation.navigate('Security');
        break;
      case 'general':
        navigation.navigate('General');
        break;
    }
  };

  const appearanceLabel = appearanceOptions.find((option) => option.value === mode)?.label ?? '';
  const accentOption =
    accentOptionDefinitions.find((option) => option.value === accentColor) ??
    accentOptionDefinitions[0];
  const persistenceSuffix = persistenceError ? ' · 本次设置未保存' : '';
  const cloudSubtitle =
    cloudStatus === 'signed_in'
      ? `已登录 ${cloudAccount?.username ?? ''}`.trim()
      : cloudStatus === 'authorizing'
        ? '等待浏览器完成登录'
        : cloudStatus === 'cloud_unavailable'
          ? 'Cloud 暂时不可用'
          : cloudStatus === 'device_revoked'
            ? '本机授权已撤销，需重新注册'
            : cloudStatus === 'session_rejected'
            ? '登录已失效，点击重新登录'
            : cloudStatus === 'loading'
              ? '正在读取…'
              : '未登录（可选）';

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.bg.canvas }]}
      edges={['top', 'bottom']}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [
            styles.backBtn,
            { backgroundColor: colors.bg.card },
            pressed && { opacity: 0.7 },
          ]}
        >
          <ChevronLeft size={24} color={colors.text.ink} />
        </Pressable>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileSection}>
          <View style={styles.avatarWrap}>
            <View
              style={[
                styles.avatar,
                {
                  backgroundColor: colors.bg.card,
                  borderColor: colors.border.default,
                },
              ]}
            >
              <Image source={miraLogo} style={styles.avatarLogo} />
            </View>
          </View>
        </View>

        <SectionHeader>连接</SectionHeader>
        <RowGroup onAction={handleSettingAction}>
          <Row
            icon={MessageCircle}
            title="模型直连"
            subtitle={providerCount > 0 ? `${providerCount} 个已保存配置 · 未验证连接` : '未配置'}
            actionId="local-provider"
            isFirst
            isLast={false}
            showChevron
          />
          <Row
            icon={Monitor}
            title="远程连接"
            actionId="host-config"
            isLast
            right={<ConnectionStatusDot status={remoteVisualStatus} />}
            showChevron={false}
          />
        </RowGroup>

        <SectionHeader>我的 Mira</SectionHeader>
        <RowGroup onAction={handleSettingAction}>
          <Row
            icon={Cloud}
            title="Mira Cloud 账户"
            subtitle={cloudSubtitle}
            actionId="cloud-account"
            isFirst
            isLast={false}
          />
          <Row icon={Smile} title="个性化" actionId="personalization" isLast={false} />
          <Row icon={BookOpen} title="记忆" actionId="memory" isLast={false} />
          <Row icon={Grid3x3} title="插件" actionId="plugins" isLast />
        </RowGroup>

        <SectionHeader>外观</SectionHeader>
        <RowGroup onAction={handleSettingAction}>
          <Row
            icon={theme === 'light' ? Sun : Moon}
            title="外观"
            subtitle={`${appearanceLabel}${persistenceSuffix}`}
            actionId="appearance"
            isFirst
            isLast={false}
            right={
              <View style={styles.accentRow}>
                <ChevronDown size={20} color={colors.text.soft} />
              </View>
            }
            showChevron={false}
          />
          <Row
            icon={Palette}
            title="重点色"
            subtitle={`${accentOption.label}${persistenceSuffix}`}
            actionId="accent"
            isLast
            right={
              <View style={styles.accentRow}>
                <View style={[styles.accentDot, { backgroundColor: accentOption.swatch ?? colors.text.soft }]} />
                <ChevronDown size={20} color={colors.text.soft} />
              </View>
            }
            showChevron={false}
          />
        </RowGroup>

        <SectionHeader>通用</SectionHeader>
        <RowGroup onAction={handleSettingAction}>
          <Row
            icon={GearIcon}
            title="常规"
            actionId="general"
            isFirst
            isLast={false}
          />
          <Row icon={Bell} title="通知" actionId="notifications" isLast={false} />
          <Row icon={ShieldCheck} title="安全" actionId="security" isLast={false} />
          <Row icon={HardDrive} title="存储" actionId="storage" isLast={false} />
          <Row icon={Bug} title="报告错误" actionId="report-error" isLast={false} />
          <Row icon={Info} title="关于" actionId="about" isLast />
        </RowGroup>

        {logoutMethod ? (
          <>
            <View style={styles.logoutSpacer} />
            <RowGroup onAction={handleSettingAction}>
              <Row
                icon={LogOut}
                title={
                  logoutMethod === 'tailscale'
                    ? '退出登录（Tailscale）'
                    : '退出登录（Mira ID）'
                }
                actionId={loggingOut ? undefined : 'logout'}
                isFirst
                isLast
                destructive
              />
            </RowGroup>
          </>
        ) : null}

        <View style={styles.bottomSpacer} />
      </ScrollView>
      <SettingsChoiceModal visible={appearanceOpen} value={mode} options={appearanceOptions} onChange={setMode} onClose={() => setAppearanceOpen(false)} />
      <SettingsChoiceModal visible={accentOpen} value={accentColor} options={accentOptionDefinitions} onChange={setAccentColor} onClose={() => setAccentOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerSpacer: { flex: 1 },
  scrollContent: {
    paddingTop: 0,
    paddingHorizontal: 20,
    paddingBottom: 48,
  },
  profileSection: {
    alignItems: 'center',
    paddingTop: 0,
    paddingBottom: 8,
  },
  avatarWrap: {
    width: 96,
    height: 96,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarLogo: {
    width: '100%',
    height: '100%',
    borderRadius: 48,
  },
  accentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  accentDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  logoutSpacer: { height: 8 },
  bottomSpacer: { height: 32 },
});
