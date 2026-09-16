import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme/tokens';

export type ConnectionVisualStatus =
  | 'not-configured'
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'error';

interface ConnectionStatusDotProps {
  status: ConnectionVisualStatus;
  size?: number;
}

export function ConnectionStatusDot({ status, size = spacing.sm }: ConnectionStatusDotProps) {
  const { colors } = useTheme();
  const color =
    status === 'connected' || status === 'connecting'
      ? colors.status.success
      : status === 'error'
        ? colors.status.error
        : status === 'disconnected'
          ? colors.status.warning
          : colors.text.soft;

  return <View accessibilityElementsHidden style={[styles.dot, { width: size, height: size, borderRadius: radius.full, backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  dot: { flexShrink: 0 },
});
