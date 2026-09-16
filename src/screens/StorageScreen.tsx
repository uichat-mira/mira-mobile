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
import {
  Database,
  HardDrive,
  Mic,
  RefreshCcw,
  ShieldAlert,
  Trash2,
} from 'lucide-react-native';
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
import { localKeyValueStore } from '../storage/localKeyValueStore';
import { localCaptureRepository } from '../shiyan/recording/localCaptureRepository';

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

interface AudioSupportProbe {
  /** 探测返回的录音模块；null 表示不可用。 */
  module: typeof import('../shiyan/recording/nativeAudioRecorder').nativeAudioRecorder | null;
  /** 探测过程中抛出的错误。 */
  error: unknown;
}

const probeNativeAudioRecorder = async (): Promise<AudioSupportProbe> => {
  try {
    const mod = await import('../shiyan/recording/nativeAudioRecorder');
    // 主动调一次 fileInfo 用一个不存在的路径；如果 module 不存在会抛错。
    await mod.nativeAudioRecorder.fileInfo('__storage_probe__');
    return { module: mod.nativeAudioRecorder, error: null };
  } catch (error) {
    return { module: null, error };
  }
};

const removeKeys = async (
  keys: readonly string[],
): Promise<{ removed: string[]; failed: string[] }> => {
  const removed: string[] = [];
  const failed: string[] = [];
  for (const key of keys) {
    try {
      await localKeyValueStore.remove(key);
      removed.push(key);
    } catch {
      failed.push(key);
    }
  }
  return { removed, failed };
};

export function StorageScreen() {
  const { colors } = useTheme();
  const [usage, setUsage] = useState<DeviceStorageUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'purge-audio' | 'reset-ui' | null>(null);
  const [audioSupport, setAudioSupport] = useState<AudioSupportProbe>({
    module: null,
    error: null,
  });

  const audioSupportMessage =
    audioSupport.module == null && audioSupport.error instanceof Error
      ? audioSupport.error.message
      : null;

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

  useEffect(() => {
    let cancelled = false;
    probeNativeAudioRecorder().then((probe) => {
      if (!cancelled) setAudioSupport(probe);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    setErrorText(null);
    try {
      const captures = await localCaptureRepository.listAll();
      const recorder = audioSupport.module;
      let fileSizesByCaptureId: Map<string, number> | undefined;
      // 只有当 Native 模块可用、且至少有 submitted capture 时才探测真实大小；
      // 否则基于元数据估算（这样 UI 仍展示，但不允许清理）。
      const submittedCaptures = captures.filter((c) => c.status === 'submitted');
      if (recorder && submittedCaptures.length > 0) {
        fileSizesByCaptureId = new Map<string, number>();
        for (const capture of submittedCaptures) {
          try {
            const info = await recorder.fileInfo(capture.filePath);
            fileSizesByCaptureId.set(capture.id, info.size);
          } catch {
            fileSizesByCaptureId.set(capture.id, 0);
          }
        }
      }
      const result = await computeDeviceStorageUsage({
        store: localKeyValueStore,
        captures,
        fileSizesByCaptureId,
        // 只有 Native 真可用时才计入可清理的拾言文件占用。
        includeAudioFiles: recorder !== null,
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
  }, [audioSupport.module]);

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
      const summaryParts: string[] = [];
      if (result.purgedCount > 0) summaryParts.push(`清理 ${result.purgedCount} 条`);
      if (result.missingCount > 0) summaryParts.push(`${result.missingCount} 条原本不存在文件`);
      if (result.failedCount > 0) summaryParts.push(`${result.failedCount} 条因 I/O 错误未清理`);
      const summary = summaryParts.length > 0 ? summaryParts.join('；') : '没有需要清理的文件';
      Alert.alert(
        '已处理拾言录音',
        `${summary}。云端归档与历史记录保持不变。`,
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
    const removed: string[] = [];
    const failed: string[] = [];
    try {
      for (const group of STORAGE_KEY_GROUPS_TO_RESET) {
        const result = await removeKeys(group);
        removed.push(...result.removed);
        failed.push(...result.failed);
      }
      const title =
        failed.length === 0
          ? '已清空本地 UI 状态'
          : failed.length === removed.length
            ? '清空失败'
            : '已清空本地 UI 状态（部分失败）';
      const lines = [
        `共清除 ${removed.length} 个本地键；${failed.length} 个失败。`,
        '设备配对凭据、Provider API Key 与拾云端 R2 数据不受影响。',
      ];
      if (failed.length > 0 && failed.length < removed.length) {
        lines.push(`未清除：${failed.join('、')}`);
      }
      Alert.alert(title, lines.join('\n\n'));
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

  const purgeDisabled =
    busyAction !== null ||
    !usage ||
    usage.submittedAudioFileCount === 0 ||
    !audioSupport.module;

  const purgeSubtitle = !audioSupport.module
    ? '当前构建未提供录音原生模块，无法读取或清理本地原始录音文件'
    : usage && usage.submittedAudioFileCount > 0
      ? `共 ${usage.submittedAudioFileCount} 条，可释放 ${formatBytes(
          usage.categories
            .filter((c) => c.id === 'shiyan-submitted-audio')
            .reduce((sum, c) => sum + c.fileBytes, 0),
        )}；不影响云端 R2 与历史`
      : '当前没有可清理的已提交录音';

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

        {audioSupportMessage ? (
          <View style={[styles.noticeCard, { backgroundColor: colors.bg.card, borderColor: colors.status.warning }]}>
            <Text style={[styles.noticeText, { color: colors.status.warning }]}>
              {`录音原生模块不可用：${audioSupportMessage}。可继续浏览占用，但「清理已提交拾言原始录音」被禁用。`}
            </Text>
          </View>
        ) : null}

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
            subtitle={purgeSubtitle}
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="清理已提交拾言原始录音"
                onPress={confirmPurgeSubmittedAudio}
                disabled={purgeDisabled}
                style={({ pressed }) => [
                  styles.actionBtn,
                  {
                    backgroundColor: purgeDisabled
                      ? colors.bg.soft
                      : colors.bg.elevated,
                    borderColor: colors.border.default,
                  },
                  pressed && styles.iconButtonPressed,
                ]}
              >
                <Trash2
                  size={16}
                  color={purgeDisabled ? colors.text.soft : colors.status.warning}
                />
                <Text
                  style={[
                    styles.actionText,
                    {
                      color: purgeDisabled ? colors.text.soft : colors.text.ink,
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