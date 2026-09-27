import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ArrowLeft, FileText } from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import { UnifiedRecordRow } from './UnifiedRecordRow';
import { loadUnifiedRecords, type UnifiedRecordPresentation } from './unifiedRecords';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export function ShiyanHistoryScreen() {
  const navigation = useNavigation<NavProp>();
  const { colors } = useTheme();
  const [records, setRecords] = useState<readonly UnifiedRecordPresentation[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [cloudWarning, setCloudWarning] = useState('');

  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    setErrorText('');
    setCloudWarning('');
    void loadUnifiedRecords()
      .then((result) => {
        if (!active) return;
        setRecords(result.records);
        setCloudWarning(result.cloudError ? '部分 Cloud 记录暂时不可用，本地记录仍可继续查看。' : '');
      })
      .catch((error) => {
        if (active) setErrorText(error instanceof Error ? error.message : '无法读取拾言记录。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(load);

  const openRecord = (record: UnifiedRecordPresentation) => {
    if (record.taskId) {
      navigation.navigate('ShiyanTaskDetail', {
        taskId: record.taskId,
        localCaptureId: record.localCaptureId,
      });
    } else {
      navigation.navigate('ShiyanCaptureConfirm', { captureId: record.localCaptureId });
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg.canvas }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => navigation.goBack()} style={styles.headerButton}>
          <ArrowLeft size={22} color={colors.text.ink} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text.ink }]}>全部记录</Text>
        <View style={styles.headerButton} />
      </View>

      {loading && records.length === 0 ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.text.soft }}>正在读取拾言记录…</Text>
        </View>
      ) : errorText && records.length === 0 ? (
        <View style={styles.centerState}>
          <FileText size={34} color={colors.text.soft} />
          <Text style={[styles.stateTitle, { color: colors.text.ink }]}>记录读取失败</Text>
          <Text style={[styles.stateText, { color: colors.text.soft }]}>{errorText}</Text>
          <Pressable accessibilityRole="button" onPress={() => load()} style={[styles.retryButton, { borderColor: colors.border.default }]}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>重新加载</Text>
          </Pressable>
        </View>
      ) : records.length === 0 ? (
        <View style={styles.centerState}>
          <FileText size={34} color={colors.text.soft} />
          <Text style={[styles.stateTitle, { color: colors.text.ink }]}>
            {cloudWarning ? 'Cloud 记录暂时不可用' : '还没有拾言记录'}
          </Text>
          {cloudWarning ? (
            <>
              <Text style={[styles.stateText, { color: colors.text.soft }]}>{cloudWarning}</Text>
              <Pressable accessibilityRole="button" onPress={() => load()} style={[styles.retryButton, { borderColor: colors.border.default }]}>
                <Text style={{ color: colors.primary, fontWeight: '600' }}>重新加载</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {cloudWarning ? (
            <View style={[styles.notice, { backgroundColor: colors.bg.soft }]}>
              <Text style={[styles.noticeText, { color: colors.text.base }]}>{cloudWarning}</Text>
            </View>
          ) : null}
          <View style={[styles.recordGroup, { backgroundColor: colors.bg.card, borderColor: colors.border.default }]}>
            {records.map((record, index) => (
              <UnifiedRecordRow key={record.id} record={record} onPress={() => openRecord(record)} showDivider={index < records.length - 1} />
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '600' },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  stateTitle: { fontSize: 18, fontWeight: '600' },
  stateText: { fontSize: fontSize.button, lineHeight: 21, textAlign: 'center' },
  retryButton: { minHeight: sizing.touchTarget, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.full, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  notice: { borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  noticeText: { fontSize: fontSize.xs, lineHeight: 18 },
  recordGroup: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
});
