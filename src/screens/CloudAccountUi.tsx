import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
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

export function CloudMenuRow({
  icon: Icon,
  title,
  subtitle,
  onPress,
  last = false,
}: {
  icon: CloudIcon;
  title: string;
  subtitle: string;
  onPress: () => void;
  last?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
    >
      <View style={[styles.menuIcon, { backgroundColor: colors.bg.soft }]}>
        <Icon size={20} color={colors.primary} />
      </View>
      <View
        style={[
          styles.menuBody,
          !last && {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border.default,
          },
        ]}
      >
        <View style={styles.menuText}>
          <Text style={[styles.menuTitle, { color: colors.text.ink }]}>
            {title}
          </Text>
          <Text style={[styles.menuSubtitle, { color: colors.text.soft }]}>
            {subtitle}
          </Text>
        </View>
        <ChevronRight size={20} color={colors.text.soft} />
      </View>
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
  menuRow: {
    paddingLeft: spacing.md,
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  menuIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuBody: {
    flex: 1,
    minHeight: 76,
    paddingRight: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  menuText: { flex: 1, gap: spacing.xs },
  menuTitle: { fontSize: fontSize.bodyMd, fontWeight: '600' },
  menuSubtitle: { fontSize: fontSize.caption },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
});
