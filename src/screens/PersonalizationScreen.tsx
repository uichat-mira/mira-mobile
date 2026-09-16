import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  normalizeTrait,
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

// Persisting on every keystroke would hit native storage per character
// (Android uses a synchronous commit), so the draft is debounced instead.
const INSTRUCTIONS_DEBOUNCE_MS = 500;

export function PersonalizationScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const [settings, setSettings] = useState<PersonalizationSettings>(
    DEFAULT_PERSONALIZATION_SETTINGS,
  );
  const [toneOpen, setToneOpen] = useState(false);
  const [traitModalOpen, setTraitModalOpen] = useState(false);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  // While a load has failed the in-memory settings are defaults; editing must
  // stay locked or a single save would overwrite the persisted values.
  const [loadFailed, setLoadFailed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState('');
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const instructionsDraftRef = useRef(instructionsDraft);
  instructionsDraftRef.current = instructionsDraft;
  const instructionsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSettings = useCallback(() => {
    let cancelled = false;

    void loadPersonalizationSettings()
      .then((loaded) => {
        if (cancelled) return;
        setSettings(loaded);
        setInstructionsDraft(loaded.instructions);
        setPersistenceError(null);
        setLoadFailed(false);
      })
      .catch((error) => {
        if (!cancelled) {
          setPersistenceError(errorMessage(error));
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => loadSettings(), [loadSettings]);

  const applySettings = useCallback((next: PersonalizationSettings) => {
    setSettings(next);
    setPersistenceError(null);
    void savePersonalizationSettings(next).catch((error) => {
      setPersistenceError(errorMessage(error));
    });
  }, []);

  const persistInstructions = useCallback(() => {
    if (instructionsDebounceRef.current) {
      clearTimeout(instructionsDebounceRef.current);
      instructionsDebounceRef.current = null;
    }
    if (instructionsDraftRef.current !== settingsRef.current.instructions) {
      applySettings({ ...settingsRef.current, instructions: instructionsDraftRef.current });
    }
  }, [applySettings]);

  const onChangeInstructions = useCallback(
    (text: string) => {
      setInstructionsDraft(text);
      if (instructionsDebounceRef.current) clearTimeout(instructionsDebounceRef.current);
      instructionsDebounceRef.current = setTimeout(persistInstructions, INSTRUCTIONS_DEBOUNCE_MS);
    },
    [persistInstructions],
  );

  // Leaving the screen must still flush the tail of an in-flight debounce;
  // onEndEditing alone is not guaranteed to fire on navigation.
  useEffect(() => {
    return () => {
      if (instructionsDebounceRef.current) {
        clearTimeout(instructionsDebounceRef.current);
        instructionsDebounceRef.current = null;
      }
      const text = instructionsDraftRef.current;
      const current = settingsRef.current;
      if (text !== current.instructions) {
        // The screen is gone; a failure here can no longer be surfaced.
        void savePersonalizationSettings({ ...current, instructions: text }).catch(
          () => undefined,
        );
      }
    };
  }, []);

  if (!hydrated) return null;

  const controlsLocked = loadFailed;
  const traitsAtCap = settings.traits.length >= MAX_TRAITS;
  const toneLabel = toneOptions.find((option) => option.value === settings.tone)?.label ?? '';

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.bg.canvas }]}
      edges={['top', 'bottom']}
    >
      <SettingsPageHeader title="个性化" onConfirm={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {controlsLocked ? (
          <View style={[styles.loadErrorBox, { backgroundColor: colors.status.errorBg }]}>
            <Text style={[styles.loadErrorText, { color: colors.status.error }]}>
              {`个性化设置读取失败：${persistenceError ?? ''}`}
            </Text>
            <Pressable
              onPress={loadSettings}
              style={({ pressed }) => [
                styles.retryButton,
                { backgroundColor: colors.bg.card },
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="重试加载个性化设置"
            >
              <Text style={[styles.retryLabel, { color: colors.text.ink }]}>重试</Text>
            </Pressable>
          </View>
        ) : persistenceError ? (
          <Text style={[styles.help, { color: colors.status.error }]}>
            {`个性化设置保存失败：${persistenceError}`}
          </Text>
        ) : null}
        <Pressable
          style={({ pressed }) => [
            styles.surface,
            { backgroundColor: colors.bg.card },
            controlsLocked && styles.disabledSurface,
            pressed && { opacity: 0.8 },
          ]}
          onPress={() => setToneOpen(true)}
          disabled={controlsLocked}
          accessibilityRole="button"
          accessibilityLabel="基本风格和语调"
          accessibilityState={{ disabled: controlsLocked }}
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
            disabled={controlsLocked}
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
              style={({ pressed }) => [
                styles.traitRemove,
                controlsLocked && styles.disabledSurface,
                pressed && { opacity: 0.6 },
              ]}
              hitSlop={8}
              disabled={controlsLocked}
              accessibilityRole="button"
              accessibilityLabel={`删除特征 ${trait}`}
              accessibilityState={{ disabled: controlsLocked }}
            >
              <X size={18} color={colors.text.muted} />
            </Pressable>
          </View>
        ))}
        <Pressable
          style={({ pressed }) => [
            styles.surface,
            { backgroundColor: colors.bg.card },
            (controlsLocked || traitsAtCap) && styles.disabledSurface,
            pressed && { opacity: 0.8 },
          ]}
          onPress={() => setTraitModalOpen(true)}
          disabled={controlsLocked || traitsAtCap}
          accessibilityRole="button"
          accessibilityLabel="添加特征"
          accessibilityState={{ disabled: controlsLocked || traitsAtCap }}
        >
          <View style={styles.flex}>
            <Text style={[styles.title, { color: colors.text.ink }]}>添加特征</Text>
            <Text style={[styles.subtitle, { color: colors.text.muted }]}>
              {traitsAtCap
                ? `已达上限 ${MAX_TRAITS} 条`
                : `${settings.traits.length}/${MAX_TRAITS}`}
            </Text>
          </View>
        </Pressable>

        <View style={[styles.surface, { backgroundColor: colors.bg.card }]}>
          <Text style={[styles.title, styles.flex, { color: colors.text.ink }]}>快速回答</Text>
          <Switch
            value={settings.quickReplies}
            onValueChange={(value) => applySettings({ ...settings, quickReplies: value })}
            disabled={controlsLocked}
            trackColor={{ false: colors.border.default, true: colors.primary }}
            thumbColor={colors.bg.elevated}
          />
        </View>
        <Text style={[styles.help, { color: colors.text.muted }]}>
          优先生成简洁答案；需要时仍会提供完整说明。
        </Text>

        <Text style={[styles.sectionLabel, { color: colors.text.soft }]}>自定义指令</Text>
        <TextInput
          value={instructionsDraft}
          onChangeText={onChangeInstructions}
          multiline
          maxLength={MAX_INSTRUCTIONS_LENGTH}
          editable={!controlsLocked}
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
        validate={(value) => {
          if (settings.traits.length >= MAX_TRAITS) {
            return `最多添加 ${MAX_TRAITS} 条特征。`;
          }
          if (settings.traits.includes(normalizeTrait(value))) {
            return '该特征已存在，换一个试试。';
          }
          return null;
        }}
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
  disabledSurface: { opacity: 0.5 },
  loadErrorBox: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  loadErrorText: { fontSize: fontSize.button, lineHeight: 20 },
  retryButton: {
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  retryLabel: { fontSize: fontSize.button, fontWeight: '600' },
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
