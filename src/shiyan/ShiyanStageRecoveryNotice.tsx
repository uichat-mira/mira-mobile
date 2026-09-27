import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CircleAlert } from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme/tokens';
import { localCaptureRepository } from './recording/localCaptureRepository';
import { shiyanSubmissionRepository } from './submissionRepository';
import type { ShiyanStageRecoveryPresentation } from './taskPresentation';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export function ShiyanStageRecoveryNotice({
  recovery,
  busy,
  onRetry,
  onOpenDetails,
}: {
  recovery: ShiyanStageRecoveryPresentation;
  busy: boolean;
  onRetry?: () => void;
  onOpenDetails: () => void;
}) {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<RouteProp<RootStackParamList, 'ShiyanTaskDetail'>>();
  const { colors } = useTheme();
  const [uploadRecoveryCaptureId, setUploadRecoveryCaptureId] = useState<string | null>(null);
  const [uploadRecoveryChecked, setUploadRecoveryChecked] = useState(false);
  const resumeUpload = recovery.retryAction === 'resume-upload';

  useFocusEffect(
    useCallback(() => {
      if (!resumeUpload) {
        setUploadRecoveryCaptureId(null);
        setUploadRecoveryChecked(true);
        return undefined;
      }

      let active = true;
      setUploadRecoveryChecked(false);
      void (async () => {
        const routeCaptureId = route.params.localCaptureId ?? null;
        const routeCapture = routeCaptureId
          ? await localCaptureRepository.get(routeCaptureId)
          : null;
        const pointer = routeCapture
          ? null
          : await shiyanSubmissionRepository.findByTaskId(route.params.taskId);
        const pointerCapture = pointer?.localCaptureId
          ? await localCaptureRepository.get(pointer.localCaptureId)
          : null;
        const capture = routeCapture ?? pointerCapture;
        if (!active) return;
        setUploadRecoveryCaptureId(capture ? capture.id : null);
        setUploadRecoveryChecked(true);
      })().catch(() => {
        if (!active) return;
        setUploadRecoveryCaptureId(null);
        setUploadRecoveryChecked(true);
      });

      return () => {
        active = false;
      };
    }, [resumeUpload, route.params.localCaptureId, route.params.taskId]),
  );

  const supportingText = resumeUpload
    ? !uploadRecoveryChecked
      ? '上传没有完成，正在确认本机录音是否仍可继续。'
      : uploadRecoveryCaptureId
        ? '本地录音仍然安全，可以回到现有提交流程继续上传。'
        : '当前设备没有找到可继续上传的本地录音，请查看处理详情确认下一步。'
    : recovery.supportingText;

  const retryAvailable = resumeUpload
    ? Boolean(uploadRecoveryCaptureId)
    : Boolean(recovery.retryAction && recovery.retryLabel && onRetry);

  const handleRetry = () => {
    if (resumeUpload) {
      if (!uploadRecoveryCaptureId) return;
      navigation.navigate('ShiyanCaptureConfirm', { captureId: uploadRecoveryCaptureId });
      return;
    }
    onRetry?.();
  };

  return (
    <View
      style={[
        styles.notice,
        { backgroundColor: colors.bg.card, borderColor: colors.border.default },
      ]}
    >
      <View style={styles.titleRow}>
        <CircleAlert size={18} color={colors.status.error} />
        <Text style={[styles.title, { color: colors.text.ink }]}>{recovery.title}</Text>
      </View>
      <Text style={[styles.supporting, { color: colors.text.base }]}>
        {supportingText}
      </Text>
      <View style={styles.actions}>
        {retryAvailable && recovery.retryLabel ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={handleRetry}
            style={({ pressed }) => [
              styles.retryButton,
              {
                backgroundColor: pressed ? colors.primaryActive : colors.primary,
                opacity: busy ? 0.55 : 1,
              },
            ]}
          >
            <Text style={[styles.retryText, { color: colors.onPrimary }]}>
              {busy ? '正在重试' : recovery.retryLabel}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={onOpenDetails}
          style={[styles.detailButton, { borderColor: colors.border.default }]}
        >
          <Text style={[styles.detailText, { color: colors.primary }]}>查看处理详情</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: { flex: 1, fontSize: 15, fontWeight: '700' },
  supporting: { fontSize: 13, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  retryButton: {
    minHeight: 40,
    borderRadius: radius.full,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  retryText: { fontSize: 13, fontWeight: '700' },
  detailButton: {
    minHeight: 40,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  detailText: { fontSize: 13, fontWeight: '600' },
});
