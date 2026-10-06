import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';

type SettingsIcon = React.ComponentType<{ size?: number; color?: string }>;

interface SettingsSectionHeaderProps {
  children: React.ReactNode;
}

export function SettingsSectionHeader({ children }: SettingsSectionHeaderProps) {
  const { colors } = useTheme();
  return <Text style={[styles.sectionHeader, { color: colors.text.soft }]}>{children}</Text>;
}

const SettingsActionContext = React.createContext<(actionId: string) => void>(() => {});

export function SettingsGroup({ children, onAction }: { children: React.ReactNode; onAction: (actionId: string) => void }) {
  return (
    <SettingsActionContext.Provider value={onAction}>
      <View style={styles.group}>{children}</View>
    </SettingsActionContext.Provider>
  );
}

interface SettingsRowProps {
  actionId?: string;
  icon: SettingsIcon;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  showChevron?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  destructive?: boolean;
}

export function SettingsRow({
  actionId,
  icon: Icon,
  title,
  subtitle,
  right,
  showChevron = true,
  isFirst = false,
  isLast = false,
  destructive = false,
}: SettingsRowProps) {
  const { colors } = useTheme();
  const onAction = React.useContext(SettingsActionContext);
  const disabled = actionId === undefined;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={actionId ? () => onAction(actionId) : undefined}
      style={({ pressed }) => [
        styles.row,
        isFirst && styles.firstRow,
        isLast && styles.lastRow,
        { backgroundColor: colors.bg.card },
        pressed && { backgroundColor: colors.bg.soft },
      ]}
    >
      <View style={styles.iconWrap}>
        <Icon size={24} color={destructive ? colors.status.error : colors.text.ink} />
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, { color: destructive ? colors.status.error : colors.text.ink }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: colors.text.muted }]}>{subtitle}</Text> : null}
      </View>
      <View style={styles.right} pointerEvents="none">
        {right}
        {showChevron && !right && !disabled ? <ChevronRight size={20} color={colors.text.soft} /> : null}
      </View>
      {!isLast && <View style={[styles.separator, { backgroundColor: colors.bg.canvas }]} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    fontSize: fontSize.button,
    fontWeight: '500',
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.section,
    paddingBottom: spacing.md,
    letterSpacing: 0,
  },
  group: {
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    minHeight: 60,
    position: 'relative',
  },
  firstRow: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  lastRow: {
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  iconWrap: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  content: { flex: 1, justifyContent: 'center' },
  title: { fontSize: fontSize.titleMd, fontWeight: '500' },
  subtitle: { fontSize: fontSize.md, marginTop: 2 },
  right: {
    minWidth: sizing.touchTarget,
    minHeight: sizing.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  separator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    left: 64,
    height: 2,
  },
});
