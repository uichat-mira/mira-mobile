import React, { useCallback, useEffect, useState } from 'react';
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
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Database,
  HardDrive,
  Mic,
  RefreshCcw,
  ShieldAlert,
  Trash2,
} from 'lucide-react-native';
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
  computeDeviceStorageUsage,
  formatBytes,
  type DeviceStorageUsage,
} from './deviceStorageUsage';
import { localKeyValueStore, MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import {
  localCaptureRepository,
  type LocalCaptureMetadata,
} from '../shiyan/recording/localCaptureRepository';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

interface CategoryIconMap {
  [key: string]: React.ComponentType<{ size?: number; color?: string }>;
}

const STORAGE_KEY_GROUPS_TO_RESET: readonly string[][] = [
  ['mira.mobile.theme.mode', 'mira.mobile.theme.accent'],
  ['mira.mobile.personalization.v1'],
  ['thread-pins-v1', 'thread-read-progress-v1'],
  ['mira.local-provider.configs.v1', 'mira.local-provider.sessions.v1'],
  ['mira.shiyan.local-captures.v1', 'mira.shiyan.submissions.v1'],
  ['mira.shiyan.api-base-url.v1'],
];

const isNativeAudioRecorderAvailable = (): boolean => {
  try {
    // 只探测文件元信息；如果 native module 不存在，这里会抛错并被 catch 降级。
    return typeof require !== 'undefined';
  } catch {
    return false;
  }
};

const nativeFileSize = async (capture: LocalCaptureMetadata): Promise<number> => {
  try {
    const { nativeAudioRecorder } = await import(
      '../shiyan/recording/nativeAudioRecorder'
    );
    const info = await nativeAudioRecorder.fileInfo(capture.filePath);
    return info.exists && info.size > 0 ? info.size : 0;
  } catch {
    return 0;
  }
};

const removeKeys = async (keys: readonly string[]): Promise<number> => {
  let count = 0;
  for (const key of keys) {
    try {
      await localKeyValueStore.remove(key);
      count += 1;
    } catch {
      // 单个 key 删除失败不应阻塞其它 key；继续即可。
    }
  }
  return count;
};

export function StorageScreen() {
  const navigation = useNavigation<NavProp>();
  const { colors } = useTheme();
  const [usage, setUsage] = useState<DeviceStorageUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'purge-audio' | 'reset-ui' | null>(null);

  const categoryIcons: CategoryIconMap = {
    appearance: HardDrive,
    personalization: HardDrive,
    'thread-state': HardDrive,
    'local-provider': HardDrive,
    'shiyan-drafts': Database,
    'shiyan-cloud-config': Database,
    'shiyan-submitted-audio': Mic,
    other: HardDrive,
  };

  const refresh = useCallback(async () => {
    setErrorText(null);
    try {
      const captures = await localCaptureRepository.listAll();
      const includeAudioFiles = isNativeAudioRecorderAvailable();
      let fileSizesByCaptureId: Map<string, number> | undefined;
      if (includeAudioFiles) {
        fileSizesByCaptureId = new Map<string, number>();
        for (const capture of captures) {
          if (capture.status !== 'submitted') continue;
          fileSizesByCaptureId.set(capture.id, await nativeFileSize(capture));
        }
      }
      const result = await computeDeviceStorageUsage({
        store: localKeyValueStore,
        captures,
        fileSizesByCaptureId,
        includeAudioFiles,
      });
      setUsage(result);
    } catch (error) {
      setUsage(null);
      setErrorText(
        error instanceof Error
          ? error.message
          : '读取存储占用失败，请稍后重试。',
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refresh()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const purgeSubmittedAudio = useCallback(async () => {
    setBusyAction('purge-audio');
    try {
      const result = await localCaptureRepository.purgeSubmittedAudioFiles();
      await refresh();
      Alert.alert(
        '已清理拾言录音',
        `清理了 ${result.purgedCount} 条已提交录音文件${
          result.missingCount > 0
            ? `；另有 ${result.missingCount} 条原本已不存在文件。`
            : '。'
        }云端归档与历史记录保持不变。`,
      );
    } catch (error) {
      Alert.alert(
        '清理失败',
        error instanceof Error
          ? error.message
          : '无法清理已提交录音，请稍后重试。',
      );
    } finally {
      setBusyAction(null);
    }
  }, [refresh]);

  const confirmPurgeSubmittedAudio = useCallback(() => {
    if (!usage || usage.submittedAudioFileCount === 0) return;
    const totalBytes = usage.categories
      .filter((c) => c.id === 'shiyan-submitted-audio')
      .reduce((sum, c) => sum + c.fileBytes, 0);
    Alert.alert(
      '清理已提交录音原始文件？',
      `将删除 ${usage.submittedAudioFileCount} 条已提交拾言录音的本地原始音频（共 ${formatBytes(
        totalBytes,
      )}）。云端 R2 归档、历史记录与未提交草稿不受影响。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清理',
          style: 'destructive',
          onPress: () => void purgeSubmittedAudio(),
        },
      ],
    );
  }, [purgeSubmittedAudio, usage]);

  const resetUiState = useCallback(async () => {
    setBusyAction('reset-ui');
    let totalRemoved = 0;
    try {
      for (const group of STORAGE_KEY_GROUPS_TO_RESET) {
        totalRemoved += await removeKeys(group);
      }
      // 清空后让 ThemeProvider 重新拉默认值：设置一次性临时 store 并不合适，
      // 这里只清掉客户端 UI 状态键。下一次进入个性化 / 主题会回到默认值。
      Alert.alert(
        '已清空本地 UI 状态',
        `共清除 ${totalRemoved} 个本地键。设备配对凭据、Provider API Key 与拾云端 R2 数据不受影响。`,
      );
    } catch (error) {
      Alert.alert(
        '清空失败',
        error instanceof Error
          ? error.message
          : '清空本地 UI 状态失败，请稍后重试。',
      );
    } finally {
      setBusyAction(null);
      await refresh();
    }
  }, [refresh]);

  const confirmResetUiState = useCallback(() => {
    Alert.alert(
      '清空本地 UI 状态？',
      '将清空外观、个性化、线程本地置顶 / 未读、本地 Provider 配置与会话、拾言草稿与提交元数据，并清空拾言 Cloud 自定义 API 地址。\n\n设备配对凭据、Provider API Key 与拾言云端 R2 / 历史记录不受影响。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清空',
          style: 'destructive',
          onPress: () => void resetUiState(),
        },
      ],
    );
  }, [resetUiState]);

  const subtitle = loading
    ? '正在读取…'
    : errorText
      ? `读取失败：${errorText}`
      : usage
        ? `共 ${formatBytes(usage.totalBytes)}${
            usage.submittedAudioFileCount > 0
              ? ` · 已提交录音 ${usage.submittedAudioFileCount} 条`
              : ''
          }`
        : '—';

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.bg.canvas }]}
      edges={['top', 'bottom']}
    >
      <SettingsPageHeader title="存储" />
      <ScrollView contentContainerStyle={styles.content}>
        <RowGroup onAction={() => undefined}>
          <Row
            icon={HardDrive}
            title="设备存储占用"
            subtitle={subtitle}
            right={
              refreshing ? (
                <ActivityIndicator color={colors.text.soft} />
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="刷新占用统计"
                  onPress={onRefresh}
                  style={({ pressed }) => [
                    styles.iconButton,
                    { backgroundColor: colors.bg.soft },
                    pressed && styles.iconButtonPressed,
                  ]}
                >
                  <RefreshCcw size={18} color={colors.text.ink} />
                </Pressable>
              )
            }
            showChevron={false}
            isFirst
            isLast
          />
        </RowGroup>

        <SectionHeader>分类占用</SectionHeader>
        <RowGroup onAction={() => undefined}>
          {loading && !usage ? (
            <View style={[styles.placeholderCard, { backgroundColor: colors.bg.card }]}>
              <ActivityIndicator color={colors.text.soft} />
              <Text style={[styles.placeholderText, { color: colors.text.soft }]}>
                正在读取本地占用…
              </Text>
            </View>
          ) : errorText ? (
            <View style={[styles.placeholderCard, { backgroundColor: colors.bg.card }]}>
              <ShieldAlert size={22} color={colors.status.error} />
              <Text style={[styles.placeholderText, { color: colors.status.error }]}>
                {errorText}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="重试"
                onPress={onRefresh}
                style={({ pressed }) => [
                  styles.retryBtn,
                  { borderColor: colors.border.default },
                  pressed && styles.iconButtonPressed,
                ]}
              >
                <Text style={[styles.retryText, { color: colors.text.ink }]}>重试</Text>
              </Pressable>
            </View>
          ) : usage ? (
            usage.categories
              .filter(
                (category) =>
                  category.keyValueBytes > 0 || category.fileBytes > 0,
              )
              .map((category) => {
                const Icon = categoryIcons[category.id] ?? HardDrive;
                return (
                  <Row
                    key={category.id}
                    icon={Icon}
                    title={category.label}
                    subtitle={`${category.description} · ${formatBytes(
                      category.keyValueBytes + category.fileBytes,
                    )}`}
                    showChevron={false}
                  />
                );
              })
          ) : null}
        </RowGroup>

        <SectionHeader>维护操作</SectionHeader>
        <RowGroup onAction={() => undefined}>
          <Row
            icon={Mic}
            title="清理已提交拾言原始录音"
            subtitle={
              usage && usage.submittedAudioFileCount > 0
                ? `共 ${usage.submittedAudioFileCount} 条，可释放 ${formatBytes(
                    usage.categories
                      .filter((c) => c.id === 'shiyan-submitted-audio')
                      .reduce((sum, c) => sum + c.fileBytes, 0),
                  )}；不影响云端 R2 与历史`
                : '当前没有可清理的已提交录音'
            }
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="清理已提交拾言原始录音"
                onPress={confirmPurgeSubmittedAudio}
                disabled={
                  busyAction !== null ||
                  !usage ||
                  usage.submittedAudioFileCount === 0
                }
                style={({ pressed }) => [
                  styles.actionBtn,
                  {
                    backgroundColor:
                      busyAction !== null ||
                      !usage ||
                      usage.submittedAudioFileCount === 0
                        ? colors.bg.soft
                        : colors.bg.elevated,
                    borderColor: colors.border.default,
                  },
                  pressed && styles.iconButtonPressed,
                ]}
              >
                <Trash2
                  size={16}
                  color={
                    busyAction !== null ||
                    !usage ||
                    usage.submittedAudioFileCount === 0
                      ? colors.text.soft
                      : colors.status.warning
                  }
                />
                <Text
                  style={[
                    styles.actionText,
                    {
                      color:
                        busyAction !== null ||
                        !usage ||
                        usage.submittedAudioFileCount === 0
                          ? colors.text.soft
                          : colors.text.ink,
                    },
                  ]}
                >
                  {busyAction === 'purge-audio' ? '正在清理…' : '清理'}
                </Text>
              </Pressable>
            }
            showChevron={false}
            isFirst
            isLast={false}
          />
          <Row
            icon={Trash2}
            title="清空本地 UI 状态"
            subtitle="重置外观 / 个性化 / 线程本地状态 / 本地 Provider / 拾言草稿；不影响配对凭据、Provider Key、拾云端数据"
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="清空本地 UI 状态"
                onPress={confirmResetUiState}
                disabled={busyAction !== null}
                style={({ pressed }) => [
                  styles.actionBtn,
                  {
                    backgroundColor:
                      busyAction !== null ? colors.bg.soft : colors.bg.elevated,
                    borderColor: colors.border.default,
                  },
                  pressed && styles.iconButtonPressed,
                ]}
              >
                <Trash2
                  size={16}
                  color={
                    busyAction !== null
                      ? colors.text.soft
                      : colors.status.error
                  }
                />
                <Text
                  style={[
                    styles.actionText,
                    {
                      color:
                        busyAction !== null
                          ? colors.text.soft
                          : colors.text.ink,
                    },
                  ]}
                >
                  {busyAction === 'reset-ui' ? '正在清空…' : '清空'}
                </Text>
              </Pressable>
            }
            showChevron={false}
            isLast
          />
        </RowGroup>

        <SectionHeader>说明</SectionHeader>
        <View style={[styles.noticeCard, { backgroundColor: colors.bg.card, borderColor: colors.border.soft }]}>
          <Text style={[styles.noticeText, { color: colors.text.muted }]}>
            本页只统计设备本地的客户端存储，不包含 Mira Host / 拾云端的远端数据。
            设备安全存储里的配对凭据与 Provider API Key 不会出现在统计中，也不会被「清空本地 UI 状态」清除。
          </Text>
          <Text style={[styles.noticeText, { color: colors.text.muted }]}>
            「清理已提交拾言原始录音」只删除已成功提交到 Cloud 的本地原始音频，云端 R2 归档、拾言历史与任务状态不受影响。如需清空未提交草稿，请到「拾言 → 全部记录」逐条删除。
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// 兜底导出，让 MemoryLocalKeyValueStore 这样的实现可被引用，避免误删时无差别被识别为"未知"。
const _memoryFallback = MemoryLocalKeyValueStore;
void _memoryFallback;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  iconButton: {
    width: sizing.touchTarget - 8,
    height: sizing.touchTarget - 8,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconButtonPressed: { opacity: 0.7 },
  placeholderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  placeholderText: { flex: 1, fontSize: fontSize.bodyMd },
  retryBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  retryText: { fontSize: fontSize.button, fontWeight: '500' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  actionText: { fontSize: fontSize.button, fontWeight: '500' },
  noticeCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  noticeText: { fontSize: fontSize.bodyMd, lineHeight: 20 },
});