import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, sizing, spacing } from '../theme/tokens';
import type { UnifiedRecordPresentation, UnifiedRecordTone } from './unifiedRecords';

const formatRecordTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export function UnifiedRecordRow({
  record,
  onPress,
  showDivider = false,
}: {
  record: UnifiedRecordPresentation;
  onPress: () => void;
  showDivider?: boolean;
}) {
  const { colors } = useTheme();
  const statusColor: Record<UnifiedRecordTone, string> = {
    muted: colors.text.soft,
    primary: colors.primary,
    success: colors.status.success,
    error: colors.status.error,
  };

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        showDivider && {
          borderBottomColor: colors.border.soft,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
        pressed && { backgroundColor: colors.bg.soft },
      ]}
    >
      <View style={styles.main}>
        <Text numberOfLines={1} style={[styles.title, { color: colors.text.ink }]}>
          {record.title}
        </Text>
        <Text numberOfLines={1} style={[styles.meta, { color: colors.text.soft }]}>
          {record.sceneName} · {formatRecordTime(record.createdAt)}
        </Text>
      </View>
      <View style={styles.trailing}>
        <Text style={[styles.status, { color: statusColor[record.statusTone] }]}>
          {record.statusLabel}
        </Text>
        <ChevronRight size={18} color={colors.text.soft} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: sizing.touchTarget,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  main: { flex: 1, gap: spacing.xs },
  trailing: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: { fontSize: fontSize.md, fontWeight: '600' },
  status: {
    flexShrink: 0,
    fontSize: fontSize.xs,
    lineHeight: 18,
    fontWeight: '600',
    includeFontPadding: false,
  },
  meta: { fontSize: fontSize.xs, lineHeight: 18 },
});
