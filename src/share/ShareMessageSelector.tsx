import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import type { ChatMessage } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, spacing } from '../theme/tokens';
import { MAX_SHARE_CARD_MESSAGES } from './shareCardModel';
import {
  buildShareSelectionRows,
  countSelected,
  defaultShareSelection,
  selectedExceedsCardCap,
  selectedShareMessageIds,
  toggleShareSelection,
  type ShareSelectionRow,
} from './shareSelection';

interface ShareMessageSelectorProps {
  visible: boolean;
  messages: readonly ChatMessage[];
  /** True while the captured card is being generated or the share sheet opens. */
  busy: boolean;
  onCancel: () => void;
  onConfirm: (selectedIds: string[]) => void;
}

const PREVIEW_LINES = 2;

/**
 * Full-screen pre-share selection mode. It is a mode of the chat screen rather
 * than a navigation route so it reuses the already-loaded canonical message
 * snapshot: no reload, and no need to pass a whole conversation through
 * navigation params.
 */
export function ShareMessageSelector({
  visible,
  messages,
  busy,
  onCancel,
  onConfirm,
}: ShareMessageSelectorProps) {
  const { colors } = useTheme();
  const rows = useMemo(() => buildShareSelectionRows(messages), [messages]);
  const [selected, setSelected] = useState<Set<string>>(() =>
    defaultShareSelection(rows),
  );

  // Opening the selector always starts from the documented default (all selected)
  // for the currently offered message set.
  useEffect(() => {
    if (!visible) return;
    setSelected(defaultShareSelection(rows));
  }, [visible, rows]);

  const selectedCount = countSelected(rows, selected);
  const exceedsCap = selectedExceedsCardCap(rows, selected);
  const confirmDisabled = busy || selectedCount === 0;

  const handleToggle = useCallback((id: string) => {
    setSelected((current) => toggleShareSelection(current, id));
  }, []);

  const handleConfirm = useCallback(() => {
    if (busy || selectedCount === 0) return;
    onConfirm(selectedShareMessageIds(rows, selected));
  }, [busy, onConfirm, rows, selected, selectedCount]);

  const renderRow = useCallback(
    ({ item }: { item: ShareSelectionRow }) => {
      const checked = selected.has(item.id);
      const roleLabel = item.role === 'user' ? '你' : 'Mira';
      return (
        <Pressable
          testID={'share-selector-row-' + item.id}
          accessibilityRole="checkbox"
          accessibilityState={{ checked, disabled: busy }}
          accessibilityLabel={roleLabel + '：' + item.content}
          disabled={busy}
          onPress={() => handleToggle(item.id)}
          style={({ pressed }) => [
            styles.row,
            { borderColor: colors.border.default },
            pressed && !busy && { backgroundColor: colors.bg.soft },
          ]}
        >
          <View
            style={[
              styles.checkbox,
              { borderColor: checked ? colors.primary : colors.border.default },
              checked && { backgroundColor: colors.primary },
            ]}
          >
            {checked ? <Check size={14} color={colors.onPrimary} strokeWidth={3} /> : null}
          </View>
          <View style={styles.rowText}>
            <Text style={[styles.role, { color: colors.text.soft }]}>{roleLabel}</Text>
            <Text
              style={[styles.preview, { color: colors.text.ink }]}
              numberOfLines={PREVIEW_LINES}
            >
              {item.content}
            </Text>
          </View>
        </Pressable>
      );
    },
    [busy, colors, handleToggle, selected],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bg.canvas }]}>
        <View style={[styles.header, { borderColor: colors.border.default }]}>
          <Pressable
            testID="share-selector-cancel"
            accessibilityRole="button"
            accessibilityLabel="取消选择"
            onPress={onCancel}
            hitSlop={8}
            style={styles.headerAction}
          >
            <Text style={[styles.headerActionText, { color: colors.text.soft }]}>取消</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text.ink }]}>
            选择要分享的内容
          </Text>
          <Pressable
            testID="share-selector-confirm"
            accessibilityRole="button"
            accessibilityLabel={
              confirmDisabled
                ? '分享选中，至少选择一条消息'
                : '分享选中的 ' + selectedCount + ' 条消息'
            }
            accessibilityState={{ disabled: confirmDisabled, busy }}
            disabled={confirmDisabled}
            onPress={handleConfirm}
            hitSlop={8}
            style={[styles.headerAction, confirmDisabled && { opacity: 0.4 }]}
          >
            <Text style={[styles.headerActionText, { color: colors.primary }]}>
              {busy ? '分享中…' : '分享(' + selectedCount + ')'}
            </Text>
          </Pressable>
        </View>

        <FlatList
          testID="share-selector-list"
          data={rows}
          keyExtractor={(item) => item.id}
          renderItem={renderRow}
          contentContainerStyle={styles.listContent}
        />

        <View style={[styles.footer, { borderColor: colors.border.default }]}>
          <Text style={[styles.footerText, { color: colors.text.soft }]}>
            {'已选 ' + selectedCount + ' / ' + rows.length + ' 条'}
          </Text>
          {exceedsCap ? (
            <Text style={[styles.footerHint, { color: colors.status.warning }]}>
              {'分享卡最多包含前 ' + MAX_SHARE_CARD_MESSAGES + ' 条'}
            </Text>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { flexShrink: 1, fontSize: fontSize.titleMd, fontWeight: '700' },
  headerAction: { minWidth: 60, paddingVertical: spacing.xs },
  headerActionText: { fontSize: fontSize.button, fontWeight: '600' },
  listContent: { paddingVertical: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.md,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  rowText: { flex: 1, minWidth: 0 },
  role: { fontSize: fontSize.button, lineHeight: 16 },
  preview: { fontSize: fontSize.button, lineHeight: 20 },
  footer: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerText: { fontSize: fontSize.button },
  footerHint: { fontSize: fontSize.button, lineHeight: 18 },
});
