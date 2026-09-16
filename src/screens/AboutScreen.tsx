import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BookOpen, FileBadge, Smartphone } from 'lucide-react-native';
import { releaseChannel } from 'mira-release-channel';
import { version } from '../../package.json';
import type { RootStackParamList } from '../types/navigation';
import { useTheme } from '../theme/ThemeContext';
import { spacing } from '../theme/tokens';
import { SettingsPageHeader } from '../components/settings/SettingsPageHeader';
import { SettingsGroup, SettingsRow } from '../components/settings/SettingsComponents';
import {
  fetchLatestRelease,
  isUpdateAvailable,
  type AppRelease,
} from '../update/appUpdate';
import { parseSemver } from '../update/semver';

type UpdateCheckStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'current'
  | 'failed';

const channelLabel = {
  predev: '预开发',
  dev: '开发',
  test: '测试',
  prod: '正式',
}[releaseChannel];
const installedDisplayVersion =
  releaseChannel === 'prod' ? version : `${version}-${releaseChannel}`;

const releaseNotesPreview = (notes: string | null): string => {
  const firstLine = notes
    ?.split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return '';
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
};

export function AboutScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const platformName = Platform.OS === 'android' ? 'Android' : 'iOS';
  const [updateStatus, setUpdateStatus] = useState<UpdateCheckStatus>('idle');
  const [latestRelease, setLatestRelease] = useState<AppRelease | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const checkForUpdate = useCallback(async () => {
    setUpdateStatus((previous) => (previous === 'checking' ? previous : 'checking'));
    setUpdateError(null);
    try {
      const latest = await fetchLatestRelease(releaseChannel, fetch);
      setLatestRelease(latest);
      setUpdateStatus(
        isUpdateAvailable(parseSemver(version)!, latest) ? 'available' : 'current',
      );
    } catch (error) {
      // A failed or invalid R2 manifest remains retryable; it must never be
      // presented as proof that the installed build is current.
      setLatestRelease(null);
      setUpdateError(
        error instanceof Error && error.message
          ? error.message
          : '检查更新失败，请稍后重试。',
      );
      setUpdateStatus('failed');
    }
  }, []);

  useEffect(() => {
    void checkForUpdate();
  }, [checkForUpdate]);

  const openDownload = (latest: AppRelease) => {
    const notes = releaseNotesPreview(latest.notes);

    if (Platform.OS !== 'android') {
      Alert.alert(
        '发现新版本',
        `当前版本 ${installedDisplayVersion}\n最新版本 ${latest.displayVersion}${
          notes ? `\n\n${notes}` : ''
        }\n\niOS 当前没有可直接安装的已签名分发产物。`,
      );
      return;
    }

    Alert.alert(
      '下载新版本',
      `当前版本 ${installedDisplayVersion}\n最新版本 ${latest.displayVersion}${
        notes ? `\n\n${notes}` : ''
      }\n\n确认后将使用系统下载。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '下载',
          onPress: () => {
            Linking.openURL(latest.apkUrl).catch(() => {
              Alert.alert('打开下载失败', '请稍后重试。');
            });
          },
        },
      ],
    );
  };

  const handleUpdateAction = () => {
    switch (updateStatus) {
      case 'checking':
        return;
      case 'available':
        if (latestRelease) openDownload(latestRelease);
        return;
      case 'failed':
        Alert.alert('检查更新失败', updateError ?? '请稍后重试。', [
          { text: '取消', style: 'cancel' },
          { text: '重试', onPress: () => void checkForUpdate() },
        ]);
        return;
      default:
        Alert.alert(
          '版本信息',
          `当前版本 ${installedDisplayVersion}（${channelLabel}渠道）${
            latestRelease ? `\n最新发布 ${latestRelease.displayVersion}` : ''
          }`,
        );
    }
  };

  const handleAction = (actionId: string) => {
    if (actionId === 'documentation') {
      Linking.openURL('https://tomz.io').catch(() => {});
    } else if (actionId === 'license') {
      navigation.navigate('License');
    } else if (actionId === 'app-update') {
      handleUpdateAction();
    }
  };

  const updateSubtitle = (() => {
    switch (updateStatus) {
      case 'checking':
        return `${installedDisplayVersion} · 正在检查更新…`;
      case 'available':
        return `${installedDisplayVersion} · 有新版本 ${latestRelease?.displayVersion ?? ''}`;
      case 'current':
        return `${installedDisplayVersion} · 已是最新`;
      case 'failed':
        return `${installedDisplayVersion} · 检查更新失败，点击重试`;
      default:
        return installedDisplayVersion;
    }
  })();

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg.canvas }]} edges={['top', 'bottom']}>
      <SettingsPageHeader title="关于" />
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsGroup onAction={handleAction}>
          <SettingsRow icon={BookOpen} title="文档" actionId="documentation" isFirst isLast={false} />
          <SettingsRow icon={FileBadge} title="许可证" subtitle="MIT" actionId="license" isLast={false} />
          <SettingsRow
            icon={Smartphone}
            title={`${platformName} 版 UIChat Mira`}
            subtitle={updateSubtitle}
            actionId="app-update"
            right={
              updateStatus === 'available' ? (
                <View
                  accessibilityLabel="有可用更新"
                  style={[styles.updateDot, { backgroundColor: colors.status.error }]}
                />
              ) : undefined
            }
            isLast
          />
        </SettingsGroup>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.lg },
  updateDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
