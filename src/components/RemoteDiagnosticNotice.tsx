import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type {
  RemoteConnectionDiagnostic,
  RemoteConnectionDiagnosticAction,
} from '../connectivity/remoteConnectionDiagnostics';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';

interface RemoteDiagnosticNoticeProps {
  diagnostic: RemoteConnectionDiagnostic;
  compact?: boolean;
  onAction: (action: RemoteConnectionDiagnosticAction) => void;
}

export function RemoteDiagnosticNotice({
  diagnostic,
  compact = false,
  onAction,
}: RemoteDiagnosticNoticeProps) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        compact ? styles.compact : styles.full,
      ]}
      accessibilityRole="alert"
    >
      <Text
        style={[
          compact ? styles.compactTitle : styles.title,
          { color: colors.text.ink },
        ]}
      >
        {diagnostic.title}
      </Text>
      <Text style={[styles.message, { color: colors.text.muted }]}>
        {diagnostic.message}
      </Text>

      {__DEV__ && diagnostic.debugCode ? (
        <Text style={[styles.debug, { color: colors.text.soft }]}>
          诊断：{diagnostic.debugCode}
          {diagnostic.debugStatus ? ` · HTTP ${diagnostic.debugStatus}` : ''}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => onAction(diagnostic.primaryAction.kind)}
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: pressed
                ? colors.primaryActive
                : colors.primary,
            },
          ]}
        >
          <Text style={[styles.primaryLabel, { color: colors.onPrimary }]}>
            {diagnostic.primaryAction.label}
          </Text>
        </Pressable>

        {diagnostic.secondaryAction ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onAction(diagnostic.secondaryAction!.kind)}
            style={({ pressed }) => [
              styles.secondaryButton,
              { borderColor: colors.border.default },
              pressed && { backgroundColor: colors.bg.soft },
            ]}
          >
            <Text style={[styles.secondaryLabel, { color: colors.text.ink }]}>
              {diagnostic.secondaryAction.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  full: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
  },
  compact: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginVertical: spacing.md,
  },
  title: {
    fontSize: fontSize.titleLg,
    fontWeight: '600',
    textAlign: 'center',
  },
  compactTitle: {
    fontSize: fontSize.bodyMd,
    fontWeight: '600',
  },
  message: {
    marginTop: spacing.sm,
    fontSize: fontSize.button,
    lineHeight: 20,
    textAlign: 'center',
  },
  debug: {
    marginTop: spacing.sm,
    fontSize: fontSize.xs,
    textAlign: 'center',
  },
  actions: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  primaryButton: {
    minHeight: sizing.touchTarget,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: { fontSize: fontSize.button, fontWeight: '600' },
  secondaryButton: {
    minHeight: sizing.touchTarget,
    minWidth: 96,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: { fontSize: fontSize.button, fontWeight: '600' },
});
