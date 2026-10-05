import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { shiyanClient, ShiyanClientError } from './client/ShiyanClient';
import type {
  ShiyanAdjustmentCandidate,
  ShiyanAudioRetentionView,
  ShiyanCaptureStageView,
  ShiyanCaptureTaskView,
  ShiyanTaskContentView,
  ShiyanTaskResult,
  ShiyanTranscriptResult,
} from './client/contracts';
import { getShiyanContentDataSource } from './content';
import {
  localCaptureRepository,
  type LocalCaptureMetadata,
} from './recording/localCaptureRepository';
import { selectShiyanFinalEditorSeed } from './taskReviewPresentation';
import { currentShiyanStage } from './taskPresentation';
import {
  EMPTY_SHIYAN_TRANSCRIPT,
  buildShiyanFinalDraftSaveInput,
  resolveShiyanStageRetryTarget,
  shouldPollShiyanTask,
  shiyanTranscriptFailure,
  shiyanTranscriptNotReady,
  shiyanTranscriptReady,
  type ShiyanTaskTranscriptState,
} from './taskDetailOrchestration';

/**
 * Every effect the task-detail orchestration needs, injected so the async
 * lifecycle, generation guards and mutation semantics can be exercised without
 * React Native, the Shiyan Cloud client or the device repositories.
 */
export interface ShiyanTaskDetailOrchestrationDeps {
  getCaptureTask(taskId: string): Promise<ShiyanTaskResult>;
  getTranscript(taskId: string): Promise<ShiyanTranscriptResult>;
  retryStt(taskId: string): Promise<unknown>;
  retryOrganize(taskId: string): Promise<unknown>;
  setAudioRetention(taskId: string, retained: boolean): Promise<ShiyanAudioRetentionView>;
  getTaskContent(taskId: string): Promise<ShiyanTaskContentView>;
  adjustAiDraft(taskId: string, instruction: string): Promise<ShiyanAdjustmentCandidate>;
  saveFinalDraft(
    taskId: string,
    markdown: string,
    options?: { title?: string; baseVersion?: number },
  ): Promise<ShiyanTaskContentView>;
  getLocalCapture(taskId: string): Promise<LocalCaptureMetadata | null>;
  /** Domain feedback for the mutation lifecycle; defaults to a native alert. */
  notify(title: string, message: string): void;
}

// Singletons are resolved at call time (not captured) so tests can spy on or
// replace them after module import, matching the bootstrap/session conventions.
const createDefaultDeps = (): ShiyanTaskDetailOrchestrationDeps => ({
  getCaptureTask: (taskId) => shiyanClient.getCaptureTask(taskId),
  getTranscript: (taskId) => shiyanClient.getTranscript(taskId),
  retryStt: (taskId) => shiyanClient.retryStt(taskId),
  retryOrganize: (taskId) => shiyanClient.retryOrganize(taskId),
  setAudioRetention: (taskId, retained) => shiyanClient.setAudioRetention(taskId, retained),
  getTaskContent: (taskId) => getShiyanContentDataSource().getTaskContent(taskId),
  adjustAiDraft: (taskId, instruction) =>
    getShiyanContentDataSource().adjustAiDraft(taskId, instruction),
  saveFinalDraft: (taskId, markdown, options) =>
    getShiyanContentDataSource().saveFinalDraft(taskId, markdown, options),
  getLocalCapture: (taskId) => localCaptureRepository.get(taskId),
  notify: (title, message) => Alert.alert(title, message),
});

export interface ShiyanTaskDetailOrchestration {
  task: ShiyanCaptureTaskView | null;
  taskError: string;
  loading: boolean;
  transcript: ShiyanTaskTranscriptState;
  content: ShiyanTaskContentView | null;
  contentUnavailable: boolean;
  localCapture: LocalCaptureMetadata | null;
  candidate: ShiyanAdjustmentCandidate | null;
  retentionChoice: boolean | null;
  busyAction: string | null;

  finalEditorOpen: boolean;
  finalMarkdown: string;
  finalDraftDirty: boolean;
  finalDraftSaving: boolean;
  savedFinalMarkdown: string | null;

  refreshAll: () => Promise<void>;
  loadTranscript: () => Promise<void>;
  retryStage: (stage: ShiyanCaptureStageView) => Promise<void>;
  setRetention: (retained: boolean) => Promise<void>;
  /** Returns true when a candidate was produced so the screen can close its input. */
  adjustDraft: (instruction: string) => Promise<boolean>;

  setFinalMarkdown: (markdown: string) => void;
  openFinalEditor: (preferCandidate?: boolean) => void;
  closeFinalEditor: () => void;
  discardFinalEditor: () => void;
  saveFinalDraft: () => Promise<void>;
}

/**
 * Owns the Shiyan task-detail orchestration: task/transcript/content/local
 * capture loading, refresh and polling, stage retry, AI adjustment, audio
 * retention and the Final Draft editor state (seed, dirty, save-in-flight and
 * base version). The screen keeps only rendering, visual mapping, event binding
 * and navigation.
 *
 * Stale-async protection is preserved exactly: content reads carry a generation
 * that a Final Draft save invalidates, and a content read never commits while a
 * save is in flight. AI adjustment only ever produces a candidate and never
 * replaces the saved Final Draft.
 */
export const useShiyanTaskDetailOrchestration = (
  taskId: string,
  deps?: ShiyanTaskDetailOrchestrationDeps,
): ShiyanTaskDetailOrchestration => {
  const [task, setTask] = useState<ShiyanCaptureTaskView | null>(null);
  const [taskError, setTaskError] = useState('');
  const [loading, setLoading] = useState(true);
  const [transcript, setTranscript] = useState<ShiyanTaskTranscriptState>(EMPTY_SHIYAN_TRANSCRIPT);
  const [content, setContent] = useState<ShiyanTaskContentView | null>(null);
  const [contentUnavailable, setContentUnavailable] = useState(false);
  const [candidate, setCandidate] = useState<ShiyanAdjustmentCandidate | null>(null);
  const [finalEditorOpen, setFinalEditorOpen] = useState(false);
  const [finalMarkdown, setFinalMarkdown] = useState('');
  const [editorBaselineMarkdown, setEditorBaselineMarkdown] = useState('');
  const [finalBaseVersion, setFinalBaseVersion] = useState<number | null>(null);
  const [savedFinalMarkdown, setSavedFinalMarkdown] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [retentionChoice, setRetentionChoice] = useState<boolean | null>(null);
  const [localCapture, setLocalCapture] = useState<LocalCaptureMetadata | null>(null);
  const taskGeneration = useRef(0);
  const activeTaskLoads = useRef(0);
  const contentGeneration = useRef(0);
  const finalSaveInFlight = useRef(false);

  // Keep the latest deps in a ref so the async callbacks stay stable across
  // renders while still reading the caller's current injected deps. Default
  // deps resolve the singletons once, not on every render.
  const resolvedDeps = useMemo(() => deps ?? createDefaultDeps(), [deps]);
  const depsRef = useRef(resolvedDeps);
  depsRef.current = resolvedDeps;

  const finalDraftDirty = useMemo(
    () => finalEditorOpen && finalMarkdown.trim() !== editorBaselineMarkdown.trim(),
    [editorBaselineMarkdown, finalEditorOpen, finalMarkdown],
  );
  const finalDraftSaving = busyAction === 'save-final';

  const loadTask = useCallback(async (silent = false) => {
    const generation = ++taskGeneration.current;
    if (!silent) {
      activeTaskLoads.current += 1;
      setLoading(true);
    }
    try {
      const result = await depsRef.current.getCaptureTask(taskId);
      if (generation !== taskGeneration.current) return;
      setTask(result.task);
      setTaskError('');
    } catch (error) {
      if (generation !== taskGeneration.current) return;
      if (!silent) {
        setTaskError(error instanceof Error ? error.message : '无法读取拾言任务。');
      }
    } finally {
      if (!silent) {
        activeTaskLoads.current = Math.max(0, activeTaskLoads.current - 1);
        if (activeTaskLoads.current === 0) setLoading(false);
      }
    }
  }, [taskId]);

  const loadTranscript = useCallback(async () => {
    try {
      const result = await depsRef.current.getTranscript(taskId);
      setTranscript(shiyanTranscriptReady(result.transcript));
    } catch (error) {
      if (error instanceof ShiyanClientError && error.code === 'transcript_not_ready') {
        setTranscript((previous) => shiyanTranscriptNotReady(previous));
        return;
      }
      setTranscript((previous) =>
        shiyanTranscriptFailure(
          previous,
          error instanceof Error ? error.message : '原文读取失败。',
        ),
      );
    }
  }, [taskId]);

  const loadContent = useCallback(async () => {
    if (finalSaveInFlight.current) return;
    const generation = ++contentGeneration.current;
    try {
      const next = await depsRef.current.getTaskContent(taskId);
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
    setLocalCapture(await depsRef.current.getLocalCapture(taskId));
  }, [taskId]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadTask(), loadTranscript(), loadContent(), loadLocalCapture()]);
  }, [loadContent, loadLocalCapture, loadTask, loadTranscript]);

  const currentStage = useMemo(() => (task ? currentShiyanStage(task) : null), [task]);
  const shouldPoll = shouldPollShiyanTask(task, currentStage);

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

  const retryStage = useCallback(
    async (stage: ShiyanCaptureStageView) => {
      const action = resolveShiyanStageRetryTarget(stage);
      if (!action) return;
      setBusyAction('retry');
      try {
        if (action === 'transcribe') {
          await depsRef.current.retryStt(taskId);
          await loadTranscript();
        } else {
          await depsRef.current.retryOrganize(taskId);
        }
        await loadTask();
      } catch (error) {
        depsRef.current.notify(
          action === 'transcribe' ? '无法重试转写' : '无法重试整理',
          error instanceof Error ? error.message : '请稍后重试。',
        );
      } finally {
        setBusyAction(null);
      }
    },
    [loadTask, loadTranscript, taskId],
  );

  const setRetention = useCallback(
    async (retained: boolean) => {
      setBusyAction('retention');
      try {
        const result = await depsRef.current.setAudioRetention(taskId, retained);
        setRetentionChoice(result.retained);
        depsRef.current.notify(
          result.retained ? '会保留原始录音' : '使用默认清理策略',
          result.retained
            ? '已记录保留选择。'
            : result.deleteAfter
              ? `原始录音预计在 ${new Date(result.deleteAfter).toLocaleString()} 后清理。`
              : '将按默认保留策略处理原始录音。',
        );
      } catch (error) {
        depsRef.current.notify(
          '无法更新录音保留设置',
          error instanceof Error ? error.message : '请稍后重试。',
        );
      } finally {
        setBusyAction(null);
      }
    },
    [taskId],
  );

  const adjustDraft = useCallback(
    async (instruction: string): Promise<boolean> => {
      const trimmed = instruction.trim();
      if (!trimmed) return false;
      setBusyAction('adjust');
      try {
        const nextCandidate = await depsRef.current.adjustAiDraft(taskId, trimmed);
        setCandidate(nextCandidate);
        return true;
      } catch (error) {
        depsRef.current.notify(
          'AI 调整暂不可用',
          error instanceof Error ? error.message : '请稍后重试。',
        );
        return false;
      } finally {
        setBusyAction(null);
      }
    },
    [taskId],
  );

  const openFinalEditor = useCallback(
    (preferCandidate = false) => {
      if (finalEditorOpen) return;
      const seed = selectShiyanFinalEditorSeed(content, candidate, preferCandidate);
      setFinalMarkdown(seed.markdown);
      setEditorBaselineMarkdown(seed.markdown);
      setFinalBaseVersion(seed.baseVersion);
      setFinalEditorOpen(true);
    },
    [candidate, content, finalEditorOpen],
  );

  const closeFinalEditor = useCallback(() => {
    setFinalEditorOpen(false);
  }, []);

  const discardFinalEditor = useCallback(() => {
    setFinalMarkdown(editorBaselineMarkdown);
    setFinalEditorOpen(false);
  }, [editorBaselineMarkdown]);

  const saveFinalDraft = useCallback(async () => {
    const markdown = finalMarkdown.trim();
    if (!markdown) {
      depsRef.current.notify('最终稿不能为空', '请先完成内容编辑。');
      return;
    }
    finalSaveInFlight.current = true;
    contentGeneration.current += 1;
    setBusyAction('save-final');
    try {
      const next = await depsRef.current.saveFinalDraft(
        taskId,
        markdown,
        buildShiyanFinalDraftSaveInput(task, finalBaseVersion),
      );
      const saved = next.finalDraftMarkdown ?? markdown;
      setContent(next);
      setSavedFinalMarkdown(saved);
      setFinalMarkdown(saved);
      setEditorBaselineMarkdown(saved);
      setFinalBaseVersion(next.finalDraftBaseVersion);
      setCandidate(null);
      setContentUnavailable(false);
      depsRef.current.notify('最终稿已保存', '新的 AI 调整只会生成候选，不会覆盖这份内容。');
    } catch (error) {
      depsRef.current.notify(
        '无法保存最终稿',
        error instanceof Error ? error.message : '请稍后重试。',
      );
    } finally {
      finalSaveInFlight.current = false;
      setBusyAction(null);
    }
  }, [finalBaseVersion, finalMarkdown, task, taskId]);

  return {
    task,
    taskError,
    loading,
    transcript,
    content,
    contentUnavailable,
    localCapture,
    candidate,
    retentionChoice,
    busyAction,
    finalEditorOpen,
    finalMarkdown,
    finalDraftDirty,
    finalDraftSaving,
    savedFinalMarkdown,
    refreshAll,
    loadTranscript,
    retryStage,
    setRetention,
    adjustDraft,
    setFinalMarkdown,
    openFinalEditor,
    closeFinalEditor,
    discardFinalEditor,
    saveFinalDraft,
  };
};
