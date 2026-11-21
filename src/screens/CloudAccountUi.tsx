import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';

type CloudIcon = React.ComponentType<{ size?: number; color?: string }>;

export function CloudActionButton({
  label,
  onPress,
  icon: Icon,
  tone = 'primary',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  icon: CloudIcon;
  tone?: 'primary' | 'secondary' | 'destructive';
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const background = tone === 'primary' ? colors.primary : colors.bg.card;
  const foreground =
    tone === 'primary'
      ? colors.onPrimary
      : tone === 'destructive'
      ? colors.status.error
      : colors.text.base;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: background,
          borderColor: tone === 'primary' ? background : colors.border.default,
        },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Icon size={17} color={foreground} />
      <Text style={[styles.actionText, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

export const cloudLayout = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  muted: { fontSize: fontSize.button, lineHeight: 20 },
  description: { fontSize: fontSize.button, lineHeight: 21 },
  notice: { borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  noticeText: { fontSize: fontSize.button, lineHeight: 20 },
  actions: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  section: { gap: spacing.md },
});

const styles = StyleSheet.create({
  action: {
    minHeight: sizing.touchTarget + spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  actionText: { fontSize: fontSize.button, fontWeight: '600' },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
});
