import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronDown, X } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, spacing } from '../theme/tokens';
import { SettingsPageHeader } from '../components/settings/SettingsPageHeader';
import { SettingsChoiceModal, type SettingsChoice } from '../components/settings/SettingsChoiceModal';
import { SettingsInputModal } from '../components/settings/SettingsInputModal';
import {
  DEFAULT_PERSONALIZATION_SETTINGS,
  MAX_INSTRUCTIONS_LENGTH,
  MAX_TRAITS,
  MAX_TRAIT_LENGTH,
  addTrait,
  loadPersonalizationSettings,
  removeTrait,
  savePersonalizationSettings,
  type PersonalizationSettings,
  type PersonalizationTone,
} from './personalizationSettings';

const toneOptions: readonly SettingsChoice<PersonalizationTone>[] = [
  { value: 'friendly', label: '亲和友善' },
  { value: 'professional', label: '专业严谨' },
  { value: 'concise', label: '简洁直接' },
];

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message
    ? error.message
    : '无法保存个性化设置，请稍后重试。';

export function PersonalizationScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const [settings, setSettings] = useState<PersonalizationSettings>(
    DEFAULT_PERSONALIZATION_SETTINGS,
  );
  const [toneOpen, setToneOpen] = useState(false);
  const [traitModalOpen, setTraitModalOpen] = useState(false);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const toneLabel = toneOptions.find((option) => option.value === settings.tone)?.label ?? '';

  useEffect(() => {
    let cancelled = false;

    void loadPersonalizationSettings()
      .then((loaded) => {
        if (cancelled) return;
        setSettings(loaded);
        setPersistenceError(null);
      })
      .catch((error) => {
        if (!cancelled) setPersistenceError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const applySettings = useCallback((next: PersonalizationSettings) => {
    setSettings(next);
    setPersistenceError(null);
    void savePersonalizationSettings(next).catch((error) => {
      setPersistenceError(errorMessage(error));
    });
  }, []);

  if (!hydrated) return null;

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.bg.canvas }]}
      edges={['top', 'bottom']}
    >
      <SettingsPageHeader title="个性化" onConfirm={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {persistenceError ? (
          <Text style={[styles.help, { color: colors.status.error }]}>
            {`个性化设置保存失败：${persistenceError}`}
          </Text>
        ) : null}
        <Pressable
          style={({ pressed }) => [
            styles.surface,
            { backgroundColor: colors.bg.card },
            pressed && { opacity: 0.8 },
          ]}
          onPress={() => setToneOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="基本风格和语调"
        >
          <View style={styles.flex}>
            <Text style={[styles.title, { color: colors.text.ink }]}>基本风格和语调</Text>
            <Text style={[styles.subtitle, { color: colors.text.muted }]}>{toneLabel}</Text>
          </View>
          <ChevronDown size={20} color={colors.text.muted} />
        </Pressable>
        <Text style={[styles.help, { color: colors.text.muted }]}>
          设置 Mira 在对话中使用的主要语气，不会改变功能行为。
        </Text>

        <Text style={[styles.sectionLabel, { color: colors.text.soft }]}>特征</Text>
        <View style={[styles.surface, { backgroundColor: colors.bg.card }]}>
          <View style={styles.flex}>
            <Text style={[styles.title, { color: colors.text.ink }]}>提高亲和度</Text>
            <Text style={[styles.subtitle, { color: colors.text.muted }]}>更友好、更亲近</Text>
          </View>
          <Switch
            value={settings.warmthEnabled}
            onValueChange={(value) => applySettings({ ...settings, warmthEnabled: value })}
            trackColor={{ false: colors.border.default, true: colors.primary }}
            thumbColor={colors.bg.elevated}
          />
        </View>
        {settings.traits.map((trait, index) => (
          <View key={trait} style={[styles.surface, { backgroundColor: colors.bg.card }]}>
            <Text style={[styles.title, styles.flex, { color: colors.text.ink }]}>{trait}</Text>
            <Pressable
              onPress={() =>
                applySettings({ ...settings, traits: removeTrait(settings.traits, index) })
              }
              style={({ pressed }) => [styles.traitRemove, pressed && { opacity: 0.6 }]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`删除特征 ${trait}`}
            >
              <X size={18} color={colors.text.muted} />
            </Pressable>
          </View>
        ))}
        <Pressable
          style={({ pressed }) => [
            styles.surface,
            { backgroundColor: colors.bg.card },
            pressed && { opacity: 0.8 },
          ]}
          onPress={() => setTraitModalOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="添加特征"
        >
          <View style={styles.flex}>
            <Text style={[styles.title, { color: colors.text.ink }]}>添加特征</Text>
            <Text style={[styles.subtitle, { color: colors.text.muted }]}>
              {`${settings.traits.length}/${MAX_TRAITS}`}
            </Text>
          </View>
        </Pressable>

        <View style={[styles.surface, { backgroundColor: colors.bg.card }]}>
          <Text style={[styles.title, styles.flex, { color: colors.text.ink }]}>快速回答</Text>
          <Switch
            value={settings.quickReplies}
            onValueChange={(value) => applySettings({ ...settings, quickReplies: value })}
            trackColor={{ false: colors.border.default, true: colors.primary }}
            thumbColor={colors.bg.elevated}
          />
        </View>
        <Text style={[styles.help, { color: colors.text.muted }]}>
          优先生成简洁答案；需要时仍会提供完整说明。
        </Text>

        <Text style={[styles.sectionLabel, { color: colors.text.soft }]}>自定义指令</Text>
        <TextInput
          value={settings.instructions}
          onChangeText={(text) => applySettings({ ...settings, instructions: text })}
          multiline
          maxLength={MAX_INSTRUCTIONS_LENGTH}
          placeholder="讲话风格、体现风骚幽默、引人联想"
          placeholderTextColor={colors.text.placeholder}
          style={[styles.instructions, { color: colors.text.ink, backgroundColor: colors.bg.card }]}
          textAlignVertical="top"
        />
      </ScrollView>
      <SettingsChoiceModal
        visible={toneOpen}
        value={settings.tone}
        options={toneOptions}
        onChange={(tone) => applySettings({ ...settings, tone })}
        onClose={() => setToneOpen(false)}
      />
      <SettingsInputModal
        visible={traitModalOpen}
        title="添加特征"
        placeholder="例如：讲话简短"
        confirmLabel="添加"
        maxLength={MAX_TRAIT_LENGTH}
        onSubmit={(value) => applySettings({ ...settings, traits: addTrait(settings.traits, value) })}
        onClose={() => setTraitModalOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.section, gap: spacing.md },
  surface: {
    minHeight: 62,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  flex: { flex: 1 },
  title: { fontSize: fontSize.bodyMd, fontWeight: '500' },
  subtitle: { fontSize: fontSize.button, marginTop: spacing.xs },
  help: { fontSize: fontSize.button, lineHeight: 20 },
  sectionLabel: { fontSize: fontSize.button, marginTop: spacing.sm },
  traitRemove: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  instructions: {
    minHeight: 110,
    borderRadius: radius.lg,
    padding: spacing.lg,
    fontSize: fontSize.bodyMd,
  },
});
