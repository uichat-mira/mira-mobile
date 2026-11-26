import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ArrowLeft,
  Clock3,
  ExternalLink,
  FileText,
  History,
  Mic2,
  Plus,
  Puzzle,
  Sparkles,
} from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme/tokens';
import { getShiyanHistoryDataSource, type ShiyanHistoryTaskSummary } from './history';
import {
  SHIYAN_BUILT_IN_SCENES,
  getCustomSceneDraft,
  saveCustomSceneDraft,
  type ShiyanSceneDefinition,
} from './scenes';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

function ScreenShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const navigation = useNavigation<NavProp>();
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg.canvas }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.65 }]}
        >
          <ArrowLeft size={22} color={colors.text.ink} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text.ink }]}>{title}</Text>
        <View style={styles.backButton} />
      </View>
      {children}
    </SafeAreaView>
  );
}

function ActionCard({
  icon: Icon,
  title,
  description,
  onPress,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  title: string;
  description: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? colors.bg.soft : colors.bg.card,
          borderColor: colors.border.default,
        },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.bg.soft }]}>
        <Icon size={22} color={colors.primary} />
      </View>
      <View style={styles.cardText}>
        <Text style={[styles.cardTitle, { color: colors.text.ink }]}>{title}</Text>
        <Text style={[styles.cardDescription, { color: colors.text.soft }]}>
          {description}
        </Text>
      </View>
    </Pressable>
  );
}

export function ShiyanHomeScreen() {
  const navigation = useNavigation<NavProp>();
  const { colors } = useTheme();

  return (
    <ScreenShell title="拾言">
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.hero, { backgroundColor: colors.bg.card, borderColor: colors.border.default }]}>
          <Sparkles size={28} color={colors.primary} />
          <Text style={[styles.heroTitle, { color: colors.text.ink }]}>先说下来，再慢慢整理。</Text>
          <Text style={[styles.heroText, { color: colors.text.soft }]}>选择一个场景开始。录音接入后，会从这里继续进入采集与确认流程。</Text>
        </View>
        <ActionCard
          icon={Mic2}
          title="选择场景"
          description="会议采集、临时口述需求、个人复盘 / 想法记录。"
          onPress={() => navigation.navigate('ShiyanSceneSelect')}
        />
        <ActionCard
          icon={History}
          title="历史任务"
          description="查看处理中的任务、待调整内容与真实投递去向。"
          onPress={() => navigation.navigate('ShiyanHistory')}
        />
      </ScrollView>
    </ScreenShell>
  );
}

export function ShiyanSceneSelectScreen() {
  const navigation = useNavigation<NavProp>();
  const { colors } = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customScene, setCustomScene] = useState<ShiyanSceneDefinition | null>(() =>
    getCustomSceneDraft(),
  );

  useFocusEffect(
    useCallback(() => {
      setCustomScene(getCustomSceneDraft());
    }, []),
  );

  const scenes = useMemo(
    () =>
      customScene
        ? [...SHIYAN_BUILT_IN_SCENES, customScene]
        : [...SHIYAN_BUILT_IN_SCENES],
    [customScene],
  );

  return (
    <ScreenShell title="选择场景">
      <ScrollView contentContainerStyle={styles.content}>
        {scenes.map((scene: ShiyanSceneDefinition) => {
          const selected = selectedId === scene.id;
          return (
            <Pressable
              key={scene.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setSelectedId(scene.id)}
              style={({ pressed }) => [
                styles.sceneCard,
                {
                  backgroundColor: pressed || selected ? colors.bg.soft : colors.bg.card,
                  borderColor: selected ? colors.primary : colors.border.default,
                },
              ]}
            >
              <Text style={[styles.cardTitle, { color: colors.text.ink }]}>{scene.name}</Text>
              <Text style={[styles.cardDescription, { color: colors.text.soft }]}>{scene.description}</Text>
              <Text style={[styles.structureText, { color: colors.text.base }]}>
                {scene.outputStructure.join(' · ')}
              </Text>
            </Pressable>
          );
        })}

        <ActionCard
          icon={Plus}
          title="自定义场景"
          description="只配置名称、整理要求和输出结构，不开放完整 Prompt。"
          onPress={() => navigation.navigate('ShiyanSceneConfig')}
        />

        <View style={[styles.pendingBox, { backgroundColor: colors.bg.soft }]}>
          <Clock3 size={18} color={colors.text.soft} />
          <Text style={[styles.pendingText, { color: colors.text.soft }]}>场景选择已就绪；录音能力接入后会从这里继续进入采集流程。</Text>
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

export function ShiyanHistoryScreen() {
  const { colors } = useTheme();
  const [tasks, setTasks] = useState<readonly ShiyanHistoryTaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const latestReloadToken = useRef(reloadToken);
  latestReloadToken.current = reloadToken;

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const attemptToken = reloadToken;
      setLoading(true);
      setLoadFailed(false);
      getShiyanHistoryDataSource()
        .listTasks()
        .then((nextTasks) => {
          if (active && latestReloadToken.current === attemptToken) {
            setTasks(nextTasks);
            setLoadFailed(false);
          }
        })
        .catch(() => {
          if (active && latestReloadToken.current === attemptToken) {
            setLoadFailed(true);
          }
        })
        .finally(() => {
          if (active && latestReloadToken.current === attemptToken) {
            setLoading(false);
          }
        });
      return () => {
        active = false;
      };
    }, [reloadToken]),
  );

  return (
    <ScreenShell title="历史任务">
      {loadFailed ? (
        <View style={styles.emptyState}>
          <FileText size={34} color={colors.text.soft} />
          <Text style={[styles.emptyTitle, { color: colors.text.ink }]}>拾言任务读取失败</Text>
          <Text style={[styles.emptyText, { color: colors.text.soft }]}>没有把读取失败当成空历史。请检查连接后重新加载。</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重新加载拾言任务"
            disabled={loading}
            onPress={() => setReloadToken((value) => value + 1)}
            style={({ pressed }) => [
              styles.retryButton,
              { borderColor: colors.border.default, backgroundColor: pressed ? colors.bg.soft : colors.bg.card },
            ]}
          >
            <Text style={[styles.retryButtonText, { color: colors.primary }]}>{loading ? '正在重试' : '重新加载'}</Text>
          </Pressable>
        </View>
      ) : tasks.length > 0 ? (
        <ScrollView contentContainerStyle={styles.content}>
          {tasks.map((task) => (
            <View
              key={task.id}
              style={[styles.historyCard, { backgroundColor: colors.bg.card, borderColor: colors.border.default }]}
            >
              <Text style={[styles.cardTitle, { color: colors.text.ink }]}>{task.title}</Text>
              <Text style={[styles.cardDescription, { color: colors.text.soft }]}>{task.sceneName} · {task.createdAt}</Text>
              <Text style={[styles.structureText, { color: colors.text.base }]}>{task.currentStage} · {task.stageStatus}</Text>
              {task.canonicalDestinationUrl ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => void Linking.openURL(task.canonicalDestinationUrl as string)}
                  style={styles.destinationLink}
                >
                  <ExternalLink size={14} color={colors.primary} />
                  <Text style={[styles.destinationLinkText, { color: colors.primary }]}>打开真实去向</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.emptyState}>
          <FileText size={34} color={colors.text.soft} />
          <Text style={[styles.emptyTitle, { color: colors.text.ink }]}>{loading ? '正在读取拾言任务' : '还没有拾言任务'}</Text>
          <Text style={[styles.emptyText, { color: colors.text.soft }]}>完成首次真实采集后，这里会显示任务标题、场景、时间、当前阶段和可打开的投递去向。</Text>
        </View>
      )}
    </ScreenShell>
  );
}

export function ShiyanSceneConfigScreen() {
  const navigation = useNavigation<NavProp>();
  const { colors } = useTheme();
  const existing = getCustomSceneDraft();
  const [name, setName] = useState(existing?.name ?? '');
  const [requirement, setRequirement] = useState(existing?.organizationRequirement ?? '');
  const [outputStructure, setOutputStructure] = useState(existing?.outputStructure.join('\n') ?? '');

  const save = () => {
    try {
      saveCustomSceneDraft({ name, organizationRequirement: requirement, outputStructure });
      navigation.goBack();
    } catch (error) {
      Alert.alert('无法保存场景', error instanceof Error ? error.message : '请检查场景配置。');
    }
  };

  return (
    <ScreenShell title="自定义场景">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.fieldLabel, { color: colors.text.base }]}>场景名称</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="例如：客户访谈"
          placeholderTextColor={colors.text.soft}
          style={[styles.input, { color: colors.text.ink, backgroundColor: colors.bg.card, borderColor: colors.border.default }]}
        />
        <Text style={[styles.fieldLabel, { color: colors.text.base }]}>整理要求</Text>
        <TextInput
          value={requirement}
          onChangeText={setRequirement}
          multiline
          placeholder="说明希望拾言如何整理，但不直接编辑完整 Prompt"
          placeholderTextColor={colors.text.soft}
          style={[styles.input, styles.multiline, { color: colors.text.ink, backgroundColor: colors.bg.card, borderColor: colors.border.default }]}
        />
        <Text style={[styles.fieldLabel, { color: colors.text.base }]}>输出结构</Text>
        <TextInput
          value={outputStructure}
          onChangeText={setOutputStructure}
          multiline
          placeholder={'每行一项，例如：\n摘要\n关键问题\n下一步'}
          placeholderTextColor={colors.text.soft}
          style={[styles.input, styles.multiline, { color: colors.text.ink, backgroundColor: colors.bg.card, borderColor: colors.border.default }]}
        />
        <Pressable
          accessibilityRole="button"
          onPress={save}
          style={({ pressed }) => [styles.primaryButton, { backgroundColor: pressed ? colors.primaryActive : colors.primary }]}
        >
          <Puzzle size={18} color={colors.onPrimary} />
          <Text style={[styles.primaryButtonText, { color: colors.onPrimary }]}>保存本地场景</Text>
        </Pressable>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '600' },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  hero: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.sm },
  heroTitle: { fontSize: 22, fontWeight: '700' },
  heroText: { fontSize: 14, lineHeight: 21 },
  card: { minHeight: 88, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.lg, flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  iconWrap: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1, gap: 5 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardDescription: { fontSize: 14, lineHeight: 20 },
  sceneCard: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: 7 },
  historyCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  destinationLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start' },
  destinationLinkText: { fontSize: 13, fontWeight: '600' },
  structureText: { fontSize: 12, lineHeight: 18 },
  pendingBox: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'flex-start' },
  pendingText: { flex: 1, fontSize: 13, lineHeight: 19 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: spacing.sm },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: spacing.sm },
  emptyText: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  retryButton: { minHeight: 42, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.full, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  retryButtonText: { fontSize: 14, fontWeight: '600' },
  fieldLabel: { fontSize: 14, fontWeight: '600', marginTop: spacing.sm },
  input: { minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 15 },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  primaryButton: { minHeight: 48, borderRadius: radius.full, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.md },
  primaryButtonText: { fontSize: 15, fontWeight: '600' },
});