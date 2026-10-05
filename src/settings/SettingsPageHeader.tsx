import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronLeft } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';

interface SettingsPageHeaderProps {
  title: string;
  onConfirm?: () => void;
}

export function SettingsPageHeader({ title, onConfirm }: SettingsPageHeaderProps) {
  const navigation = useNavigation();
  const { colors } = useTheme();

  return (
    <View style={styles.header}>
      <Pressable
        style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.bg.card }, pressed && styles.pressed]}
        onPress={() => navigation.goBack()}
        accessibilityRole="button"
        accessibilityLabel="返回"
      >
        <ChevronLeft size={24} color={colors.text.ink} />
      </Pressable>
      <Text style={[styles.title, { color: colors.text.ink }]} numberOfLines={1}>{title}</Text>
      {onConfirm ? (
        <Pressable
          style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.bg.card }, pressed && styles.pressed]}
          onPress={onConfirm}
          accessibilityRole="button"
          accessibilityLabel="完成"
        >
          <Check size={22} color={colors.text.ink} />
        </Pressable>
      ) : <View style={styles.iconButton} />}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: sizing.touchTarget + spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  iconButton: {
    width: sizing.iconButton,
    height: sizing.iconButton,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.titleMd,
    fontWeight: '700',
  },
  pressed: { opacity: 0.72 },
});
