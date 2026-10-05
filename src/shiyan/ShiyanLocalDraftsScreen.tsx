import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FileAudio, Trash2 } from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme/tokens';
import { ShiyanScreenShell } from './ShiyanScreenShell';
import type { LocalCaptureMetadata } from './recording/localCaptureRepository';
import { useShiyanLocalDrafts } from './recording/useShiyanLocalDrafts';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

const formatDuration = (durationMs: number) => {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const formatSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function ShiyanLocalDraftsScreen() {
  const navigation = useNavigation<NavProp>();
  const { colors } = useTheme();
  const draftsState = useShiyanLocalDrafts();

  useFocusEffect(draftsState.load);

  const remove = (capture: LocalCaptureMetadata) => {
    Alert.alert('删除这条本地录音？', '删除后无法恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void draftsState.remove(capture.id);
        },
      },
    ]);
  };

  return (
    <ShiyanScreenShell title="本地录音草稿">
      {draftsState.drafts.length === 0 ? (
        <View style={styles.emptyState}>
          <FileAudio size={34} color={colors.text.soft} />
          <Text style={[styles.emptyTitle, { color: colors.text.ink }]}>{draftsState.loading ? '正在检查本地录音' : '没有待处理的本地录音'}</Text>
          <Text style={[styles.emptyText, { color: colors.text.soft }]}>已结束但尚未提交的录音会在 App 重启后继续出现在这里。</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {draftsState.drafts.map((capture) => (
            <View key={capture.id} style={[styles.draftCard, { backgroundColor: colors.bg.card, borderColor: colors.border.default }]}>
              <Pressable accessibilityRole="button" onPress={() => navigation.navigate('ShiyanCaptureConfirm', { captureId: capture.id })} style={styles.draftMain}>
                <Text style={[styles.cardTitle, { color: colors.text.ink }]}>{capture.title || '未命名录音'}</Text>
                <Text style={[styles.cardDescription, { color: colors.text.soft }]}>{capture.sceneName} · {formatDuration(capture.durationMs)} · {formatSize(capture.fileSizeBytes)}</Text>
                <Text style={[styles.structureText, { color: colors.text.base }]}>{capture.status === 'pending_confirmation' ? '待确认标题 / 场景' : '已确认，等待后续提交能力'}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="删除本地录音" onPress={() => remove(capture)} style={styles.trashButton}>
                <Trash2 size={18} color={colors.text.soft} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </ShiyanScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardDescription: { fontSize: 14, lineHeight: 20 },
  structureText: { fontSize: 12, lineHeight: 18 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: spacing.sm },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: spacing.sm },
  emptyText: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  draftCard: { minHeight: 92, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center' },
  draftMain: { flex: 1, padding: spacing.lg, gap: spacing.xs },
  trashButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
});
