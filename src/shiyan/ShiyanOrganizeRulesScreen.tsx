import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ArrowLeft, ChevronRight } from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import { SHIYAN_BUILT_IN_SCENES, getCustomSceneDraft } from './scenes';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export function ShiyanOrganizeRulesScreen() {
  const navigation = useNavigation<NavProp>();
  const { colors } = useTheme();
  const customScene = getCustomSceneDraft();

  const scenes = useMemo(
    () => (customScene ? [...SHIYAN_BUILT_IN_SCENES, customScene] : [...SHIYAN_BUILT_IN_SCENES]),
    [customScene],
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg.canvas }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          onPress={() => navigation.goBack()}
          style={styles.headerButton}
        >
          <ArrowLeft size={22} color={colors.text.ink} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text.ink }]}>整理规则</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.intro, { color: colors.text.soft }]}>
          拾言按场景整理你的口述内容。每个场景有各自的整理要求和输出结构，录音结束后会依此生成结果。
        </Text>

        {scenes.map((scene) => (
          <View
            key={scene.id}
            style={[styles.ruleCard, { backgroundColor: colors.bg.card, borderColor: colors.border.default }]}
          >
            <View style={styles.ruleHeader}>
              <Text style={[styles.ruleTitle, { color: colors.text.ink }]}>{scene.name}</Text>
              {scene.builtIn ? null : (
                <Text style={[styles.ruleBadge, { color: colors.primary, backgroundColor: colors.bg.soft }]}>自定义</Text>
              )}
            </View>
            <Text style={[styles.ruleRequirement, { color: colors.text.base }]}>{scene.organizationRequirement}</Text>
            <View style={styles.structureList}>
              <Text style={[styles.structureLabel, { color: colors.text.soft }]}>输出结构</Text>
              {scene.outputStructure.map((item) => (
                <Text key={item} style={[styles.structureItem, { color: colors.text.base }]}>
                  · {item}
                </Text>
              ))}
            </View>
          </View>
        ))}

        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('ShiyanSceneConfig')}
          style={({ pressed }) => [
            styles.configLink,
            { backgroundColor: pressed ? colors.bg.soft : colors.bg.card, borderColor: colors.border.default },
          ]}
        >
          <View style={styles.configLinkText}>
            <Text style={[styles.configLinkTitle, { color: colors.text.ink }]}>调整自定义场景</Text>
            <Text style={[styles.configLinkCaption, { color: colors.text.soft }]}>
              修改自定义场景的整理要求与输出结构
            </Text>
          </View>
          <ChevronRight size={18} color={colors.text.soft} />
        </Pressable>

        <Text style={[styles.footnote, { color: colors.text.soft }]}>
          内置场景的规则由拾言维护，暂不支持在移动端修改。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '600' },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  intro: { fontSize: fontSize.caption, lineHeight: 20 },
  ruleCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  ruleHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ruleTitle: { flex: 1, fontSize: fontSize.bodyMd, fontWeight: '600' },
  ruleBadge: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  ruleRequirement: { fontSize: fontSize.button, lineHeight: 21 },
  structureList: { gap: 3 },
  structureLabel: { fontSize: fontSize.xs, fontWeight: '600', marginBottom: 2 },
  structureItem: { fontSize: fontSize.caption, lineHeight: 19 },
  configLink: {
    minHeight: sizing.touchTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  configLinkText: { flex: 1, gap: 3 },
  configLinkTitle: { fontSize: fontSize.button, fontWeight: '600' },
  configLinkCaption: { fontSize: fontSize.xs, lineHeight: 18 },
  footnote: { fontSize: fontSize.xs, lineHeight: 18 },
});
