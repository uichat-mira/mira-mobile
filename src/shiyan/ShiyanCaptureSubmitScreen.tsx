import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useFocusEffect,
  useIsFocused,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CloudUpload,
  FileAudio,
  Trash2,
} from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme/tokens';
import {
  localCaptureRepository,
  type LocalCaptureMetadata,
} from './recording/localCaptureRepository';
import {
  AudioPlayer,
  type AudioPlayerHandle,
} from './playback/AudioPlayer';
import {
  confirmableSceneOrThrow,
  resolveSelectedScene,
  selectableScenesForCapture,
} from './confirmation/sceneConfirmation';
import {
  canonicalShiyanSceneId,
  getCustomSceneDraft,
  toShiyanSceneSnapshot,
} from './scenes';
import { submitLocalCapture, type SubmitCaptureProgress } from './submitCapture';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export const confirmationProgressLabel = (
  progress: SubmitCaptureProgress | null,
) => {
  if (!progress) return '开始整理';
  if (progress.phase === 'uploading') {
    return `正在上传 ${Math.round((progress.uploadFraction ?? 0) * 100)}%`;
  }
  return '正在提交…';
};

export function ShiyanCaptureSubmitScreen() {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<RouteProp<RootStackParamList, 'ShiyanCaptureConfirm'>>();
  const isFocused = useIsFocused();
  const { colors } = useTheme();
  const audioPlayerRef = useRef<AudioPlayerHandle>(null);
  const [capture, setCapture] = useState<LocalCaptureMetadata | null>(null);
  const [title, setTitle] = useState('');
  const [sceneId, setSceneId] = useState('');
  const [sceneSheetOpen, setSceneSheetOpen] = useState(false);
  const [progress, setProgress] = useState<SubmitCaptureProgress | null>(null);
  const [errorText, setErrorText] = useState('');
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void localCaptureRepository.get(route.params.captureId).then((next) => {
        if (!active || !next) return;
        setCapture(next);
        setTitle(next.title);
        setSceneId(
          canonicalShiyanSceneId(next.sceneSnapshot?.id ?? next.sceneId),
        );
      });
      return () => {
        active = false;
      };
    }, [route.params.captureId]),
  );

  const scenes = useMemo(
    () => selectableScenesForCapture(capture, getCustomSceneDraft()),
    [capture],
  );

  const selectedScene = resolveSelectedScene(scenes, sceneId);

  const confirmLocally = async () => {
    if (!capture) return null;
    const scene = confirmableSceneOrThrow(scenes, sceneId);
    const snapshot = toShiyanSceneSnapshot(scene);
    return localCaptureRepository.confirm({
      id: capture.id,
      title,
      sceneId: snapshot.id,
      sceneName: snapshot.name,
      sceneSnapshot: snapshot,
    });
  };

  const submit = async () => {
    setBusy(true);
    setErrorText('');
    setProgress({ phase: 'creating_task' });
    try {
      const confirmed = await confirmLocally();
      if (!confirmed) return;
      setCapture(confirmed);
      const taskId = await submitLocalCapture(confirmed, {
        onProgress: setProgress,
      });
      navigation.replace('ShiyanTaskDetail', {
        taskId,
        localCaptureId: confirmed.id,
      });
    } catch (error) {
      setProgress(null);
      setErrorText(
        error instanceof Error
          ? error.message
          : '提交没有完成。本地录音仍然保留，可以直接重试。',
      );
    } finally {
      setBusy(false);
    }
  };

  const saveForLater = async () => {
    setBusy(true);
    try {
      await confirmLocally();
      navigation.navigate('ShiyanLocalDrafts');
    } catch (error) {
      Alert.alert(
        '无法保存',
        error instanceof Error ? error.message : '请检查标题与场景。',
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!capture) return;
    Alert.alert(
      '删除这条本地录音？',
      '本地录音文件会永久删除。云端任务（若已创建）不会被伪装成已删除。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除本地文件',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await audioPlayerRef.current?.dispose();
              await localCaptureRepository.delete(capture.id);
              navigation.navigate('ShiyanLocalDrafts');
            })().catch((error) => {
              Alert.alert(
                '无法删除',
                error instanceof Error
                  ? error.message
                  : '本地录音未能删除，请稍后重试。',
              );
            });
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.bg.canvas }]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          onPress={() => navigation.goBack()}
          style={styles.headerButton}
        >
          <ArrowLeft size={22} color={colors.text.ink} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text.ink }]}>确认并提交</Text>
        <View style={styles.headerButton} />
      </View>

      {!capture ? (
        <View style={styles.centerState}>
          <FileAudio size={34} color={colors.text.soft} />
          <Text style={{ color: colors.text.soft }}>正在读取本地录音…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <AudioPlayer
            ref={audioPlayerRef}
            source={capture.filePath}
            fallbackDurationMs={capture.durationMs}
            detailText={`${formatSize(capture.fileSizeBytes)} · 已安全保存在手机`}
            disabled={busy}
            active={isFocused}
          />

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.text.base }]}>标题</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              editable={!busy}
              placeholder="例如：8 月 29 日产品评审"
              placeholderTextColor={colors.text.soft}
              style={[
                styles.input,
                {
                  color: colors.text.ink,
                  backgroundColor: colors.bg.card,
                  borderColor: colors.border.default,
                },
              ]}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.text.base }]}>场景</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="修改场景"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => setSceneSheetOpen(true)}
              style={({ pressed }) => [
                styles.sceneRow,
                {
                  borderColor: colors.border.default,
                  backgroundColor: pressed ? colors.bg.soft : colors.bg.card,
                },
              ]}
            >
              <Text
                style={[
                  styles.sceneValue,
                  { color: selectedScene ? colors.text.ink : colors.text.soft },
                ]}
              >
                {selectedScene ? selectedScene.name : '请选择场景'}
              </Text>
              <ChevronRight size={18} color={colors.text.soft} />
            </Pressable>
          </View>

          {errorText ? (
            <View
              style={[
                styles.errorBox,
                {
                  borderColor: colors.status.error,
                  backgroundColor: colors.bg.card,
                },
              ]}
            >
              <Text style={[styles.errorTitle, { color: colors.status.error }]}>这次提交没有完成</Text>
              <Text style={[styles.muted, { color: colors.text.base }]}>{errorText}</Text>
              <Text style={[styles.muted, { color: colors.text.soft }]}>录音仍在本机，不需要重新录制。可以在网络恢复后直接重试；若提示 Cloud 未配置，可回到拾言主页的「服务配置」。</Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.primaryButton,
              {
                backgroundColor: busy
                  ? colors.primaryDisabled
                  : pressed
                    ? colors.primaryActive
                    : colors.primary,
              },
            ]}
          >
            <CloudUpload size={19} color={colors.onPrimary} />
            <Text style={[styles.primaryText, { color: colors.onPrimary }]}>
              {confirmationProgressLabel(progress)}
            </Text>
          </Pressable>

          <View style={styles.secondaryArea}>
            <Text style={[styles.muted, { color: colors.text.soft }]}>录音已经保存在手机。现在返回也不会丢失，可以之后再继续处理。</Text>
            <View style={styles.secondaryActions}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void saveForLater()}
                style={({ pressed }) => [
                  styles.textAction,
                  pressed && { backgroundColor: colors.bg.soft },
                ]}
              >
                <Text style={[styles.textActionLabel, { color: colors.primary }]}>稍后处理</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={remove}
                style={({ pressed }) => [
                  styles.textAction,
                  pressed && { backgroundColor: colors.bg.soft },
                ]}
              >
                <Trash2 size={16} color={colors.text.soft} />
                <Text style={[styles.textActionLabel, { color: colors.text.soft }]}>删除本地录音</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      )}

      <Modal
        visible={sceneSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSceneSheetOpen(false)}
      >
        <Pressable
          accessibilityLabel="关闭场景选择"
          style={styles.sheetBackdrop}
          onPress={() => setSceneSheetOpen(false)}
        >
          <View
            style={[styles.sheetPanel, { backgroundColor: colors.bg.card }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.sheetTitle, { color: colors.text.ink }]}>选择场景</Text>
            <ScrollView style={styles.sheetList} bounces={false}>
              {scenes.map((scene) => {
                const selected =
                  canonicalShiyanSceneId(scene.id) ===
                  canonicalShiyanSceneId(sceneId);
                return (
                  <Pressable
                    key={scene.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setSceneId(scene.id);
                      setSceneSheetOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.sheetRow,
                      {
                        backgroundColor:
                          pressed || selected ? colors.bg.soft : colors.bg.card,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: colors.text.ink,
                        fontWeight: selected ? '600' : '400',
                      }}
                    >
                      {scene.name}
                    </Text>
                    {selected ? <Check size={18} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              onPress={() => setSceneSheetOpen(false)}
              style={[
                styles.sheetCancelButton,
                { borderColor: colors.border.default },
              ]}
            >
              <Text style={{ color: colors.text.ink, fontWeight: '600' }}>取消</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '600',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 56,
    gap: spacing.lg,
  },
  fieldGroup: { gap: spacing.sm },
  muted: { fontSize: 13, lineHeight: 19 },
  label: { fontSize: 13, fontWeight: '600' },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 15,
  },
  sceneRow: {
    minHeight: 50,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sceneValue: { flex: 1, fontSize: 15, fontWeight: '600' },
  errorBox: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  errorTitle: { fontSize: 14, fontWeight: '700' },
  primaryButton: {
    minHeight: 50,
    borderRadius: radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  primaryText: { fontSize: 15, fontWeight: '600' },
  secondaryArea: { gap: spacing.sm, paddingHorizontal: spacing.xs },
  secondaryActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  textAction: {
    minHeight: 44,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  textActionLabel: { fontSize: 13, fontWeight: '600' },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  sheetPanel: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.lg,
    maxHeight: '70%',
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  sheetList: { paddingHorizontal: spacing.md },
  sheetRow: {
    minHeight: 50,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetCancelButton: {
    minHeight: 46,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
});
