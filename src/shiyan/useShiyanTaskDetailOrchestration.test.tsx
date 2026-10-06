import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ShiyanClientError } from './client/ShiyanClient';
import type {
  ShiyanAdjustmentCandidate,
  ShiyanCaptureStageView,
  ShiyanCaptureTaskView,
  ShiyanTaskContentView,
  ShiyanTranscriptView,
} from './client/contracts';
import {
  useShiyanTaskDetailOrchestration,
  type ShiyanTaskDetailOrchestration,
  type ShiyanTaskDetailOrchestrationDeps,
} from './useShiyanTaskDetailOrchestration';

type Deps = ShiyanTaskDetailOrchestrationDeps;

const mock = (fn: unknown): jest.Mock => fn as jest.Mock;

const flush = async (rounds = 8): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
};

const stage = (
  overrides: Partial<ShiyanCaptureStageView> = {},
): ShiyanCaptureStageView => ({
  stage: 'review',
  status: 'succeeded',
  retryable: false,
  retryCount: 0,
  errorCode: null,
  errorMessage: null,
  startedAt: null,
  finishedAt: null,
  updatedAt: '2026-10-05T00:00:00.000Z',
  ...overrides,
});

const makeTask = (
  overrides: Partial<ShiyanCaptureTaskView> = {},
): ShiyanCaptureTaskView => ({
  id: 'task-1',
  deviceId: 'device-1',
  userId: null,
  title: '拾言任务',
  sceneId: 'meeting',
  lifecycle: 'ready',
  currentStage: 'review',
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
  stages: [stage()],
  ...overrides,
});

const makeTranscript = (): ShiyanTranscriptView => ({
  id: 'transcript-1',
  taskId: 'task-1',
  sourceAssetId: 'asset-1',
  text: '原文内容',
  language: 'zh',
  durationMs: 1000,
  segments: [],
  provider: 'provider',
  model: 'model',
  providerRequestId: null,
  providerMetadata: {},
  createdAt: '2026-10-05T00:00:00.000Z',
});

const makeContent = (
  overrides: Partial<ShiyanTaskContentView> = {},
): ShiyanTaskContentView => ({
  aiDraftMarkdown: 'AI draft',
  aiDraftVersion: 3,
  finalDraftMarkdown: null,
  finalDraftBaseVersion: null,
  canonicalDestinationUrl: null,
  ...overrides,
});

const makeCandidate = (
  overrides: Partial<ShiyanAdjustmentCandidate> = {},
): ShiyanAdjustmentCandidate => ({
  markdown: '候选内容',
  version: 5,
  createdAt: '2026-10-05T00:00:00.000Z',
  ...overrides,
});

const makeDeps = (overrides: Partial<Deps> = {}): Deps => {
  const deps: Deps = {
    getCaptureTask: jest.fn(),
    getTranscript: jest.fn(),
    retryStt: jest.fn(),
    retryOrganize: jest.fn(),
    setAudioRetention: jest.fn(),
    getTaskContent: jest.fn(),
    adjustAiDraft: jest.fn(),
    saveFinalDraft: jest.fn(),
    getLocalCapture: jest.fn(),
    notify: jest.fn(),
  };
  mock(deps.getCaptureTask).mockResolvedValue({ task: makeTask() });
  mock(deps.getTranscript).mockResolvedValue({ transcript: makeTranscript() });
  mock(deps.retryStt).mockResolvedValue({
    taskId: 'task-1',
    stage: 'transcribe',
    retryCount: 1,
  });
  mock(deps.retryOrganize).mockResolvedValue({
    taskId: 'task-1',
    stage: 'organize',
    retryCount: 1,
  });
  mock(deps.setAudioRetention).mockImplementation(
    async (_taskId: string, retained: boolean) => ({
      assetId: 'asset-1',
      retained,
      deleteAfter: null,
      deletedAt: null,
    }),
  );
  mock(deps.getTaskContent).mockResolvedValue(makeContent());
  mock(deps.adjustAiDraft).mockResolvedValue(makeCandidate());
  mock(deps.saveFinalDraft).mockImplementation(
    async (
      _taskId: string,
      markdown: string,
      options?: { title?: string; baseVersion?: number },
    ) => ({
      ...makeContent(),
      finalDraftMarkdown: markdown,
      finalDraftBaseVersion: options?.baseVersion ?? null,
    }),
  );
  mock(deps.getLocalCapture).mockResolvedValue(null);
  mock(deps.notify).mockReturnValue(undefined);
  return { ...deps, ...overrides };
};

let handle: ShiyanTaskDetailOrchestration | null = null;
let activeRenderer: ReactTestRenderer.ReactTestRenderer | null = null;

const Probe = ({ taskId, deps }: { taskId: string; deps: Deps }) => {
  handle = useShiyanTaskDetailOrchestration(taskId, deps);
  return null;
};

const renderProbe = async (deps: Deps): Promise<void> => {
  await ReactTestRenderer.act(async () => {
    activeRenderer = ReactTestRenderer.create(<Probe taskId="task-1" deps={deps} />);
    await flush();
  });
};

afterEach(() => {
  if (activeRenderer) {
    ReactTestRenderer.act(() => {
      activeRenderer?.unmount();
    });
    activeRenderer = null;
  }
  handle = null;
  jest.useRealTimers();
});

describe('useShiyanTaskDetailOrchestration data lifecycle', () => {
  it('loads task, transcript, content and local capture together on refresh', async () => {
    const deps = makeDeps();
    await renderProbe(deps);

    await ReactTestRenderer.act(async () => {
      await handle?.refreshAll();
    });

    expect(handle?.task).toEqual(makeTask());
    expect(handle?.taskError).toBe('');
    expect(handle?.loading).toBe(false);
    expect(handle?.transcript).toEqual({
      status: 'ready',
      value: makeTranscript(),
      message: null,
    });
    expect(handle?.content).toEqual(makeContent());
    expect(handle?.savedFinalMarkdown).toBeNull();
  });

  it('surfaces a task read failure without inventing a task', async () => {
    const deps = makeDeps();
    mock(deps.getCaptureTask).mockRejectedValue(new Error('无法读取拾言任务。'));
    await renderProbe(deps);

    await ReactTestRenderer.act(async () => {
      await handle?.refreshAll();
    });

    expect(handle?.task).toBeNull();
    expect(handle?.taskError).toBe('无法读取拾言任务。');
    expect(handle?.loading).toBe(false);
  });

  it('keeps the last good transcript when a later read is not ready', async () => {
    const deps = makeDeps();
    await renderProbe(deps);
    await ReactTestRenderer.act(async () => {
      await handle?.refreshAll();
    });

    deps.getTranscript = jest.fn(async () => {
      throw new ShiyanClientError('尚未生成', 'transcript_not_ready', true);
    });
    await ReactTestRenderer.act(async () => {
      await handle?.refreshAll();
    });

    expect(handle?.transcript.status).toBe('ready');
    expect(handle?.transcript.value).toEqual(makeTranscript());
  });

  it('keeps the last good transcript value while reporting a read failure', async () => {
    const deps = makeDeps();
    await renderProbe(deps);
    await ReactTestRenderer.act(async () => {
      await handle?.refreshAll();
    });

    deps.getTranscript = jest.fn(async () => {
      throw new Error('原文读取失败');
    });
    await ReactTestRenderer.act(async () => {
      await handle?.refreshAll();
    });

    expect(handle?.transcript).toMatchObject({
      status: 'error',
      message: '原文读取失败',
    });
    expect(handle?.transcript.value).toEqual(makeTranscript());
  });

  it('never lets a stale task response overwrite a newer refresh', async () => {
    let resolveFirst: (value: { task: ShiyanCaptureTaskView }) => void = () => undefined;
    const first = new Promise<{ task: ShiyanCaptureTaskView }>((resolve) => {
      resolveFirst = resolve;
    });
    const getCaptureTask = jest
      .fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async () => ({
        task: makeTask({ title: 'newer task' }),
      }));
    const deps = makeDeps({ getCaptureTask });
    await renderProbe(deps);

    await ReactTestRenderer.act(async () => {
      void handle?.refreshAll();
      void handle?.refreshAll();
      await flush();
    });
    expect(handle?.task?.title).toBe('newer task');

    await ReactTestRenderer.act(async () => {
      resolveFirst({ task: makeTask({ title: 'stale task' }) });
      await flush();
    });

    expect(handle?.task?.title).toBe('newer task');
    expect(handle?.loading).toBe(false);
  });

  it('never lets a stale content response overwrite a newer refresh', async () => {
    let resolveFirst: (value: ShiyanTaskContentView) => void = () => undefined;
    const first = new Promise<ShiyanTaskContentView>((resolve) => {
      resolveFirst = resolve;
    });
    const getTaskContent = jest
      .fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async () => makeContent({ aiDraftMarkdown: 'second' }));
    const deps = makeDeps({
      getTaskContent,
      getCaptureTask: jest.fn(),
    });
    // Keep the task active-but-failed so neither the ready-lifecycle reload nor
    // polling adds extra content reads; only the two explicit refreshes race.
    mock(deps.getCaptureTask).mockResolvedValue({
      task: makeTask({
        lifecycle: 'active',
        currentStage: 'transcribe',
        stages: [stage({ stage: 'transcribe', status: 'failed', retryable: true })],
      }),
    });
    await renderProbe(deps);

    await ReactTestRenderer.act(async () => {
      void handle?.refreshAll();
      void handle?.refreshAll();
      await flush();
    });
    expect(handle?.content?.aiDraftMarkdown).toBe('second');

    await ReactTestRenderer.act(async () => {
      resolveFirst(makeContent({ aiDraftMarkdown: 'first' }));
      await flush();
    });
    expect(handle?.content?.aiDraftMarkdown).toBe('second');
  });

  it('re-reads transcript on a transcribe retry and only the task on an organize retry', async () => {
    const deps = makeDeps();
    await renderProbe(deps);
    await ReactTestRenderer.act(async () => {
      await handle?.refreshAll();
    });
    const transcriptCallsAfterLoad = mock(deps.getTranscript).mock.calls.length;

    await ReactTestRenderer.act(async () => {
      await handle?.retryStage(stage({ stage: 'transcribe', status: 'failed', retryable: true }));
    });
    expect(deps.retryStt).toHaveBeenCalledWith('task-1');
    expect(deps.retryOrganize).not.toHaveBeenCalled();
    expect(mock(deps.getTranscript).mock.calls.length).toBe(transcriptCallsAfterLoad + 1);

    const transcriptCallsAfterTranscribe = mock(deps.getTranscript).mock.calls.length;
    await ReactTestRenderer.act(async () => {
      await handle?.retryStage(stage({ stage: 'organize', status: 'failed', retryable: true }));
    });
    expect(deps.retryOrganize).toHaveBeenCalledWith('task-1');
    expect(mock(deps.getTranscript).mock.calls.length).toBe(transcriptCallsAfterTranscribe);
  });

  it('does not mutate anything for a stage without a retry target', async () => {
    const deps = makeDeps();
    await renderProbe(deps);

    await ReactTestRenderer.act(async () => {
      await handle?.retryStage(stage({ stage: 'upload', status: 'failed', retryable: true }));
    });

    expect(deps.retryStt).not.toHaveBeenCalled();
    expect(deps.retryOrganize).not.toHaveBeenCalled();
    expect(handle?.busyAction).toBeNull();
  });

  it('reports a retry failure and clears the busy flag', async () => {
    const deps = makeDeps();
    mock(deps.retryStt).mockRejectedValue(new Error('转写服务不可用'));
    await renderProbe(deps);

    await ReactTestRenderer.act(async () => {
      await handle?.retryStage(stage({ stage: 'transcribe', status: 'failed', retryable: true }));
    });

    expect(deps.notify).toHaveBeenCalledWith('无法重试转写', '转写服务不可用');
    expect(handle?.busyAction).toBeNull();
  });

  it('records the audio retention choice and reports the outcome', async () => {
    const deps = makeDeps();
    await renderProbe(deps);

    await ReactTestRenderer.act(async () => {
      await handle?.setRetention(true);
    });

    expect(deps.setAudioRetention).toHaveBeenCalledWith('task-1', true);
    expect(handle?.retentionChoice).toBe(true);
    expect(deps.notify).toHaveBeenCalledWith('会保留原始录音', '已记录保留选择。');
  });
});

describe('useShiyanTaskDetailOrchestration polling', () => {
  it('re-reads task, transcript and content every 5s while the task is active', async () => {
    jest.useFakeTimers();
    const deps = makeDeps({
      getCaptureTask: jest.fn(),
    });
    mock(deps.getCaptureTask).mockResolvedValue({
      task: makeTask({
        lifecycle: 'active',
        currentStage: 'transcribe',
        stages: [stage({ stage: 'transcribe', status: 'running' })],
      }),
    });
    await renderProbe(deps);
    await ReactTestRenderer.act(async () => {
      await handle?.refreshAll();
    });
    const taskCalls = mock(deps.getCaptureTask).mock.calls.length;
    const transcriptCalls = mock(deps.getTranscript).mock.calls.length;
    const contentCalls = mock(deps.getTaskContent).mock.calls.length;

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(5000);
      await flush();
    });

    expect(mock(deps.getCaptureTask).mock.calls.length).toBe(taskCalls + 1);
    expect(mock(deps.getTranscript).mock.calls.length).toBe(transcriptCalls + 1);
    expect(mock(deps.getTaskContent).mock.calls.length).toBe(contentCalls + 1);
  });

  it('does not let a silent poll invalidate an in-flight foreground refresh', async () => {
    jest.useFakeTimers();

    const activeTask = makeTask({
      lifecycle: 'active',
      currentStage: 'transcribe',
      stages: [stage({ stage: 'transcribe', status: 'running' })],
    });
    const deps = makeDeps({
      getCaptureTask: jest.fn(async () => ({ task: activeTask })),
    });
    await renderProbe(deps);
    await ReactTestRenderer.act(async () => {
      await handle?.refreshAll();
    });

    let resolveForeground: (value: { task: ShiyanCaptureTaskView }) => void = () => undefined;
    const foreground = new Promise<{ task: ShiyanCaptureTaskView }>((resolve) => {
      resolveForeground = resolve;
    });
    mock(deps.getCaptureTask)
      .mockImplementationOnce(() => foreground)
      .mockImplementationOnce(async () => ({
        task: makeTask({
          ...activeTask,
          title: 'poll snapshot',
        }),
      }));

    await ReactTestRenderer.act(async () => {
      void handle?.refreshAll();
      await flush();
      jest.advanceTimersByTime(5000);
      await flush();
    });
    expect(handle?.task?.title).toBe('poll snapshot');

    await ReactTestRenderer.act(async () => {
      resolveForeground({
        task: makeTask({
          ...activeTask,
          title: 'foreground refresh',
        }),
      });
      await flush();
    });

    expect(handle?.task?.title).toBe('foreground refresh');
    expect(handle?.loading).toBe(false);
  });

  it('does not let an older silent poll overwrite a later foreground refresh', async () => {
    jest.useFakeTimers();

    const activeTask = makeTask({
      lifecycle: 'active',
      currentStage: 'transcribe',
      stages: [stage({ stage: 'transcribe', status: 'running' })],
    });
    const deps = makeDeps({
      getCaptureTask: jest.fn(async () => ({ task: activeTask })),
    });
    await renderProbe(deps);
    await ReactTestRenderer.act(async () => {
      await handle?.refreshAll();
    });

    let resolvePoll: (value: { task: ShiyanCaptureTaskView }) => void = () => undefined;
    const poll = new Promise<{ task: ShiyanCaptureTaskView }>((resolve) => {
      resolvePoll = resolve;
    });
    mock(deps.getCaptureTask)
      .mockImplementationOnce(() => poll)
      .mockImplementationOnce(async () => ({
        task: makeTask({
          ...activeTask,
          title: 'foreground refresh',
        }),
      }));

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(5000);
      await flush();
      await handle?.refreshAll();
    });
    expect(handle?.task?.title).toBe('foreground refresh');

    await ReactTestRenderer.act(async () => {
      resolvePoll({
        task: makeTask({
          ...activeTask,
          title: 'stale poll',
        }),
      });
      await flush();
    });

    expect(handle?.task?.title).toBe('foreground refresh');
  });

  it('stops polling once the current stage has failed', async () => {
    jest.useFakeTimers();
    const deps = makeDeps();
    mock(deps.getCaptureTask).mockResolvedValue({
      task: makeTask({
        lifecycle: 'active',
        currentStage: 'transcribe',
        stages: [stage({ stage: 'transcribe', status: 'failed', retryable: true })],
      }),
    });
    await renderProbe(deps);
    await ReactTestRenderer.act(async () => {
      await handle?.refreshAll();
    });
    const taskCalls = mock(deps.getCaptureTask).mock.calls.length;

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(10000);
      await flush();
    });

    expect(mock(deps.getCaptureTask).mock.calls.length).toBe(taskCalls);
  });
});

describe('useShiyanTaskDetailOrchestration Final Draft editor', () => {
  it('keeps AI adjustment as a candidate and never replaces the saved Final Draft', async () => {
    const deps = makeDeps({
      getTaskContent: jest.fn(),
    });
    mock(deps.getTaskContent).mockResolvedValue(
      makeContent({ finalDraftMarkdown: 'Human final', finalDraftBaseVersion: 3 }),
    );
    await renderProbe(deps);
    await ReactTestRenderer.act(async () => {
      await handle?.refreshAll();
    });
    expect(handle?.savedFinalMarkdown).toBe('Human final');

    let applied = false;
    await ReactTestRenderer.act(async () => {
      applied = (await handle?.adjustDraft('更短一些')) ?? false;
    });

    expect(applied).toBe(true);
    expect(deps.adjustAiDraft).toHaveBeenCalledWith('task-1', '更短一些');
    expect(handle?.candidate).toEqual(makeCandidate());
    expect(handle?.savedFinalMarkdown).toBe('Human final');
    expect(handle?.content?.finalDraftMarkdown).toBe('Human final');
  });

  it('returns false and notifies when AI adjustment fails', async () => {
    const deps = makeDeps();
    mock(deps.adjustAiDraft).mockRejectedValue(new Error('模型暂不可用'));
    await renderProbe(deps);

    let applied = true;
    await ReactTestRenderer.act(async () => {
      applied = (await handle?.adjustDraft('更短一些')) ?? true;
    });

    expect(applied).toBe(false);
    expect(deps.notify).toHaveBeenCalledWith('AI 调整暂不可用', '模型暂不可用');
    expect(handle?.candidate).toBeNull();
  });

  it('seeds the Final Draft editor from the saved draft and reverts on discard', async () => {
    const deps = makeDeps({
      getTaskContent: jest.fn(),
    });
    mock(deps.getTaskContent).mockResolvedValue(
      makeContent({ finalDraftMarkdown: 'Human final', finalDraftBaseVersion: 3 }),
    );
    await renderProbe(deps);
    await ReactTestRenderer.act(async () => {
      await handle?.refreshAll();
    });

    await ReactTestRenderer.act(async () => {
      handle?.openFinalEditor();
    });
    expect(handle?.finalEditorOpen).toBe(true);
    expect(handle?.finalMarkdown).toBe('Human final');
    expect(handle?.finalDraftDirty).toBe(false);

    await ReactTestRenderer.act(async () => {
      handle?.setFinalMarkdown('Edited');
    });
    expect(handle?.finalDraftDirty).toBe(true);

    await ReactTestRenderer.act(async () => {
      handle?.discardFinalEditor();
    });
    expect(handle?.finalEditorOpen).toBe(false);
    expect(handle?.finalMarkdown).toBe('Human final');
  });

  it('only adopts an adjustment candidate into editing on an explicit choice', async () => {
    const deps = makeDeps({
      getTaskContent: jest.fn(),
    });
    mock(deps.getTaskContent).mockResolvedValue(
      makeContent({ finalDraftMarkdown: 'Human final', finalDraftBaseVersion: 3 }),
    );
    await renderProbe(deps);
    await ReactTestRenderer.act(async () => {
      await handle?.refreshAll();
      await handle?.adjustDraft('更短一些');
    });

    await ReactTestRenderer.act(async () => {
      handle?.openFinalEditor(false);
    });
    expect(handle?.finalMarkdown).toBe('Human final');

    await ReactTestRenderer.act(async () => {
      handle?.discardFinalEditor();
    });
    await ReactTestRenderer.act(async () => {
      handle?.openFinalEditor(true);
    });
    expect(handle?.finalMarkdown).toBe('候选内容');
  });

  it('commits the saved Final Draft, clears the candidate and resets dirty state', async () => {
    const deps = makeDeps({
      getTaskContent: jest.fn(),
    });
    mock(deps.getTaskContent).mockResolvedValue(
      makeContent({ finalDraftMarkdown: 'Human final', finalDraftBaseVersion: 3 }),
    );
    await renderProbe(deps);
    await ReactTestRenderer.act(async () => {
      await handle?.refreshAll();
      await handle?.adjustDraft('更短一些');
    });
    expect(handle?.candidate).not.toBeNull();

    await ReactTestRenderer.act(async () => {
      handle?.openFinalEditor(true);
      handle?.setFinalMarkdown('Final edited');
    });
    await ReactTestRenderer.act(async () => {
      await handle?.saveFinalDraft();
    });

    expect(deps.saveFinalDraft).toHaveBeenCalledWith('task-1', 'Final edited', {
      title: '拾言任务',
      baseVersion: 5,
    });
    expect(handle?.savedFinalMarkdown).toBe('Final edited');
    expect(handle?.content?.finalDraftMarkdown).toBe('Final edited');
    expect(handle?.finalDraftDirty).toBe(false);
    expect(handle?.finalDraftSaving).toBe(false);
    expect(handle?.candidate).toBeNull();
    expect(deps.notify).toHaveBeenCalledWith(
      '最终稿已保存',
      '新的 AI 调整只会生成候选，不会覆盖这份内容。',
    );
  });

  it('never commits a content read while a Final Draft save is in flight', async () => {
    let resolveSave: (value: ShiyanTaskContentView) => void = () => undefined;
    const pendingSave = new Promise<ShiyanTaskContentView>((resolve) => {
      resolveSave = resolve;
    });
    const deps = makeDeps({
      saveFinalDraft: jest.fn(() => pendingSave),
    });
    await renderProbe(deps);
    await ReactTestRenderer.act(async () => {
      await handle?.refreshAll();
    });
    expect(handle?.content?.aiDraftMarkdown).toBe('AI draft');

    await ReactTestRenderer.act(async () => {
      handle?.openFinalEditor();
      handle?.setFinalMarkdown('Edited');
    });
    await ReactTestRenderer.act(async () => {
      void handle?.saveFinalDraft();
      await flush();
    });
    expect(handle?.finalDraftSaving).toBe(true);

    deps.getTaskContent = jest.fn(async () => makeContent({ aiDraftMarkdown: 'polled' }));
    await ReactTestRenderer.act(async () => {
      await handle?.refreshAll();
      await flush();
    });
    expect(handle?.content?.aiDraftMarkdown).toBe('AI draft');

    await ReactTestRenderer.act(async () => {
      resolveSave({
        ...makeContent(),
        finalDraftMarkdown: 'Edited',
        finalDraftBaseVersion: 4,
      });
      await flush();
    });
    expect(handle?.savedFinalMarkdown).toBe('Edited');
    expect(handle?.content?.finalDraftMarkdown).toBe('Edited');
    expect(handle?.finalDraftSaving).toBe(false);
  });

  it('rejects an empty Final Draft without calling the save contract', async () => {
    const deps = makeDeps();
    await renderProbe(deps);
    await ReactTestRenderer.act(async () => {
      await handle?.refreshAll();
      handle?.openFinalEditor();
      handle?.setFinalMarkdown('   ');
    });
    await ReactTestRenderer.act(async () => {
      await handle?.saveFinalDraft();
    });

    expect(deps.saveFinalDraft).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith('最终稿不能为空', '请先完成内容编辑。');
    expect(handle?.finalDraftSaving).toBe(false);
  });
});
