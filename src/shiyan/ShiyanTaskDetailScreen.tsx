import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
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
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  MoreHorizontal,
  RefreshCw,
  Share2,
  Sparkles,
  Upload,
  Volume2,
} from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import { shiyanClient, ShiyanClientError } from './client/ShiyanClient';
import type {
  ShiyanAdjustmentCandidate,
  ShiyanCaptureTaskView,
  ShiyanTaskContentView,
  ShiyanTranscriptView,
} from './client/contracts';
import { getShiyanContentDataSource } from './content';
import { ShiyanActionSheet, type ShiyanActionSheetItem } from './ShiyanActionSheet';
import { ShiyanStageRecoveryNotice } from './ShiyanStageRecoveryNotice';
import { AudioPlayer } from './playback/AudioPlayer';
import {
  localCaptureRepository,
  type LocalCaptureMetadata,
} from './recording/localCaptureRepository';
import { shiyanSceneNameForId } from './scenes';
import {
  selectShiyanFinalEditorSeed,
  selectShiyanReviewResult,
} from './taskReviewPresentation';
import {
  currentShiyanStage,
  retryActionForStage,
  shiyanStageLabel,
  shiyanStageRecoveryPresentation,
  shiyanStageStatusLabel,
  shiyanTaskStatusText,
  stageFailureText,
} from './taskPresentation';

type NavProp = NativeStackNavigationProp<RootStackParamList>;
type TranscriptState =
  | { status: 'not_ready'; value: null; message: null }
  | { status: 'ready'; value: ShiyanTranscriptView; message: null }
  | { status: 'error'; value: ShiyanTranscriptView | null; message: string };
type TaskStage = ShiyanCaptureTaskView['stages'][number];

export interface ShiyanFinalEditorState {
  open: boolean;
  dirty: boolean;
  saving: boolean;
}

export interface ShiyanTaskDeliveryActions {
  available: boolean;
  busy: boolean;
  blocked: boolean;
  succeeded: boolean;
  failed: boolean;
  statusText: string;
  onDeliver: () => void;
  onOpenDelivery: () => void;
}

interface ShiyanTaskDetailScreenProps {
  onFinalEditorStateChange?: (state: ShiyanFinalEditorState) => void;
  deliveryActions?: ShiyanTaskDeliveryActions;
}

const EMPTY_TRANSCRIPT: TranscriptState = {
  status: 'not_ready',
  value: null,
  message: null,
};

export function ShiyanTaskDetailScreen({
  onFinalEditorStateChange,
  deliveryActions,
}: ShiyanTaskDetailScreenProps = {}) {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<RouteProp<RootStackParamList, 'ShiyanTaskDetail'>>();
  const { colors } = useTheme();
  const taskId = route.params.taskId;
  const [task, setTask] = useState<ShiyanCaptureTaskView | null>(null);
  const [taskError, setTaskError] = useState('');
  const [loading, setLoading] = useState(true);
  const [transcript, setTranscript] = useState<TranscriptState>(EMPTY_TRANSCRIPT);
  const [contentTab, setContentTab] = useState<'organized' | 'transcript'>('organized');
  const [processingOpen, setProcessingOpen] = useState(false);
  const [content, setContent] = useState<ShiyanTaskContentView | null>(null);
  const [contentUnavailable, setContentUnavailable] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustInstruction, setAdjustInstruction] = useState('');
  const [candidate, setCandidate] = useState<ShiyanAdjustmentCandidate | null>(null);
  const [finalEditorOpen, setFinalEditorOpen] = useState(false);
  const [finalMarkdown, setFinalMarkdown] = useState('');
  const [editorBaselineMarkdown, setEditorBaselineMarkdown] = useState('');
  const [finalBaseVersion, setFinalBaseVersion] = useState<number | null>(null);
  const [savedFinalMarkdown, setSavedFinalMarkdown] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [retentionChoice, setRetentionChoice] = useState<boolean | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [editActionsOpen, setEditActionsOpen] = useState(false);
  const [localCapture, setLocalCapture] = useState<LocalCaptureMetadata | null>(null);
  const allowNavigation = useRef(false);
  const contentGeneration = useRef(0);
  const finalSaveInFlight = useRef(false);

  const finalDraftDirty = useMemo(
    () =>
      finalEditorOpen &&
      finalMarkdown.trim() !== editorBaselineMarkdown.trim(),
    [editorBaselineMarkdown, finalEditorOpen, finalMarkdown],
  );
  const finalDraftSaving = busyAction === 'save-final';
  const shareBlocked = finalDraftDirty || finalDraftSaving;

  const reviewResult = useMemo(
    () => selectShiyanReviewResult(content, candidate),
    [candidate, content],
  );

  useEffect(() => {
    onFinalEditorStateChange?.({
      open: finalEditorOpen,
      dirty: finalDraftDirty,
      saving: finalDraftSaving,
    });
  }, [finalDraftDirty, finalDraftSaving, finalEditorOpen, onFinalEditorStateChange]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (allowNavigation.current) return;
      if (!finalDraftDirty && !finalDraftSaving) return;

      event.preventDefault();
      if (finalDraftSaving) {
        Alert.alert('正在保存最终稿', '保存完成后再离开，避免丢失本次修改。');
        return;
      }

      Alert.alert('放弃未保存修改？', '当前最终稿还有未保存的编辑。', [
        { text: '继续编辑', style: 'cancel' },
        {
          text: '放弃修改',
          style: 'destructive',
          onPress: () => {
            allowNavigation.current = true;
            navigation.dispatch(event.data.action);
          },
        },
      ]);
    });
    return unsubscribe;
  }, [finalDraftDirty, finalDraftSaving, navigation]);

  const loadTask = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const result = await shiyanClient.getCaptureTask(taskId);
        setTask(result.task);
        setTaskError('');
      } catch (error) {
        if (!silent) {
          setTaskError(error instanceof Error ? error.message : '无法读取拾言任务。');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [taskId],
  );

  const loadTranscript = useCallback(async () => {
    try {
      const result = await shiyanClient.getTranscript(taskId);
      setTranscript({ status: 'ready', value: result.transcript, message: null });
    } catch (error) {
      if (error instanceof ShiyanClientError && error.code === 'transcript_not_ready') {
        setTranscript((previous) =>
          previous.value
            ? { status: 'ready', value: previous.value, message: null }
            : EMPTY_TRANSCRIPT,
        );
        return;
      }
      setTranscript((previous) => ({
        status: 'error',
        value: previous.value,
        message: error instanceof Error ? error.message : '原文读取失败。',
      }));
    }
  }, [taskId]);

  const loadContent = useCallback(async () => {
    if (finalSaveInFlight.current) return;
    const generation = ++contentGeneration.current;
    try {
      const next = await getShiyanContentDataSource().getTaskContent(taskId);
      if (generation !== contentGeneration.current || finalSaveInFlight.current) return;
      setContent(next);
      setSavedFinalMarkdown(next.finalDraftMarkdown);
      setContentUnavailable(false);
    } catch {
      if (generation === contentGeneration.current && !finalSaveInFlight.current) {
        setContentUnavailable(true);
      }
    }
  }, [taskId]);

  const loadLocalCapture = useCallback(async () => {
    setLocalCapture(await localCaptureRepository.get(taskId));
  }, [taskId]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadTask(), loadTranscript(), loadContent(), loadLocalCapture()]);
  }, [loadContent, loadLocalCapture, loadTask, loadTranscript]);

  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll]),
  );

  const currentStage = useMemo(() => (task ? currentShiyanStage(task) : null), [task]);
  const recoveryNotice = useMemo(
    () => (currentStage ? shiyanStageRecoveryPresentation(currentStage) : null),
    [currentStage],
  );
  const shouldPoll =
    task?.lifecycle === 'active' && currentStage !== null && currentStage.status !== 'failed';

  useEffect(() => {
    if (!shouldPoll) return undefined;
    const timer = setInterval(() => {
      void loadTask(true);
      void loadTranscript();
      void loadContent();
    }, 5000);
    return () => clearInterval(timer);
  }, [loadContent, loadTask, loadTranscript, shouldPoll]);

  useEffect(() => {
    if (task?.lifecycle === 'ready' || task?.lifecycle === 'completed') {
      void loadContent();
    }
  }, [loadContent, task?.lifecycle]);

  const retryStage = async (stage: TaskStage) => {
    const action = retryActionForStage(stage);
    if (action !== 'transcribe' && action !== 'organize') return;
    setBusyAction('retry');
    try {
      if (action === 'transcribe') {
        await shiyanClient.retryStt(taskId);
        await loadTranscript();
      } else {
        await shiyanClient.retryOrganize(taskId);
      }
      await loadTask();
    } catch (error) {
      Alert.alert(
        action === 'transcribe' ? '无法重试转写' : '无法重试整理',
        error instanceof Error ? error.message : '请稍后重试。',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const setRetention = useCallback(
    async (retained: boolean) => {
      setBusyAction('retention');
      try {
        const result = await shiyanClient.setAudioRetention(taskId, retained);
        setRetentionChoice(result.retained);
        Alert.alert(
          result.retained ? '会保留原始录音' : '使用默认清理策略',
          result.retained
            ? '已记录保留选择。'
            : result.deleteAfter
              ? `原始录音预计在 ${new Date(result.deleteAfter).toLocaleString()} 后清理。`
              : '将按默认保留策略处理原始录音。',
        );
      } catch (error) {
        Alert.alert(
          '无法更新录音保留设置',
          error instanceof Error ? error.message : '请稍后重试。',
        );
      } finally {
        setBusyAction(null);
      }
    },
    [taskId],
  );

  const adjustDraft = async () => {
    const instruction = adjustInstruction.trim();
    if (!instruction) return;
    setBusyAction('adjust');
    try {
      const nextCandidate = await getShiyanContentDataSource().adjustAiDraft(taskId, instruction);
      setCandidate(nextCandidate);
      setAdjustInstruction('');
      setAdjustOpen(false);
    } catch (error) {
      Alert.alert('AI 调整暂不可用', error instanceof Error ? error.message : '请稍后重试。');
    } finally {
      setBusyAction(null);
    }
  };

  const openFinalEditor = useCallback((preferCandidate = false) => {
    if (finalEditorOpen) return;
    const seed = selectShiyanFinalEditorSeed(content, candidate, preferCandidate);
    setFinalMarkdown(seed.markdown);
    setEditorBaselineMarkdown(seed.markdown);
    setFinalBaseVersion(seed.baseVersion);
    setFinalEditorOpen(true);
  }, [candidate, content, finalEditorOpen]);

  const closeFinalEditor = () => {
    if (!finalDraftDirty) {
      setFinalEditorOpen(false);
      return;
    }
    Alert.alert('放弃未保存修改？', '关闭编辑后，本次未保存修改会丢失。', [
      { text: '继续编辑', style: 'cancel' },
      {
        text: '放弃修改',
        style: 'destructive',
        onPress: () => {
          setFinalMarkdown(editorBaselineMarkdown);
          setFinalEditorOpen(false);
        },
      },
    ]);
  };

  const saveFinalDraft = async () => {
    const markdown = finalMarkdown.trim();
    if (!markdown) {
      Alert.alert('最终稿不能为空', '请先完成内容编辑。');
      return;
    }
    finalSaveInFlight.current = true;
    contentGeneration.current += 1;
    setBusyAction('save-final');
    try {
      const next = await getShiyanContentDataSource().saveFinalDraft(taskId, markdown, {
        ...(task?.title ? { title: task.title } : {}),
        ...(finalBaseVersion ? { baseVersion: finalBaseVersion } : {}),
      });
      const saved = next.finalDraftMarkdown ?? markdown;
      setContent(next);
      setSavedFinalMarkdown(saved);
      setFinalMarkdown(saved);
      setEditorBaselineMarkdown(saved);
      setFinalBaseVersion(next.finalDraftBaseVersion);
      setCandidate(null);
      setContentUnavailable(false);
      Alert.alert('最终稿已保存', '新的 AI 调整只会生成候选，不会覆盖这份内容。');
    } catch (error) {
      Alert.alert('无法保存最终稿', error instanceof Error ? error.message : '请稍后重试。');
    } finally {
      finalSaveInFlight.current = false;
      setBusyAction(null);
    }
  };

  const shareFinalDraft = useCallback(async () => {
    if (!savedFinalMarkdown || !task) return;
    if (shareBlocked) {
      Alert.alert('请先保存最终稿', '保存当前修改后再分享，避免发送旧版本。');
      return;
    }
    try {
      await Share.share({
        title: task.title,
        message: `# ${task.title}\n\n${savedFinalMarkdown}`,
      });
    } catch {
      Alert.alert('分享失败', '暂时无法打开系统分享。');
    }
  }, [savedFinalMarkdown, shareBlocked, task]);

  const moreItems = useMemo<readonly ShiyanActionSheetItem[]>(() => {
    const items: ShiyanActionSheetItem[] = [];
    if (savedFinalMarkdown) {
      items.push({
        key: 'share',
        label: '分享最终稿',
        supportingText: shareBlocked ? '请先保存当前修改' : '使用系统分享发送当前已保存内容',
        icon: <Share2 size={19} color={colors.text.ink} />,
        disabled: shareBlocked,
        onPress: () => void shareFinalDraft(),
      });
    }
    if (deliveryActions?.available) {
      if (deliveryActions.succeeded) {
        items.push({
          key: 'open-delivery',
          label: '打开已投递文档',
          supportingText: deliveryActions.statusText,
          icon: <ExternalLink size={19} color={colors.text.ink} />,
          disabled: deliveryActions.blocked || deliveryActions.busy,
          onPress: deliveryActions.onOpenDelivery,
        });
      } else {
        items.push({
          key: 'deliver',
          label: deliveryActions.failed ? '重新投递 GitHub' : '投递到 GitHub',
          supportingText: deliveryActions.statusText,
          icon: deliveryActions.failed ? (
            <RefreshCw size={19} color={colors.text.ink} />
          ) : (
            <Upload size={19} color={colors.text.ink} />
          ),
          disabled: deliveryActions.blocked || deliveryActions.busy,
          onPress: deliveryActions.onDeliver,
        });
      }
    }
    items.push(
      {
        key: 'retain-audio',
        label: '保留原始录音',
        supportingText: '覆盖默认临时清理策略',
        icon: <Volume2 size={19} color={colors.text.ink} />,
        disabled: busyAction === 'retention',
        selected: retentionChoice === true,
        onPress: () => void setRetention(true),
      },
      {
        key: 'default-retention',
        label: '使用默认清理策略',
        supportingText: '恢复默认的临时录音保留方式',
        icon: <Volume2 size={19} color={colors.text.soft} />,
        disabled: busyAction === 'retention',
        selected: retentionChoice === false,
        onPress: () => void setRetention(false),
      },
      {
        key: 'processing-details',
        label: '处理详情',
        supportingText: '查看各处理阶段、失败原因和重试入口',
        icon: <FileText size={19} color={colors.text.ink} />,
        onPress: () => setProcessingOpen(true),
      },
      {
        key: 'refresh',
        label: '刷新',
        supportingText: '重新读取任务、原文与整理稿',
        icon: <RefreshCw size={19} color={colors.text.ink} />,
        onPress: () => void refreshAll(),
      },
    );
    return items;
  }, [
    busyAction,
    colors.text.ink,
    colors.text.soft,
    deliveryActions,
    refreshAll,
    retentionChoice,
    savedFinalMarkdown,
    setRetention,
    shareBlocked,
    shareFinalDraft,
  ]);

  const editItems = useMemo<readonly ShiyanActionSheetItem[]>(
    () => [
      {
        key: 'manual-edit',
        label: '手动编辑',
        supportingText: '进入现有最终稿编辑并在保存后更新正文',
        icon: <FileText size={19} color={colors.text.ink} />,
        onPress: () => openFinalEditor(false),
      },
      {
        key: 'ai-adjust',
        label: 'AI 调整',
        supportingText: '生成候选内容，不会自动覆盖最终稿',
        icon: <Sparkles size={19} color={colors.primary} />,
        disabled: !content?.aiDraftMarkdown || busyAction === 'adjust',
        onPress: () => setAdjustOpen(true),
      },
    ],
    [busyAction, colors.primary, colors.text.ink, content?.aiDraftMarkdown, openFinalEditor],
  );

  const sceneName = task
    ? localCapture?.sceneName ?? shiyanSceneNameForId(task.sceneId) ?? task.sceneId
    : '';
  const processingComplete = task
    ? task.stages.every((stage) => stage.status === 'succeeded' || stage.status === 'skipped')
    : false;

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
        <Text style={[styles.headerTitle, { color: colors.text.ink }]} numberOfLines={1}>
          {task?.title ?? '拾言任务'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="更多操作"
          onPress={() => setMoreOpen(true)}
          style={styles.headerButton}
        >
          <MoreHorizontal size={22} color={colors.text.ink} />
        </Pressable>
      </View>

      {loading && !task ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.muted, { color: colors.text.soft }]}>正在读取任务…</Text>
        </View>
      ) : taskError && !task ? (
        <View style={styles.centerState}>
          <FileText size={34} color={colors.text.soft} />
          <Text style={[styles.stateTitle, { color: colors.text.ink }]}>任务读取失败</Text>
          <Text style={[styles.muted, { color: colors.text.soft }]}>{taskError}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void refreshAll()}
            style={[styles.outlineButton, { borderColor: colors.border.default }]}
          >
            <Text style={[styles.buttonText, { color: colors.primary }]}>重新加载</Text>
          </Pressable>
        </View>
      ) : task ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.lightStatusRow}>
            <Text
              style={[
                styles.lightStatus,
                { color: currentStage?.status === 'failed' ? colors.status.error : colors.text.base },
              ]}
            >
              {shiyanTaskStatusText(task)}
            </Text>
            <Text style={[styles.statusDot, { color: colors.text.soft }]}>·</Text>
            <Text style={[styles.muted, { color: colors.text.soft }]}>
              {new Date(task.createdAt).toLocaleString()}
            </Text>
          </View>

          {localCapture?.filePath ? (
            <AudioPlayer
              source={localCapture.filePath}
              fallbackDurationMs={localCapture.durationMs}
              detailText="原始录音"
            />
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={() => setProcessingOpen((value) => !value)}
            style={[styles.processingSummary, { borderColor: colors.border.default }]}
          >
            <View style={styles.processingCopy}>
              <Text style={[styles.sectionTitle, { color: colors.text.ink }]}>处理进度</Text>
              <Text style={[styles.muted, { color: processingComplete ? colors.text.soft : colors.primary }]}>
                {processingComplete ? '这条记录已经完成处理' : shiyanTaskStatusText(task)}
              </Text>
            </View>
            {processingOpen ? <ChevronUp size={18} color={colors.text.soft} /> : <ChevronDown size={18} color={colors.text.soft} />}
          </Pressable>

          {processingOpen ? (
            <View style={styles.stepper}>
              {task.stages.map((stage, index) => {
                const failed = stage.status === 'failed';
                const completed = stage.status === 'succeeded' || stage.status === 'skipped';
                const current = stage.status === 'running';
                const retryAction = retryActionForStage(stage);
                return (
                  <View key={stage.stage} style={styles.stepItem}>
                    <View style={styles.stepRail}>
                      <View style={[styles.stepDot, { backgroundColor: failed ? colors.status.error : completed ? colors.primary : current ? colors.primary : colors.border.default }]} />
                      {index < task.stages.length - 1 ? <View style={[styles.stepLine, { backgroundColor: completed ? colors.primary : colors.border.default }]} /> : null}
                    </View>
                    <View style={styles.stepBody}>
                      <Text style={[styles.stageTitle, { color: failed ? colors.status.error : colors.text.ink }]}>{shiyanStageLabel(stage.stage)}</Text>
                      <Text style={[styles.muted, { color: failed ? colors.status.error : current ? colors.primary : colors.text.soft }]}>
                        {shiyanStageStatusLabel(stage.status)}{stage.retryCount > 0 ? ` · 已重试 ${stage.retryCount} 次` : ''}
                      </Text>
                      {failed && stageFailureText(stage) ? <Text style={[styles.failureText, { color: colors.status.error }]}>{stageFailureText(stage)}</Text> : null}
                      {retryAction === 'transcribe' || retryAction === 'organize' ? (
                        <Pressable accessibilityRole="button" disabled={busyAction === 'retry'} onPress={() => void retryStage(stage)} style={styles.compactButton}>
                          <Text style={[styles.buttonText, { color: colors.primary }]}>{retryAction === 'transcribe' ? '重试转写' : '重试整理'}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          <View style={[styles.sceneRow, { borderColor: colors.border.default }]}>
            <Text style={[styles.muted, { color: colors.text.soft }]}>分类</Text>
            <View style={styles.sceneValue}>
              <Text style={[styles.buttonText, { color: colors.text.ink }]}>{sceneName}</Text>
            </View>
          </View>

          {recoveryNotice ? (
            <ShiyanStageRecoveryNotice
              recovery={recoveryNotice}
              busy={busyAction === 'retry'}
              onRetry={
                currentStage &&
                (recoveryNotice.retryAction === 'transcribe' ||
                  recoveryNotice.retryAction === 'organize')
                  ? () => void retryStage(currentStage)
                  : undefined
              }
              onOpenDetails={() => setProcessingOpen(true)}
            />
          ) : null}

          <View style={[styles.tabBar, { borderBottomColor: colors.border.default }]}>
            {(['organized', 'transcript'] as const).map((tab) => (
              <Pressable key={tab} onPress={() => setContentTab(tab)} style={[styles.tab, contentTab === tab && { borderBottomColor: colors.primary }]}>
                <Text style={[styles.tabText, { color: contentTab === tab ? colors.primary : colors.text.soft }]}>{tab === 'organized' ? '整理稿' : '原文'}</Text>
              </Pressable>
            ))}
          </View>

          {contentTab === 'organized' && reviewResult ? (
            <View
              style={[
                styles.resultCard,
                { backgroundColor: colors.bg.card, borderColor: colors.border.default },
              ]}
            >
              <Text selectable style={[styles.resultText, { color: colors.text.base }]}>
                {reviewResult.markdown}
              </Text>
              <Text style={[styles.resultMeta, { color: colors.text.soft }]}>
                {reviewResult.supportingText}
              </Text>
            </View>
          ) : contentTab === 'organized' ? (
            <View
              style={[
                styles.pendingResult,
                { backgroundColor: colors.bg.card, borderColor: colors.border.default },
              ]}
            >
              <Text style={[styles.stageTitle, { color: colors.text.ink }]}>整理稿尚未生成</Text>
              <Text style={[styles.muted, { color: colors.text.soft }]}>
                {contentUnavailable
                  ? '整理内容暂时读取失败；已有原文和任务状态仍可继续查看。'
                  : '处理完成后会在这里显示整理结果。'}
              </Text>
            </View>
          ) : null}


          {adjustOpen ? (
            <View
              style={[
                styles.inlinePanel,
                { backgroundColor: colors.bg.card, borderColor: colors.border.default },
              ]}
            >
              <View style={styles.inlinePanelHeader}>
                <View style={styles.candidateTitleRow}>
                  <Sparkles size={16} color={colors.primary} />
                  <Text style={[styles.stageTitle, { color: colors.text.ink }]}>调整整理稿</Text>
                </View>
                <Pressable accessibilityRole="button" onPress={() => setAdjustOpen(false)}>
                  <Text style={[styles.buttonText, { color: colors.text.soft }]}>收起</Text>
                </Pressable>
              </View>
              <TextInput
                value={adjustInstruction}
                onChangeText={setAdjustInstruction}
                multiline
                placeholder="例如：更短一些；把风险放前面"
                placeholderTextColor={colors.text.soft}
                style={[
                  styles.input,
                  {
                    color: colors.text.ink,
                    backgroundColor: colors.bg.canvas,
                    borderColor: colors.border.default,
                  },
                ]}
              />
              <Pressable
                accessibilityRole="button"
                disabled={!adjustInstruction.trim() || busyAction === 'adjust'}
                onPress={() => void adjustDraft()}
                style={({ pressed }) => [
                  styles.secondaryAction,
                  {
                    borderColor: colors.border.default,
                    backgroundColor: pressed ? colors.bg.soft : colors.bg.card,
                    opacity: !adjustInstruction.trim() || busyAction === 'adjust' ? 0.55 : 1,
                  },
                ]}
              >
                <Sparkles size={17} color={colors.primary} />
                <Text style={[styles.buttonText, { color: colors.primary }]}>
                  {busyAction === 'adjust' ? '正在调整' : '生成候选'}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {savedFinalMarkdown && candidate ? (
            <View style={[styles.candidateBox, { backgroundColor: colors.bg.soft }]}>
              <View style={styles.candidateTitleRow}>
                <Sparkles size={16} color={colors.primary} />
                <Text style={[styles.stageTitle, { color: colors.text.ink }]}>新的 AI 调整候选</Text>
              </View>
              <Text selectable style={[styles.readonlyText, { color: colors.text.base }]}>
                {candidate.markdown}
              </Text>
              <Text style={[styles.muted, { color: colors.text.soft }]}>
                当前最终稿没有被替换。只有你明确进入编辑并保存后才会更新。
              </Text>
              {!finalEditorOpen ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => openFinalEditor(true)}
                  style={styles.compactButton}
                >
                  <Text style={[styles.buttonText, { color: colors.primary }]}>用候选继续编辑</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {finalEditorOpen ? (
            <View
              style={[
                styles.editorPanel,
                { backgroundColor: colors.bg.card, borderColor: colors.border.default },
              ]}
            >
              <View style={styles.sectionHeaderRow}>
                <View>
                  <Text style={[styles.sectionTitle, { color: colors.text.ink }]}>最终编辑</Text>
                  <Text style={[styles.muted, { color: colors.text.soft }]}>保存后立即成为当前最终稿</Text>
                </View>
                <Pressable accessibilityRole="button" onPress={closeFinalEditor} style={styles.compactButton}>
                  <Text style={[styles.buttonText, { color: colors.text.soft }]}>关闭</Text>
                </Pressable>
              </View>
              <TextInput
                value={finalMarkdown}
                onChangeText={setFinalMarkdown}
                multiline
                textAlignVertical="top"
                placeholder="在这里完成最终人工编辑"
                placeholderTextColor={colors.text.soft}
                style={[
                  styles.finalInput,
                  {
                    color: colors.text.ink,
                    backgroundColor: colors.bg.canvas,
                    borderColor: colors.border.default,
                  },
                ]}
              />
              <Pressable
                accessibilityRole="button"
                disabled={finalDraftSaving}
                onPress={() => void saveFinalDraft()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: pressed ? colors.primaryActive : colors.primary,
                    opacity: finalDraftSaving ? 0.6 : 1,
                  },
                ]}
              >
                <Text style={[styles.buttonText, { color: colors.onPrimary }]}>
                  {finalDraftSaving ? '正在保存' : '保存最终稿'}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {contentTab === 'transcript' ? (
            transcript.status === 'error' ? (
              <View
                style={[
                  styles.errorBox,
                  { borderColor: colors.status.error, backgroundColor: colors.bg.card },
                ]}
              >
                <Text style={[styles.stageTitle, { color: colors.status.error }]}>原文读取失败</Text>
                <Text style={[styles.muted, { color: colors.text.base }]}>{transcript.message}</Text>
                {transcript.value ? (
                  <Text selectable style={[styles.readonlyText, { color: colors.text.base }]}>
                    {transcript.value.text}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void loadTranscript()}
                  style={[styles.smallButton, { backgroundColor: colors.bg.soft }]}
                >
                  <Text style={[styles.buttonText, { color: colors.primary }]}>重试读取</Text>
                </Pressable>
              </View>
            ) : (
              <View
                style={[
                  styles.readonlyBox,
                  { backgroundColor: colors.bg.card, borderColor: colors.border.default },
                ]}
              >
                <Text selectable style={[styles.readonlyText, { color: colors.text.base }]}>
                  {transcript.status === 'ready' ? transcript.value.text : '原文尚未生成。'}
                </Text>
              </View>
            )
          ) : null}

          {reviewResult && !finalEditorOpen ? (
            <Pressable accessibilityRole="button" onPress={() => setEditActionsOpen(true)} style={styles.editEntry}>
              <Text style={[styles.buttonText, { color: colors.primary }]}>编辑</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : null}

      <ShiyanActionSheet
        visible={moreOpen}
        title="更多操作"
        items={moreItems}
        onClose={() => setMoreOpen(false)}
      />
      <ShiyanActionSheet
        visible={editActionsOpen}
        title="选择编辑方式"
        items={editItems}
        onClose={() => setEditActionsOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  headerButton: {
    width: sizing.iconButton,
    height: sizing.iconButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.titleMd,
    fontWeight: '600',
  },
  content: { padding: spacing.lg, paddingBottom: spacing.section, gap: spacing.md },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  stateTitle: { fontSize: fontSize.titleMd, fontWeight: '600' },
  muted: { fontSize: fontSize.caption, lineHeight: 19 },
  buttonText: { fontSize: fontSize.button, fontWeight: '600' },
  lightStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  lightStatus: { fontSize: fontSize.caption, fontWeight: '600' },
  processingSummary: {
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  processingCopy: { flex: 1, gap: 2 },
  stepper: { gap: spacing.sm },
  stepItem: { flexDirection: 'row', minHeight: 58 },
  stepRail: { width: 24, alignItems: 'center' },
  stepDot: { width: 10, height: 10, borderRadius: radius.full, marginTop: 4 },
  stepLine: { width: 2, flex: 1, marginVertical: 3 },
  stepBody: { flex: 1, gap: 2, paddingBottom: spacing.sm },
  sceneRow: {
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sceneValue: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  tabBar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontSize: fontSize.button, fontWeight: '600' },
  editEntry: { alignSelf: 'flex-end', paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  statusDot: { fontSize: fontSize.caption },
  resultTitle: { fontSize: fontSize.titleLg, fontWeight: '700' },
  resultBadge: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  resultBadgeText: { fontSize: fontSize.captionUppercase, fontWeight: '700' },
  resultCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  resultText: { fontSize: fontSize.md, lineHeight: 24 },
  resultMeta: { fontSize: fontSize.captionUppercase, lineHeight: 18 },
  pendingResult: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  resultActions: { flexDirection: 'row', gap: spacing.sm },
  secondaryAction: {
    minHeight: sizing.touchTarget,
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  primaryAction: {
    minHeight: sizing.touchTarget,
    flex: 1,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  sectionTitle: { fontSize: fontSize.bodyMd, fontWeight: '700' },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stageList: { gap: spacing.sm },
  stageRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  stageMain: { flex: 1, gap: spacing.xs },
  stageTitle: { fontSize: fontSize.button, fontWeight: '600' },
  failureText: { fontSize: fontSize.caption, lineHeight: 19 },
  smallButton: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  compactButton: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  readonlyBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorBox: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  readonlyText: { fontSize: fontSize.button, lineHeight: 22 },
  candidateBox: { borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  candidateTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  inlinePanel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  inlinePanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  input: {
    minHeight: 76,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.button,
    lineHeight: 21,
    textAlignVertical: 'top',
  },
  editorPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  finalInput: {
    minHeight: 240,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.button,
    lineHeight: 22,
  },
  outlineButton: {
    minHeight: sizing.touchTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  disclosureRow: {
    minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  disclosureCopy: { flex: 1, gap: 2 },
  disclosureTitle: { fontSize: fontSize.md, fontWeight: '600' },
});
