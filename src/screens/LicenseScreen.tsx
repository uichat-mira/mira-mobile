import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { version } from '../../package.json';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, spacing } from '../theme/tokens';
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
        <View style={[styles.summary, { backgroundColor: colors.bg.card }]}>
          <View style={styles.summaryTop}>
            <Text style={[styles.name, { color: colors.text.ink }]}>UIChat Mira</Text>
            <Text style={[styles.version, { color: colors.text.muted }]}>{version}</Text>
          </View>
          <Text style={[styles.publisher, { color: colors.text.muted }]}>UIChat</Text>
          <View style={[styles.badge, { backgroundColor: colors.bg.soft }]}>
            <Text style={[styles.badgeText, { color: colors.primary }]}>MIT License</Text>
          </View>
        </View>
        <Text style={[styles.licenseText, { color: colors.text.base }]}>{MIT_LICENSE}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.section, gap: spacing.xl },
  summary: { borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  name: { flex: 1, fontSize: fontSize.bodyMd, fontWeight: '600' },
  version: { fontSize: fontSize.caption },
  publisher: { fontSize: fontSize.caption },
  badge: { alignSelf: 'flex-start', borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginTop: spacing.xs },
  badgeText: { fontSize: fontSize.caption, fontWeight: '600' },
  licenseText: { fontSize: fontSize.button, lineHeight: 22 },
});
