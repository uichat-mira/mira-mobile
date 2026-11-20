import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Plus,
  Server,
} from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import {
  ProviderConfigStore,
  type LocalProviderConfig,
} from '../provider/providerConfigStore';
import { providerCredentialStore } from '../security/providerCredentialStore';
import { runtimeRegistry } from '../runtime/runtimeRegistry';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';

type NavProp = NativeStackNavigationProp<RootStackParamList>;
type ListRoute = RouteProp<RootStackParamList, 'LocalProviderList'>;
type CredentialState = 'saved' | 'missing' | 'unavailable';

const CREDENTIAL_LABELS: Record<CredentialState, string> = {
  saved: 'API Key 已保存',
  missing: '未保存 API Key',
  unavailable: '安全存储不可用',
};

const readCredentialState = async (
  providerId: string,
): Promise<CredentialState> => {
  if (!providerCredentialStore.isAvailable()) return 'unavailable';
  try {
    const key = await providerCredentialStore.load(providerId);
    return key ? 'saved' : 'missing';
  } catch {
    return 'unavailable';
  }
};

export function LocalProviderListScreen() {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<ListRoute>();
  const forChat = route.params?.mode === 'create';
  const { colors } = useTheme();
  const [configs, setConfigs] = useState<LocalProviderConfig[]>([]);
  const [credentialStates, setCredentialStates] = useState<
    Record<string, CredentialState>
  >({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadRequestRef = useRef(0);
  const creatingRef = useRef(false);
  const [creatingProviderId, setCreatingProviderId] = useState<string | null>(
    null,
  );

  const reload = useCallback(async () => {
    const request = ++loadRequestRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await new ProviderConfigStore().load();
      const states = await Promise.all(
        loaded.map(
          async config =>
            [config.id, await readCredentialState(config.id)] as const,
        ),
      );
      if (request !== loadRequestRef.current) return;
      setConfigs(loaded);
      setCredentialStates(Object.fromEntries(states));
    } catch (error) {
      if (request !== loadRequestRef.current) return;
      setConfigs([]);
      setCredentialStates({});
      setLoadError(
        error instanceof Error ? error.message : '无法读取已保存的模型配置。',
      );
    } finally {
      if (request === loadRequestRef.current) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
      return () => {
        loadRequestRef.current += 1;
      };
    }, [reload]),
  );

  const openProvider = useCallback(
    (providerId?: string) => {
      navigation.navigate(
        'LocalProviderEdit',
        providerId ? { providerId } : undefined,
      );
    },
    [navigation],
  );

  const createChatWithProvider = useCallback(
    async (provider: LocalProviderConfig) => {
      if (creatingRef.current) return;
      if (provider.requiresStandardProtocolReview) {
        Alert.alert(
          '模型配置需要检查',
          '请先修正 API 地址并保存配置，再开始聊天。',
          [
            { text: '取消', style: 'cancel' },
            { text: '编辑配置', onPress: () => openProvider(provider.id) },
          ],
        );
        return;
      }
      if (credentialStates[provider.id] !== 'saved') {
        Alert.alert(
          'API Key 尚未就绪',
          '请先编辑此模型服务，保存可用的 API Key。',
          [
            { text: '取消', style: 'cancel' },
            { text: '编辑配置', onPress: () => openProvider(provider.id) },
          ],
        );
        return;
      }
      creatingRef.current = true;
      setCreatingProviderId(provider.id);
      try {
        const session = await runtimeRegistry.createLocalSession(
          undefined,
          provider.id,
        );
        navigation.reset({
          index: 1,
          routes: [
            { name: 'SessionList' },
            {
              name: 'Chat',
              params: {
                sessionId: session.id,
                title: session.title,
                source: 'local-provider',
                providerName: provider.name,
                providerModel: provider.model,
              },
            },
          ],
        });
      } catch (error) {
        Alert.alert(
          '无法新建本地对话',
          error instanceof Error ? error.message : '请检查模型配置后重试。',
        );
      } finally {
        creatingRef.current = false;
        setCreatingProviderId(null);
      }
    },
    [credentialStates, navigation, openProvider],
  );

  const renderProvider = (config: LocalProviderConfig) => {
    const credentialState = credentialStates[config.id] ?? 'missing';
    const credentialLabel = CREDENTIAL_LABELS[credentialState];
    const credentialColor =
      credentialState === 'saved' ? colors.status.success : colors.text.soft;

    return (
      <Pressable
        key={config.id}
        accessibilityRole="button"
        accessibilityLabel={`${forChat ? '使用' : '编辑'} ${
          config.name || config.model || config.id
        }`}
        onPress={() =>
          forChat
            ? void createChatWithProvider(config)
            : openProvider(config.id)
        }
        disabled={creatingProviderId !== null}
        style={({ pressed }) => [
          styles.providerCard,
          {
            backgroundColor: colors.bg.card,
            borderColor: colors.border.default,
          },
          pressed && { backgroundColor: colors.bg.soft },
        ]}
      >
        <View
          style={[styles.providerIcon, { backgroundColor: colors.bg.soft }]}
        >
          <Server size={20} color={colors.primary} />
        </View>
        <View style={styles.providerBody}>
          <Text
            style={[styles.providerName, { color: colors.text.ink }]}
            numberOfLines={1}
          >
            {config.name || '未命名模型'}
          </Text>
          <Text
            style={[styles.providerModel, { color: colors.text.base }]}
            numberOfLines={1}
          >
            {config.model || '尚未填写模型名称'}
          </Text>
          <Text
            style={[styles.providerMeta, { color: colors.text.soft }]}
            numberOfLines={1}
          >
            {config.baseUrl || '尚未填写 API 地址'}
          </Text>
          <View style={styles.credentialRow}>
            <KeyRound size={13} color={credentialColor} />
            <Text style={[styles.credentialText, { color: credentialColor }]}>
              {credentialLabel}
            </Text>
            <Text
              style={[styles.verificationText, { color: colors.text.soft }]}
            >
              · 未验证连接
            </Text>
          </View>
        </View>
        {creatingProviderId === config.id ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <ChevronRight size={20} color={colors.text.soft} />
        )}
      </Pressable>
    );
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.bg.canvas }]}
      edges={['top', 'bottom']}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: colors.bg.card },
            pressed && styles.pressed,
          ]}
        >
          <ChevronLeft size={24} color={colors.text.ink} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text.ink }]}>
          {forChat ? '选择模型服务' : '模型直连'}
        </Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: colors.text.soft }]}>
          {forChat
            ? '选择已配置的模型开始聊天。'
            : '在本机安全保存 API Key，通过标准 API 协议连接你的模型服务。'}
        </Text>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : loadError ? (
          <View
            style={[
              styles.errorCard,
              {
                backgroundColor: colors.bg.card,
                borderColor: colors.border.default,
              },
            ]}
          >
            <Text style={[styles.errorTitle, { color: colors.text.ink }]}>
              无法读取模型配置
            </Text>
            <Text style={[styles.errorText, { color: colors.text.soft }]}>
              {loadError}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="重新读取模型配置"
              onPress={() => void reload()}
              style={[
                styles.retryButton,
                { borderColor: colors.border.default },
              ]}
            >
              <Text style={[styles.retryText, { color: colors.text.ink }]}>
                重试
              </Text>
            </Pressable>
          </View>
        ) : configs.length === 0 ? (
          <View style={styles.emptyState}>
            <View
              style={[styles.emptyIcon, { backgroundColor: colors.bg.soft }]}
            >
              <Server size={28} color={colors.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text.ink }]}>
              还没有模型配置
            </Text>
            <Text style={[styles.emptyText, { color: colors.text.soft }]}>
              添加一个支持标准 API 协议的模型服务后，即可在设备侧直接生成对话。
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="添加第一个模型"
              onPress={() => openProvider()}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: colors.primary },
                pressed && styles.pressed,
              ]}
            >
              <Plus size={18} color={colors.onPrimary} />
              <Text style={[styles.buttonText, { color: colors.onPrimary }]}>
                添加模型
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text.soft }]}>
              我的模型服务 · {configs.length}
            </Text>
            <View style={styles.providerList}>
              {configs.map(renderProvider)}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="新增服务"
              onPress={() => openProvider()}
              style={[
                styles.primaryButton,
                { backgroundColor: colors.primary },
              ]}
            >
              <Plus size={18} color={colors.onPrimary} />
              <Text style={[styles.buttonText, { color: colors.onPrimary }]}>
                新增服务
              </Text>
            </Pressable>
            <Text style={[styles.footerHint, { color: colors.text.soft }]}>
              {forChat
                ? '选择模型服务后，将以此配置新建本地对话。'
                : '此处只管理模型服务；在聊天入口选择「本地连接」后开始对话。'}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.titleMd,
    fontWeight: '700',
  },
  pressed: { opacity: 0.72 },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.section,
    gap: spacing.md,
  },
  intro: {
    fontSize: fontSize.button,
    lineHeight: 21,
    paddingHorizontal: spacing.xs,
  },
  loading: { paddingVertical: spacing.section, alignItems: 'center' },
  sectionTitle: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm,
  },
  providerList: { gap: spacing.sm },
  providerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 92,
  },
  providerIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerBody: { flex: 1, gap: 2 },
  providerName: { fontSize: fontSize.titleMd, fontWeight: '600' },
  providerModel: { fontSize: fontSize.caption },
  providerMeta: { fontSize: fontSize.caption },
  verificationText: { fontSize: fontSize.caption },
  credentialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  credentialText: { fontSize: fontSize.caption },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.section,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: fontSize.titleLg,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  emptyText: { fontSize: fontSize.button, lineHeight: 21, textAlign: 'center' },
  primaryButton: {
    minHeight: sizing.touchTarget,
    borderRadius: radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
  },
  buttonText: { fontSize: fontSize.button, fontWeight: '600' },
  errorCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  errorTitle: { fontSize: fontSize.titleMd, fontWeight: '600' },
  errorText: { fontSize: fontSize.button, lineHeight: 21 },
  retryButton: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  retryText: { fontSize: fontSize.button, fontWeight: '600' },
  footerHint: {
    fontSize: fontSize.caption,
    lineHeight: 19,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm,
  },
});
