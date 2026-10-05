import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronLeft, Plus, Save, Trash2 } from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import { ProviderConfigStore, type LocalProviderConfig } from '../provider/providerConfigStore';
import { providerCredentialStore } from '../security/providerCredentialStore';
import { runtimeRegistry } from '../runtime/runtimeRegistry';
import {
  LocalProviderDeletionRollbackIncompleteError,
  LocalProviderDeletionScopeChangedError,
} from '../runtime/localProviderRuntime';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

const createDraftProvider = (name: string): LocalProviderConfig => ({
  id: `provider-${Date.now()}`,
  name,
  baseUrl: '',
  model: '',
  protocol: 'chat-completions',
});

export function LocalProviderConfigScreen() {
  const navigation = useNavigation<NavProp>();
  const { colors } = useTheme();
  const [config, setConfig] = useState<LocalProviderConfig>({
    id: 'default-provider',
    name: 'Local Provider',
    baseUrl: '',
    model: '',
    protocol: 'chat-completions',
  });
  const [configs, setConfigs] = useState<LocalProviderConfig[]>([]);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const credentialLoadRequestRef = useRef(0);
  const selectedProviderIdRef = useRef(config.id);
  const [saving, setSaving] = useState(false);
  const [clearingKey, setClearingKey] = useState(false);
  const [deletingProvider, setDeletingProvider] = useState(false);
  const deletingProviderRef = useRef(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      const loadedConfigs = await new ProviderConfigStore().load().catch(() => []);
      if (active) setConfigs(loadedConfigs);
      const first = loadedConfigs[0];
      if (!active || !first) {
        if (active) setLoading(false);
        return;
      }
      selectedProviderIdRef.current = first.id;
      setConfig(first);
      const requestId = ++credentialLoadRequestRef.current;
      setApiKeyDraft('');
      setHasStoredKey(false);
      const existingKey = await providerCredentialStore.load(first.id).catch(() => null);
      if (active && credentialLoadRequestRef.current === requestId) {
        setHasStoredKey(Boolean(existingKey));
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const save = useCallback(async () => {
    if (saving) return;
    const next = {
      ...config,
      id: config.id.trim() || 'default-provider',
      name: config.name.trim() || 'Local Provider',
      baseUrl: config.baseUrl.trim(),
      model: config.model.trim(),
    };
    if (!next.baseUrl || !next.model) {
      Alert.alert('配置不完整', '请填写 Provider 地址和模型名称。');
      return;
    }
    setSaving(true);
    try {
      await new ProviderConfigStore().upsert(next);
      const nextApiKey = apiKeyDraft.trim();
      if (nextApiKey) {
        await providerCredentialStore.save(next.id, nextApiKey);
        if (selectedProviderIdRef.current === next.id) {
          credentialLoadRequestRef.current += 1;
        }
      }
      setConfigs((current) => {
        const index = current.findIndex((item) => item.id === next.id);
        if (index < 0) return [...current, next];
        const updated = [...current];
        updated[index] = next;
        return updated;
      });
      if (selectedProviderIdRef.current === next.id) {
        setConfig(next);
        setApiKeyDraft('');
        if (nextApiKey) setHasStoredKey(true);
      }
      Alert.alert('已保存', 'Local Provider 配置已保存。');
    } catch {
      Alert.alert('保存失败', '无法保存 Local Provider 配置，请检查输入后重试。');
    } finally {
      setSaving(false);
    }
  }, [apiKeyDraft, config, saving]);

  const selectProvider = useCallback(async (next: LocalProviderConfig) => {
    selectedProviderIdRef.current = next.id;
    const requestId = ++credentialLoadRequestRef.current;
    setConfig(next);
    setApiKeyDraft('');
    setHasStoredKey(false);
    const existingKey = await providerCredentialStore.load(next.id).catch(() => null);
    if (credentialLoadRequestRef.current === requestId) {
      setHasStoredKey(Boolean(existingKey));
    }
  }, []);

  const activateDraftProvider = useCallback((name: string) => {
    const next = createDraftProvider(name);
    credentialLoadRequestRef.current += 1;
    selectedProviderIdRef.current = next.id;
    setConfig(next);
    setApiKeyDraft('');
    setHasStoredKey(false);
    return next;
  }, []);

  const addProvider = useCallback(() => {
    const next = activateDraftProvider('New Provider');
    setConfigs((current) => [...current, next]);
  }, [activateDraftProvider]);

  const finishProviderRemoval = useCallback(async (
    providerId: string,
    expectedSessionCount: number,
  ) => {
    if (deletingProviderRef.current) return;
    if (selectedProviderIdRef.current !== providerId) {
      Alert.alert(
        '删除范围已变化',
        '当前选中的 Provider 已变化。刚才的删除确认已失效，请重新发起删除并确认最新范围。',
      );
      return;
    }
    deletingProviderRef.current = true;
    setDeletingProvider(true);
    try {
      await runtimeRegistry.deleteLocalProvider(providerId, expectedSessionCount);

      const nextConfigs = await new ProviderConfigStore().load().catch(() => null);
      if (!nextConfigs) {
        Alert.alert(
          'Provider 已删除',
          'Provider 已删除，但当前页面无法重新读取配置。请返回后重新打开 Local Provider 设置。',
        );
        navigation.goBack();
        return;
      }

      setConfigs(nextConfigs);
      if (selectedProviderIdRef.current === providerId) {
        if (nextConfigs[0]) {
          await selectProvider(nextConfigs[0]);
        } else {
          activateDraftProvider('Local Provider');
        }
      }
    } catch (error) {
      if (error instanceof LocalProviderDeletionScopeChangedError) {
        Alert.alert(
          '删除范围已变化',
          `此 Provider 当前关联 ${error.actualSessionCount} 个本地对话。刚才的确认已失效；请再次点击“删除当前配置”，按最新范围重新确认。`,
        );
        return;
      }
      if (error instanceof LocalProviderDeletionRollbackIncompleteError) {
        if (error.reason === 'canonical-sessions') {
          Alert.alert(
            '本地对话恢复不完整',
            '本地对话存储未能完整恢复。为避免幽灵引用，相关置顶、未读和启动恢复引用保持清理状态；Provider 配置和 API Key 已尝试恢复。请返回对话列表检查当前状态。',
          );
        } else {
          Alert.alert(
            '删除未完整回滚',
            '部分本地状态可能已经变化。请重新打开 Local Provider 设置检查配置、API Key 和关联对话后，再决定是否继续操作。',
          );
        }
        return;
      }
      Alert.alert(
        '删除失败',
        error instanceof Error && error.message
          ? error.message
          : '无法删除当前 Local Provider，请稍后重试。',
      );
    } finally {
      deletingProviderRef.current = false;
      setDeletingProvider(false);
    }
  }, [
    activateDraftProvider,
    navigation,
    selectProvider,
  ]);

  const removeProvider = useCallback(async () => {
    if (deletingProviderRef.current) return;
    try {
      const impact = await runtimeRegistry.getLocalProviderDeletionImpact(config.id);
      const conversationText =
        impact.sessionCount === 0
          ? '当前没有关联本地对话。'
          : `将同时删除此 Provider 关联的 ${impact.sessionCount} 个本地对话。`;

      Alert.alert(
        '删除 Local Provider？',
        `删除“${config.name || config.id}”的配置和 API Key。\n\n${conversationText}\n\n如该 Provider 正在生成内容，将先停止这些请求再删除。\n\n不会影响其他 Provider、Remote Host、记忆或个性化设置。`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '删除',
            style: 'destructive',
            onPress: () =>
              void finishProviderRemoval(config.id, impact.sessionCount),
          },
        ],
      );
    } catch (error) {
      Alert.alert(
        '无法检查删除范围',
        error instanceof Error && error.message
          ? error.message
          : '无法读取当前 Provider 的本地对话，请稍后重试。',
      );
    }
  }, [config.id, config.name, deletingProvider, finishProviderRemoval]);

  const clearApiKey = useCallback(() => {
    if (!hasStoredKey || saving || clearingKey || deletingProvider) return;
    const providerId = config.id;
    Alert.alert(
      '清除 API Key？',
      '清除后，此 Provider 需要重新填写 API Key 才能继续直连模型。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清除',
          style: 'destructive',
          onPress: () => {
            const requestId = ++credentialLoadRequestRef.current;
            setClearingKey(true);
            void providerCredentialStore
              .clear(providerId)
              .then(() => {
                if (
                  credentialLoadRequestRef.current === requestId &&
                  selectedProviderIdRef.current === providerId
                ) {
                  setHasStoredKey(false);
                }
                Alert.alert('已清除', 'API Key 已清除。');
              })
              .catch(() => {
                Alert.alert('清除失败', '无法清除当前 Provider 的 API Key，请稍后重试。');
              })
              .finally(() => {
                setClearingKey(false);
              });
          },
        },
      ],
    );
  }, [clearingKey, config.id, deletingProvider, hasStoredKey, saving]);

  const createSession = useCallback(async () => {
    try {
      const session = await runtimeRegistry.createLocalSession(undefined, config.id);
      navigation.replace('Chat', {
        sessionId: session.id,
        title: session.title,
        source: 'local-provider',
        providerName: config.name,
        providerModel: config.model,
      });
    } catch (error) {
      Alert.alert('无法新建本地对话', error instanceof Error ? error.message : '请先保存 Local Provider 配置。');
    }
  }, [config.id, config.model, config.name, navigation]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg.canvas }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => navigation.goBack()} style={styles.iconButton}>
          <ChevronLeft size={24} color={colors.text.ink} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text.ink }]}>Local Provider</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.providerHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text.ink }]}>Provider 配置</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="新增 Provider" disabled={saving || clearingKey || deletingProvider} onPress={addProvider} style={[styles.iconAction, (saving || clearingKey || deletingProvider) && styles.disabledButton]}>
            <Plus size={18} color={colors.primary} />
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.providerTabs}>
          {configs.map((item) => (
            <Pressable key={item.id} accessibilityRole="button" disabled={saving || clearingKey || deletingProvider} onPress={() => void selectProvider(item)} style={[styles.providerTab, { borderColor: item.id === config.id ? colors.primary : colors.border.default, backgroundColor: item.id === config.id ? colors.bg.soft : colors.bg.card }, (saving || clearingKey || deletingProvider) && styles.disabledButton]}>
              <Text numberOfLines={1} style={[styles.providerTabText, { color: item.id === config.id ? colors.primary : colors.text.base }]}>{item.name || item.id}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Text style={[styles.help, { color: colors.text.soft }]}>手机直连 OpenAI-compatible Provider。API Key 只保存在设备安全存储中。</Text>
        <Field label="名称" value={config.name} onChangeText={(name) => setConfig((current) => ({ ...current, name }))} colors={colors} editable={!saving && !clearingKey && !deletingProvider} />
        <Field label="Provider 地址" value={config.baseUrl} onChangeText={(baseUrl) => setConfig((current) => ({ ...current, baseUrl }))} placeholder="https://example.com" colors={colors} autoCapitalize="none" editable={!saving && !clearingKey && !deletingProvider} />
        <Field label="模型" value={config.model} onChangeText={(model) => setConfig((current) => ({ ...current, model }))} colors={colors} autoCapitalize="none" editable={!saving && !clearingKey && !deletingProvider} />
        <Field
          label="API Key"
          value={apiKeyDraft}
          onChangeText={setApiKeyDraft}
          placeholder={hasStoredKey ? '已保存；输入新 Key 可替换' : '请输入 API Key'}
          colors={colors}
          secureTextEntry
          autoCapitalize="none"
          editable={!saving && !clearingKey && !deletingProvider}
        />
        <Text style={[styles.credentialHelp, { color: colors.text.soft }]}>
          {hasStoredKey ? '已在设备安全存储中保存。留空并保存配置会继续使用原 Key。' : '尚未保存 API Key。'}
        </Text>
        {hasStoredKey ? (
          <Pressable accessibilityRole="button" accessibilityLabel="清除 API Key" disabled={saving || clearingKey || deletingProvider} onPress={clearApiKey} style={[styles.credentialClearButton, (saving || clearingKey || deletingProvider) && styles.disabledButton]}>
            <Text style={[styles.buttonText, { color: colors.status.error }]}>清除 API Key</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" disabled={saving || loading || clearingKey || deletingProvider} onPress={() => void save()} style={[styles.primaryButton, { backgroundColor: colors.primary }, (saving || loading || clearingKey || deletingProvider) && styles.disabledButton]}>
          <Save size={18} color={colors.onPrimary} />
          <Text style={[styles.buttonText, { color: colors.onPrimary }]}>{saving ? '保存中' : '保存配置'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={saving || clearingKey || deletingProvider} onPress={() => void createSession()} style={[styles.secondaryButton, { borderColor: colors.border.default }, (saving || clearingKey || deletingProvider) && styles.disabledButton]}>
          <Plus size={18} color={colors.primary} />
          <Text style={[styles.buttonText, { color: colors.primary }]}>新建本地对话</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={saving || clearingKey || deletingProvider} onPress={() => void removeProvider()} style={[styles.removeButton, (saving || clearingKey || deletingProvider) && styles.disabledButton]}>
          <Trash2 size={17} color={colors.status.error} />
          <Text style={[styles.buttonText, { color: colors.status.error }]}>{deletingProvider ? '删除中…' : '删除当前配置'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChangeText, colors, placeholder, secureTextEntry, autoCapitalize, editable = true }: { label: string; value: string; onChangeText: (value: string) => void; colors: ReturnType<typeof useTheme>['colors']; placeholder?: string; secureTextEntry?: boolean; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'; editable?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.text.ink }]}>{label}</Text>
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.text.placeholder} secureTextEntry={secureTextEntry} autoCapitalize={autoCapitalize} editable={editable} style={[styles.input, { color: colors.text.ink, backgroundColor: colors.bg.card, borderColor: colors.border.default }, !editable && styles.disabledButton]} />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md },
  iconButton: { width: sizing.touchTarget, height: sizing.touchTarget, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: fontSize.titleMd, fontWeight: '600' },
  headerSpacer: { width: sizing.touchTarget },
  content: { padding: spacing.lg, gap: spacing.md },
  providerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: fontSize.bodyMd, fontWeight: '700' },
  iconAction: { width: sizing.touchTarget, height: sizing.touchTarget, alignItems: 'center', justifyContent: 'center' },
  providerTabs: { gap: spacing.sm, paddingVertical: spacing.xs },
  providerTab: { maxWidth: 180, minHeight: 38, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.full, paddingHorizontal: spacing.md, justifyContent: 'center' },
  providerTabText: { fontSize: fontSize.button, fontWeight: '600' },
  help: { fontSize: fontSize.button, lineHeight: 21, marginBottom: spacing.sm },
  field: { gap: spacing.xs },
  label: { fontSize: fontSize.button, fontWeight: '600' },
  input: { minHeight: sizing.touchTarget, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: fontSize.button },
  credentialHelp: { marginTop: -spacing.xs, fontSize: fontSize.button, lineHeight: 20 },
  credentialClearButton: { minHeight: sizing.touchTarget, alignItems: 'flex-start', justifyContent: 'center' },
  primaryButton: { minHeight: sizing.touchTarget, borderRadius: radius.full, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.md },
  disabledButton: { opacity: 0.6 },
  secondaryButton: { minHeight: sizing.touchTarget, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  removeButton: { minHeight: sizing.touchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  buttonText: { fontSize: fontSize.button, fontWeight: '600' },
});
