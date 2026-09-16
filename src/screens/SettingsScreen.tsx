import React, { useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ChevronLeft,
  ChevronDown,
  Smile,
  BookOpen,
  Grid3x3,
  Mail,
  Monitor,
  Sun,
  Moon,
  Settings as GearIcon,
  Bell,
  Volume2,
  ShieldCheck,
  HardDrive,
  Bug,
  Info,
  LogOut,
  MessageCircle,
  Palette,
} from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import { useTheme, type AccentColor, type ThemeMode } from '../theme/ThemeContext';
import { themePresets } from '../theme/palette';
import { miraHostClient } from '../api/miraHostClient';
import { useTailscaleConnectivityStore } from '../store/tailscaleConnectivityStore';
import {
  SettingsGroup as RowGroup,
  SettingsRow as Row,
  SettingsSectionHeader as SectionHeader,
} from '../components/settings/SettingsComponents';
import { SettingsChoiceModal, type SettingsChoice } from '../components/settings/SettingsChoiceModal';
import { ConnectionStatusDot, type ConnectionVisualStatus } from '../components/ConnectionStatusDot';
import { ProviderConfigStore } from '../provider/providerConfigStore';
import { useHostStore } from '../store/hostStore';

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
  const [disconnecting, setDisconnecting] = useState(false);
  const { config: hostConfig, connectionStatus } = useHostStore();
  const remoteConnectivityState = useTailscaleConnectivityStore((state) => state.state);
  const [localConfigured, setLocalConfigured] = useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void new ProviderConfigStore().load().then((configs) => {
      if (!cancelled) setLocalConfigured(configs.length > 0);
    }).catch(() => {
      if (!cancelled) setLocalConfigured(false);
    });
    return () => { cancelled = true; };
  }, []);

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

  const requestDisconnect = () => {
    if (disconnecting) return;

    Alert.alert(
      '断开 Mira Host？',
      '这会清除本机配对凭据并断开当前 Host，不会删除桌面端的会话、项目或其它数据。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '断开',
          style: 'destructive',
          onPress: () => {
            setDisconnecting(true);
            void miraHostClient
              .disconnect()
              .then(() => {
                useTailscaleConnectivityStore.getState().reset();
                navigation.reset({
                  index: 0,
                  routes: [{ name: 'HostConfig' }],
                });
              })
              .catch((error: unknown) => {
                const message =
                  error instanceof Error ? error.message : '无法断开 Mira Host，请稍后重试。';
                Alert.alert('断开失败', message);
              })
              .finally(() => {
                setDisconnecting(false);
              });
          },
        },
      ],
    );
  };

  const handleSettingAction = (actionId: string) => {
    switch (actionId) {
      case 'personalization':
        navigation.navigate('Personalization');
        break;
      case 'appearance':
        setAppearanceOpen(true);
        break;
      case 'accent':
        setAccentOpen(true);
        break;
      case 'host-config':
        navigation.navigate('HostConfig');
        break;
      case 'local-provider':
        navigation.navigate('LocalProviderConfig');
        break;
      case 'disconnect-host':
        requestDisconnect();
        break;
      case 'plugins':
        navigation.navigate('Plugins');
        break;
      case 'report-error':
        navigation.navigate('ReportError');
        break;
      case 'about':
        navigation.navigate('About');
        break;
    }
  };

  const appearanceLabel = appearanceOptions.find((option) => option.value === mode)?.label ?? '';
  const accentOption =
    accentOptionDefinitions.find((option) => option.value === accentColor) ??
    accentOptionDefinitions[0];
  const persistenceSuffix = persistenceError ? ' · 本次设置未保存' : '';

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

        <SectionHeader>我的 Mira</SectionHeader>
        <RowGroup onAction={handleSettingAction}>
          <Row icon={Smile} title="个性化" actionId="personalization" isFirst isLast={false} />
          <Row icon={BookOpen} title="记忆" isLast={false} />
          <Row icon={Grid3x3} title="插件" actionId="plugins" isLast />
        </RowGroup>

        <SectionHeader>账户</SectionHeader>
        <RowGroup onAction={handleSettingAction}>
          <Row
            icon={Mail}
            title="电子邮件"
            subtitle="dangjingtao@gmail.com"
            isFirst
            isLast
          />
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
            isLast={false}
            right={
              <View style={styles.accentRow}>
                <View style={[styles.accentDot, { backgroundColor: accentOption.swatch ?? colors.text.soft }]} />
                <ChevronDown size={20} color={colors.text.soft} />
              </View>
            }
            showChevron={false}
          />
          <Row
            icon={Monitor}
            title="设备同步"
            subtitle="所有设备"
            isLast
          />
        </RowGroup>

        <SectionHeader>连接</SectionHeader>
        <RowGroup onAction={handleSettingAction}>
          <Row
            icon={MessageCircle}
            title="本地连接"
            subtitle="管理手机直连的 OpenAI-compatible Provider"
            actionId="local-provider"
            isFirst
            isLast={false}
            right={<ConnectionStatusDot status={localConfigured ? 'connected' : 'not-configured'} />}
            showChevron={false}
          />
          <Row
            icon={Monitor}
            title="远程连接"
            subtitle="管理 Mira Host 连接"
            actionId="host-config"
            isLast
            right={<ConnectionStatusDot status={remoteVisualStatus} />}
            showChevron={false}
          />
        </RowGroup>

        <SectionHeader>通用</SectionHeader>
        <RowGroup onAction={handleSettingAction}>
          <Row icon={GearIcon} title="常规" isFirst isLast={false} />
          <Row icon={Bell} title="通知" isLast={false} />
          <Row icon={Volume2} title="语音" isLast={false} />
          <Row icon={ShieldCheck} title="安全" isLast={false} />
          <Row icon={HardDrive} title="存储" isLast={false} />
          <Row icon={Bug} title="报告错误" actionId="report-error" isLast={false} />
          <Row icon={Info} title="关于" actionId="about" isLast />
        </RowGroup>

        <View style={styles.logoutSpacer} />
        <RowGroup onAction={handleSettingAction}>
          <Row
            icon={LogOut}
            title={disconnecting ? '正在断开…' : '退出登录'}
            actionId="disconnect-host"
            isFirst
            isLast
            destructive
          />
        </RowGroup>

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
    paddingTop: 8,
    paddingHorizontal: 20,
    paddingBottom: 48,
  },
  profileSection: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 24,
  },
  avatarWrap: {
    width: 96,
    height: 96,
    marginBottom: 16,
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
