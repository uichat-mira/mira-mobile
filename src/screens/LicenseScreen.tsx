import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { version } from '../../package.json';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, spacing } from '../theme/tokens';
import { SettingsPageHeader } from '../settings/SettingsPageHeader';

const MIT_LICENSE = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.`;

export function LicenseScreen() {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg.canvas }]} edges={['top', 'bottom']}>
      <SettingsPageHeader title="开源许可证" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summary}>
          <Text style={[styles.name, { color: colors.text.ink }]}>UIChat Mira</Text>
          <Text style={[styles.version, { color: colors.text.muted }]}>版本 {version}</Text>
          <Text style={[styles.publisher, { color: colors.text.muted }]}>UIChat</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border.default }]} />
        <View style={styles.licenseSection}>
          <Text style={[styles.licenseTitle, { color: colors.text.ink }]}>MIT License</Text>
          <Text style={[styles.licenseText, { color: colors.text.base }]}>{MIT_LICENSE}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.section },
  summary: { paddingTop: spacing.lg, paddingBottom: spacing.xl, gap: spacing.xs },
  name: { fontSize: fontSize.titleLg, fontWeight: '600' },
  version: { fontSize: fontSize.caption },
  publisher: { fontSize: fontSize.caption },
  divider: { height: StyleSheet.hairlineWidth },
  licenseSection: { paddingTop: spacing.xl, gap: spacing.md },
  licenseTitle: { fontSize: fontSize.titleMd, fontWeight: '600' },
  licenseText: { fontSize: fontSize.button, lineHeight: 22 },
});
