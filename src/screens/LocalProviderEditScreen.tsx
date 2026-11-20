import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ChevronDown,
  ChevronUp,
  KeyRound,
  Save,
  Trash2,
} from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import {
  ProviderConfigStore,
  type LocalProviderConfig,
} from '../provider/providerConfigStore';
import {
  OPENAI_STANDARD_PROTOCOL_OPTIONS,
  normalizeOpenAiStandardBaseUrl,
} from '../provider/openAiStandardProtocol';
import { providerCredentialStore } from '../security/providerCredentialStore';
import { runtimeRegistry } from '../runtime/runtimeRegistry';
import {
  LocalProviderDeletionRollbackIncompleteError,
  LocalProviderDeletionScopeChangedError,
} from '../runtime/localProviderRuntime';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/palette';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import { SettingsPageHeader } from '../settings/SettingsPageHeader';

type NavProp = NativeStackNavigationProp<RootStackParamList>;
type EditRoute = RouteProp<RootStackParamList, 'LocalProviderEdit'>;

const createDraftProvider = (): LocalProviderConfig => ({
  id: `provider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name: '',
  baseUrl: '',
  model: '',
  protocol: 'openai-chat-completions',
});

export function LocalProviderEditScreen() {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<EditRoute>();
  const { colors } = useTheme();
  const requestedProviderId = route.params?.providerId;
  const [config, setConfig] = useState<LocalProviderConfig | null>(null);
  const [persistedId, setPersistedId] = useState<string | null>(
    requestedProviderId ?? null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearingKey, setClearingKey] = useState(false);
  const [deletingProvider, setDeletingProvider] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const deletingProviderRef = useRef(false);
  const credentialLoadRequestRef = useRef(0);
  const initialConfigRef = useRef<string | null>(null);
  const allowLeaveRef = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!requestedProviderId) {
        if (active) {
          const draft = createDraftProvider();
          initialConfigRef.current = JSON.stringify(draft);
          setConfig(draft);
        }
        return;
      }
      try {
        const configs = await new ProviderConfigStore().load();
        const existing = configs.find(item => item.id === requestedProviderId);
        if (!active) return;
        if (!existing) {
          setLoadError('此模型配置已不存在，可能已在其他页面删除。');
          return;
        }
        initialConfigRef.current = JSON.stringify(existing);
        setConfig(existing);
        if (existing.requiresStandardProtocolReview) setAdvancedOpen(true);
        const requestId = ++credentialLoadRequestRef.current;
        const existingKey = await providerCredentialStore
          .load(existing.id)
          .catch(() => null);
        if (active && credentialLoadRequestRef.current === requestId) {
          setHasStoredKey(Boolean(existingKey));
        }
      } catch (error) {
        if (!active) return;
        setLoadError(
          error instanceof Error ? error.message : '无法读取模型配置。',
        );
      }
    })();
    return () => {
      active = false;
      credentialLoadRequestRef.current += 1;
    };
  }, [requestedProviderId]);

  const isPersisted = persistedId !== null;
  const busy = saving || clearingKey || deletingProvider;
  const fieldsEditable = !busy;
  const hasUnsavedEdits =
    config !== null &&
    (JSON.stringify(config) !== initialConfigRef.current ||
      apiKeyDraft.length > 0);

  // The editor owns unsaved changes. Returning via the system back gesture
  // must not silently discard edits or a newly typed credential.
  useEffect(() => {
    return navigation.addListener('beforeRemove', event => {
      if (allowLeaveRef.current) return;
      if (!hasUnsavedEdits && !busy) return;
      event.preventDefault();
      if (busy) {
        Alert.alert('正在保存或修改配置', '操作完成后再返回，避免丢失更新。');
        return;
      }
      Alert.alert('放弃未保存修改？', '当前模型服务的修改尚未保存。', [
        { text: '继续编辑', style: 'cancel' },
        {
          text: '放弃修改',
          style: 'destructive',
          onPress: () => {
            allowLeaveRef.current = true;
            navigation.dispatch(event.data.action);
          },
        },
      ]);
    });
  }, [busy, hasUnsavedEdits, navigation]);

  const save = useCallback(async () => {
    if (!config || saving) return;
    if (!config.baseUrl.trim() || !config.model.trim()) {
      Alert.alert('配置不完整', '请填写 Provider 地址和模型名称。');
      return;
    }

    let standardBaseUrl: string;
    try {
      standardBaseUrl = normalizeOpenAiStandardBaseUrl(config.baseUrl);
    } catch (error) {
      Alert.alert(
        'Base URL 不是标准 API 地址',
        error instanceof Error
          ? `${error.message}。请填写 API 根地址，例如 https://api.example.com 或标准 /v1 根地址。`
          : '请填写 API 根地址或标准 /v1 根地址。',
      );
      return;
    }

    const next: LocalProviderConfig = {
      id: config.id.trim() || createDraftProvider().id,
      name: config.name.trim() || '模型直连',
      baseUrl: standardBaseUrl,
      model: config.model.trim(),
      protocol: config.protocol,
      ...(config.toolGatewayId ? { toolGatewayId: config.toolGatewayId } : {}),
    };
    setSaving(true);
    try {
      await new ProviderConfigStore().upsert(next);
      setConfig(next);
      setPersistedId(next.id);
    } catch {
      Alert.alert('保存失败', '无法保存模型配置，请检查输入后重试。');
      setSaving(false);
      return;
    }

    const nextApiKey = apiKeyDraft.trim();
    if (nextApiKey) {
      try {
        await providerCredentialStore.save(next.id, nextApiKey);
        setHasStoredKey(true);
        setApiKeyDraft('');
      } catch {
        setSaving(false);
        Alert.alert(
          '配置已保存，但 API Key 保存失败',
          '模型配置已经写入本机，但 API Key 未能保存到安全存储。请重新输入 API Key 并保存。',
        );
        return;
      }
    }
    initialConfigRef.current = JSON.stringify(next);
    setSaving(false);
    allowLeaveRef.current = true;
    navigation.goBack();
  }, [apiKeyDraft, config, navigation, saving]);

  const clearApiKey = useCallback(() => {
    if (!config || !hasStoredKey || busy) return;
    const providerId = config.id;
    Alert.alert(
      '清除 API Key？',
      '清除后，此模型配置需要重新填写 API Key 才能继续直连模型。',
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
                if (credentialLoadRequestRef.current === requestId) {
                  setHasStoredKey(false);
                }
                Alert.alert('已清除', 'API Key 已清除。');
              })
              .catch(() => {
                Alert.alert(
                  '清除失败',
                  '无法清除此配置的 API Key，请稍后重试。',
                );
              })
              .finally(() => {
                setClearingKey(false);
              });
          },
        },
      ],
    );
  }, [busy, config, hasStoredKey]);

  const finishProviderRemoval = useCallback(
    async (providerId: string, expectedSessionCount: number) => {
      if (deletingProviderRef.current) return;
      deletingProviderRef.current = true;
      setDeletingProvider(true);
      try {
        await runtimeRegistry.deleteLocalProvider(
          providerId,
          expectedSessionCount,
        );
        allowLeaveRef.current = true;
        navigation.goBack();
      } catch (error) {
        if (error instanceof LocalProviderDeletionScopeChangedError) {
          Alert.alert(
            '删除范围已变化',
            `此 Provider 当前关联 ${error.actualSessionCount} 个本地对话。刚才的确认已失效；请再次点击“删除此配置”，按最新范围重新确认。`,
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
              '部分本地状态可能已经变化。请重新打开模型列表检查配置、API Key 和关联对话后，再决定是否继续操作。',
            );
          }
          return;
        }
        Alert.alert(
          '删除失败',
          error instanceof Error && error.message
            ? error.message
            : '无法删除此模型配置，请稍后重试。',
        );
      } finally {
        deletingProviderRef.current = false;
        setDeletingProvider(false);
      }
    },
    [deletingProviderRef, navigation],
  );

  const removeProvider = useCallback(async () => {
    if (!config || !persistedId || deletingProviderRef.current) return;
    try {
      const impact = await runtimeRegistry.getLocalProviderDeletionImpact(
        persistedId,
      );
      const conversationText =
        impact.sessionCount === 0
          ? '当前没有关联本地对话。'
          : `将同时删除此 Provider 关联的 ${impact.sessionCount} 个本地对话。`;

      Alert.alert(
        '删除模型配置？',
        `删除“${
          config.name || config.model || persistedId
        }”的配置和 API Key。\n\n${conversationText}\n\n如该 Provider 正在生成内容，将先停止这些请求再删除。\n\n不会影响其他 Provider、Remote Host、记忆或个性化设置。`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '删除',
            style: 'destructive',
            onPress: () =>
              void finishProviderRemoval(persistedId, impact.sessionCount),
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
  }, [config, deletingProviderRef, finishProviderRemoval, persistedId]);

  if (!config) {
    return (
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: colors.bg.canvas }]}
        edges={['top', 'bottom']}
      >
        <SettingsPageHeader title="模型配置" />
        <View style={styles.loading}>
          {loadError ? (
            <>
              <Text style={[styles.loadErrorTitle, { color: colors.text.ink }]}>
                无法打开此配置
              </Text>
              <Text style={[styles.loadErrorText, { color: colors.text.soft }]}>
                {loadError}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="返回模型列表"
                onPress={() => navigation.goBack()}
                style={[
                  styles.secondaryButton,
                  { borderColor: colors.border.default },
                ]}
              >
                <Text style={[styles.buttonText, { color: colors.primary }]}>
                  返回模型列表
                </Text>
              </Pressable>
            </>
          ) : (
            <ActivityIndicator color={colors.primary} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.bg.canvas }]}
      edges={['top', 'bottom']}
    >
      <SettingsPageHeader
        title={isPersisted ? '编辑模型服务' : '新增模型服务'}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.credentialSummary}>
          <KeyRound
            size={18}
            color={hasStoredKey ? colors.status.success : colors.text.soft}
          />
          <Text
            style={[styles.credentialSummaryText, { color: colors.text.soft }]}
          >
            {hasStoredKey
              ? 'API Key 已保存在本机安全存储。留空可继续使用原 Key。'
              : 'API Key 只写入本机安全存储，不进入配置 JSON，也不会上传到 Host。'}
          </Text>
        </View>

        {config.requiresStandardProtocolReview ? (
          <Text style={[styles.warning, { color: colors.status.warning }]}>
            此配置由旧版本迁移而来，Base URL 不是可确认的标准 API 根地址。请检查
            Base URL、协议和模型后重新保存。
          </Text>
        ) : null}
        {config.legacyReasoningBehaviorChanged ? (
          <Text style={[styles.notice, { color: colors.text.soft }]}>
            旧版 reasoning-tag
            过滤兼容已移除；此标准协议配置仍可继续使用。请确认模型输出符合标准协议，重新保存后不再提示。
          </Text>
        ) : null}
        {__DEV__ && /^http:\/\//iu.test(config.baseUrl.trim()) ? (
          <Text style={[styles.warning, { color: colors.status.warning }]}>
            开发模式 · HTTP 明文连接，仅用于受信任的局域网调试。
          </Text>
        ) : null}

        <View
          style={[
            styles.formCard,
            {
              backgroundColor: colors.bg.card,
              borderColor: colors.border.soft,
            },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text.ink }]}>
            基本信息
          </Text>
          <Field
            label="服务名称"
            value={config.name}
            onChangeText={name =>
              setConfig(current => current && { ...current, name })
            }
            colors={colors}
            placeholder="例如：工作模型"
            editable={fieldsEditable}
          />
          <Field
            label="API 地址"
            value={config.baseUrl}
            onChangeText={baseUrl =>
              setConfig(current => current && { ...current, baseUrl })
            }
            placeholder="https://api.example.com"
            colors={colors}
            autoCapitalize="none"
            editable={fieldsEditable}
          />
          <Field
            label="API Key"
            value={apiKeyDraft}
            onChangeText={setApiKeyDraft}
            placeholder={
              hasStoredKey ? '已保存；输入新 Key 可替换' : '请输入 API Key'
            }
            colors={colors}
            secureTextEntry
            autoCapitalize="none"
            editable={fieldsEditable}
          />
          <Field
            label="模型名称"
            value={config.model}
            onChangeText={model =>
              setConfig(current => current && { ...current, model })
            }
            placeholder="模型 ID"
            colors={colors}
            autoCapitalize="none"
            editable={fieldsEditable}
          />
        </View>

        <View
          style={[
            styles.formCard,
            {
              backgroundColor: colors.bg.card,
              borderColor: colors.border.soft,
            },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="高级设置"
            accessibilityState={{ expanded: advancedOpen }}
            onPress={() => setAdvancedOpen(value => !value)}
            style={styles.advancedHeader}
          >
            <Text style={[styles.sectionTitle, { color: colors.text.ink }]}>
              高级设置
            </Text>
            {advancedOpen ? (
              <ChevronUp size={18} color={colors.text.soft} />
            ) : (
              <ChevronDown size={18} color={colors.text.soft} />
            )}
          </Pressable>
          {advancedOpen ? (
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.text.ink }]}>
                调用协议
              </Text>
              <View style={styles.protocolOptions}>
                {OPENAI_STANDARD_PROTOCOL_OPTIONS.map(option => {
                  const selected = config.protocol === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      disabled={busy}
                      onPress={() =>
                        setConfig(current =>
                          current
                            ? { ...current, protocol: option.value }
                            : current,
                        )
                      }
                      style={[
                        styles.protocolOption,
                        {
                          borderColor: selected
                            ? colors.primary
                            : colors.border.default,
                          backgroundColor: selected
                            ? colors.bg.soft
                            : colors.bg.card,
                        },
                        busy && styles.disabledButton,
                      ]}
                    >
                      <Text
                        style={[
                          styles.protocolLabel,
                          {
                            color: selected ? colors.primary : colors.text.base,
                          },
                        ]}
                      >
                        {option.label}
                      </Text>
                      <Text
                        style={[
                          styles.protocolEndpoint,
                          { color: colors.text.soft },
                        ]}
                      >
                        {option.endpoint}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : (
            <Text style={[styles.protocolHint, { color: colors.text.soft }]}>
              标准协议 ·{' '}
              {config.protocol === 'openai-responses'
                ? 'OpenAI Responses'
                : 'OpenAI Chat Completions'}
            </Text>
          )}
        </View>

        <View
          style={[styles.testStatusRow, { borderColor: colors.border.soft }]}
        >
          <Text style={[styles.label, { color: colors.text.base }]}>
            连接测试
          </Text>
          <Text style={[styles.testStatusText, { color: colors.text.soft }]}>
            尚未测试 · 功能待接入
          </Text>
        </View>

        {hasStoredKey ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="清除 API Key"
            disabled={busy}
            onPress={clearApiKey}
            style={[
              styles.credentialClearButton,
              busy && styles.disabledButton,
            ]}
          >
            <Text style={[styles.buttonText, { color: colors.status.error }]}>
              清除 API Key
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="保存模型配置"
          disabled={busy}
          onPress={() => void save()}
          style={[
            styles.primaryButton,
            { backgroundColor: colors.primary },
            busy && styles.disabledButton,
          ]}
        >
          <Save size={18} color={colors.onPrimary} />
          <Text style={[styles.buttonText, { color: colors.onPrimary }]}>
            {saving ? '保存中' : '保存配置'}
          </Text>
        </Pressable>

        {isPersisted ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void removeProvider()}
            style={[styles.removeButton, busy && styles.disabledButton]}
          >
            <Trash2 size={17} color={colors.status.error} />
            <Text style={[styles.buttonText, { color: colors.status.error }]}>
              {deletingProvider ? '删除中…' : '删除此配置'}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  colors,
  placeholder,
  secureTextEntry,
  autoCapitalize,
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  colors: ThemeColors;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  editable?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.text.ink }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.text.placeholder}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        editable={editable}
        style={[
          styles.input,
          {
            color: colors.text.ink,
            backgroundColor: colors.bg.card,
            borderColor: colors.border.default,
          },
          !editable && styles.disabledButton,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  loadErrorTitle: { fontSize: fontSize.titleMd, fontWeight: '600' },
  loadErrorText: {
    fontSize: fontSize.button,
    lineHeight: 21,
    textAlign: 'center',
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.section,
    gap: spacing.md,
  },
  credentialSummary: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  credentialSummaryText: {
    flex: 1,
    fontSize: fontSize.caption,
    lineHeight: 19,
  },
  warning: { fontSize: fontSize.button, lineHeight: 21 },
  notice: { fontSize: fontSize.button, lineHeight: 21 },
  formCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  sectionTitle: { fontSize: fontSize.titleMd, fontWeight: '600' },
  advancedHeader: {
    minHeight: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  protocolHint: { fontSize: fontSize.caption, marginBottom: spacing.xs },
  testStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    minHeight: sizing.touchTarget,
    paddingHorizontal: spacing.md,
  },
  testStatusText: { fontSize: fontSize.caption },
  field: { gap: spacing.xs },
  label: { fontSize: fontSize.button, fontWeight: '600' },
  input: {
    minHeight: sizing.touchTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.button,
  },
  protocolOptions: { gap: spacing.sm },
  protocolOption: {
    minHeight: sizing.touchTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
    gap: 2,
  },
  protocolLabel: { fontSize: fontSize.button, fontWeight: '600' },
  protocolEndpoint: { fontSize: fontSize.button },
  credentialClearButton: {
    minHeight: sizing.touchTarget,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  primaryButton: {
    minHeight: sizing.touchTarget,
    borderRadius: radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  secondaryButton: {
    minHeight: sizing.touchTarget,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  removeButton: {
    minHeight: sizing.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  disabledButton: { opacity: 0.6 },
  buttonText: { fontSize: fontSize.button, fontWeight: '600' },
});
