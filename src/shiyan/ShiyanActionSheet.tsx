import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { Check, X } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';

export interface ShiyanActionSheetItem {
  key: string;
  label: string;
  supportingText?: string;
  icon?: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  selected?: boolean;
  onPress: () => void;
}

export function ShiyanActionSheet({
  visible,
  title,
  items,
  onClose,
}: {
  visible: boolean;
  title: string;
  items: readonly ShiyanActionSheetItem[];
  onClose: () => void;
}) {
  const { colors } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessible={false}
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        onPress={onClose}
      >
        <View
          style={[styles.panel, { backgroundColor: colors.bg.card }]}
          onStartShouldSetResponder={() => true}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text.ink }]}>{title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭"
              onPress={onClose}
              style={styles.closeButton}
            >
              <X size={20} color={colors.text.soft} />
            </Pressable>
          </View>

          <View style={styles.items}>
            {items.map((item) => {
              const foreground = item.destructive ? colors.status.error : colors.text.ink;
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: item.disabled, selected: item.selected }}
                  disabled={item.disabled}
                  onPress={() => {
                    onClose();
                    item.onPress();
                  }}
                  style={({ pressed }) => [
                    styles.item,
                    {
                      borderColor: colors.border.soft,
                      backgroundColor: pressed ? colors.bg.soft : colors.bg.card,
                      opacity: item.disabled ? 0.45 : 1,
                    },
                  ]}
                >
                  <View style={styles.iconSlot}>{item.icon}</View>
                  <View style={styles.copy}>
                    <Text style={[styles.label, { color: foreground }]}>{item.label}</Text>
                    {item.supportingText ? (
                      <Text style={[styles.supporting, { color: colors.text.soft }]}>
                        {item.supportingText}
                      </Text>
                    ) : null}
                  </View>
                  {item.selected ? <Check size={18} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  panel: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  header: {
    minHeight: sizing.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: fontSize.titleMd, fontWeight: '700' },
  closeButton: {
    width: sizing.iconButton,
    height: sizing.iconButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  items: { gap: spacing.xs },
  item: {
    minHeight: sizing.touchTarget,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  iconSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: spacing.xs },
  label: { fontSize: fontSize.button, fontWeight: '600' },
  supporting: { fontSize: fontSize.caption },
});
