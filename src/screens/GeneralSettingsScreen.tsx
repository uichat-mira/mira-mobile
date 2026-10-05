import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronDown, History, MessageCircle, Type } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, spacing, type TextScaleId } from '../theme/tokens';
import { SettingsPageHeader } from '../settings/SettingsPageHeader';
import { SettingsChoiceModal, type SettingsChoice } from '../settings/SettingsChoiceModal';
import {
  SettingsGroup,
  SettingsRow,
  SettingsSectionHeader,
} from '../settings/SettingsComponents';
import {
  DEFAULT_GENERAL_SETTINGS,
  loadGeneralSettings,
  saveGeneralSettings,
  type DefaultSessionSource,
  type GeneralSettings,
  type LaunchBehavior,
} from '../settings/generalSettings';

const defaultSessionSourceOptions: readonly SettingsChoice<DefaultSessionSource>[] = [
  { value: 'ask', label: '每次询问（默认）' },
  { value: 'remote-host', label: '远程连接' },
  { value: 'local-provider', label: '本地连接' },
];

const launchBehaviorOptions: readonly SettingsChoice<LaunchBehavior>[] = [
  { value: 'home', label: '会话列表（默认）' },
  { value: 'last-session', label: '上次的会话' },
];

const textScaleOptions: readonly SettingsChoice<TextScaleId>[] = [
  { value: 'compact', label: '紧凑' },
  { value: 'standard', label: '标准（默认）' },
  { value: 'large', label: '大' },
];

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message ? error.message : '无法保存常规设置，请稍后重试。';

export function GeneralSettingsScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const [settings, setSettings] = useState<GeneralSettings>(DEFAULT_GENERAL_SETTINGS);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [textScaleOpen, setTextScaleOpen] = useState(false);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  // Last value known to be on disk. A failed write rolls back to this instead of
  // leaving the UI on an optimistic value the user can no longer recover from.
  const persistedRef = useRef<GeneralSettings>(DEFAULT_GENERAL_SETTINGS);

  const loadSettings = useCallback(() => {
    let cancelled = false;

    void loadGeneralSettings()
      .then((loaded) => {
        if (cancelled) return;
        persistedRef.current = loaded;
        setSettings(loaded);
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

  const applySettings = useCallback((next: GeneralSettings) => {
    setSettings(next);
    setPersistenceError(null);
    setSaving(true);
    void saveGeneralSettings(next)
      .then(() => {
        persistedRef.current = next;
      })
      .catch((error) => {
        // Roll back so the screen keeps showing what is actually persisted.
        setSettings(persistedRef.current);
        setPersistenceError(errorMessage(error));
      })
      .finally(() => {
        setSaving(false);
      });
  }, []);

  const handleAction = useCallback((actionId: string) => {
    switch (actionId) {
      case 'default-session-source':
        setSourceOpen(true);
        break;
      case 'launch-behavior':
        setLaunchOpen(true);
        break;
      case 'text-scale':
        setTextScaleOpen(true);
        break;
    }
  }, []);

  if (!hydrated) return null;

  const sourceLabel =
    defaultSessionSourceOptions.find((option) => option.value === settings.defaultSessionSource)
      ?.label ?? '';
  const launchLabel =
    launchBehaviorOptions.find((option) => option.value === settings.launchBehavior)?.label ?? '';
  const textScaleLabel =
    textScaleOptions.find((option) => option.value === settings.textScale)?.label ?? '';

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.bg.canvas }]}
      edges={['top', 'bottom']}
    >
      <SettingsPageHeader title="常规" onConfirm={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        {loadFailed ? (
          <View style={[styles.loadErrorBox, { backgroundColor: colors.status.errorBg }]}>
            <Text style={[styles.help, { color: colors.status.error }]}>
              {`常规设置读取失败：${persistenceError ?? ''}`}
            </Text>
            <Pressable
              onPress={loadSettings}
              style={({ pressed }) => [
                styles.retryButton,
                { backgroundColor: colors.bg.card },
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="重试加载常规设置"
            >
              <Text style={[styles.retryLabel, { color: colors.text.ink }]}>重试</Text>
            </Pressable>
          </View>
        ) : persistenceError ? (
          <Text style={[styles.help, { color: colors.status.error }]}>
            {`常规设置保存失败：${persistenceError}`}
          </Text>
        ) : null}

        <SettingsSectionHeader>启动</SettingsSectionHeader>
        <SettingsGroup onAction={handleAction}>
          <SettingsRow
            icon={MessageCircle}
            title="默认会话来源"
            subtitle={sourceLabel}
            actionId="default-session-source"
            isFirst
            isLast={false}
            right={<ChevronDown size={20} color={colors.text.soft} />}
            showChevron={false}
          />
          <SettingsRow
            icon={History}
            title="启动时打开"
            subtitle={launchLabel}
            actionId="launch-behavior"
            isLast
            right={<ChevronDown size={20} color={colors.text.soft} />}
            showChevron={false}
          />
        </SettingsGroup>
        <Text style={[styles.help, { color: colors.text.muted }]}>
          新建会话时默认使用的连接来源；选择“每次询问”会在新建时单独确认。
        </Text>

        <SettingsSectionHeader>显示</SettingsSectionHeader>
        <SettingsGroup onAction={handleAction}>
          <SettingsRow
            icon={Type}
            title="文本大小"
            subtitle={textScaleLabel}
            actionId="text-scale"
            isFirst
            isLast
            right={<ChevronDown size={20} color={colors.text.soft} />}
            showChevron={false}
          />
        </SettingsGroup>
        <Text style={[styles.help, { color: colors.text.muted }]}>重启应用后完全生效。</Text>
        <View style={[styles.surface, { backgroundColor: colors.bg.card }]}>
          <View style={styles.flex}>
            <Text style={[styles.title, { color: colors.text.ink }]}>触感反馈</Text>
            <Text style={[styles.subtitle, { color: colors.text.muted }]}>
              发送消息和新建会话时轻微振动
            </Text>
          </View>
          <Switch
            value={settings.hapticsEnabled}
            onValueChange={(value) => applySettings({ ...settings, hapticsEnabled: value })}
            disabled={loadFailed || saving}
            trackColor={{ false: colors.border.default, true: colors.primary }}
            thumbColor={colors.bg.elevated}
          />
        </View>

        <SettingsSectionHeader>更新</SettingsSectionHeader>
        <View style={[styles.surface, { backgroundColor: colors.bg.card }]}>
          <View style={styles.flex}>
            <Text style={[styles.title, { color: colors.text.ink }]}>自动检查更新</Text>
            <Text style={[styles.subtitle, { color: colors.text.muted }]}>
              启动时在后台检查新版本，发现更新时提醒
            </Text>
          </View>
          <Switch
            value={settings.autoCheckUpdates}
            onValueChange={(value) => applySettings({ ...settings, autoCheckUpdates: value })}
            disabled={loadFailed || saving}
            trackColor={{ false: colors.border.default, true: colors.primary }}
            thumbColor={colors.bg.elevated}
          />
        </View>
        <Text style={[styles.help, { color: colors.text.muted }]}>
          关闭后仍可在“关于”页手动检查更新。
        </Text>
      </ScrollView>
      <SettingsChoiceModal
        visible={sourceOpen}
        value={settings.defaultSessionSource}
        options={defaultSessionSourceOptions}
        onChange={(value) => applySettings({ ...settings, defaultSessionSource: value })}
        onClose={() => setSourceOpen(false)}
      />
      <SettingsChoiceModal
        visible={launchOpen}
        value={settings.launchBehavior}
        options={launchBehaviorOptions}
        onChange={(value) => applySettings({ ...settings, launchBehavior: value })}
        onClose={() => setLaunchOpen(false)}
      />
      <SettingsChoiceModal
        visible={textScaleOpen}
        value={settings.textScale}
        options={textScaleOptions}
        onChange={(value) => applySettings({ ...settings, textScale: value })}
        onClose={() => setTextScaleOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.section },
  help: { fontSize: fontSize.button, lineHeight: 20, marginBottom: spacing.md },
  surface: {
    minHeight: 62,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  flex: { flex: 1 },
  title: { fontSize: fontSize.bodyMd, fontWeight: '500' },
  subtitle: { fontSize: fontSize.button, marginTop: spacing.xs },
  loadErrorBox: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  retryButton: {
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  retryLabel: { fontSize: fontSize.button, fontWeight: '600' },
});
