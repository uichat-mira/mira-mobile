import type {
  ShiyanCaptureStageView,
  ShiyanCaptureTaskView,
  ShiyanTranscriptView,
} from './client/contracts';
import {
  EMPTY_SHIYAN_TRANSCRIPT,
  buildShiyanFinalDraftSaveInput,
  resolveShiyanStageRetryTarget,
  shouldPollShiyanTask,
  shiyanTranscriptFailure,
  shiyanTranscriptNotReady,
  shiyanTranscriptReady,
} from './taskDetailOrchestration';

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

const task = (
  overrides: Partial<ShiyanCaptureTaskView> = {},
): ShiyanCaptureTaskView => ({
  id: 'task-1',
  deviceId: 'device-1',
  userId: null,
  title: '拾言任务',
  sceneId: 'meeting',
  lifecycle: 'active',
  currentStage: 'review',
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
  stages: [stage()],
  ...overrides,
});

const transcript = (): ShiyanTranscriptView => ({
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

describe('Shiyan task-detail orchestration helpers', () => {
  it('marks a transcript ready and keeps it across a not-ready read', () => {
    const ready = shiyanTranscriptReady(transcript());
    expect(ready).toEqual({ status: 'ready', value: transcript(), message: null });
    expect(shiyanTranscriptNotReady(ready)).toEqual({
      status: 'ready',
      value: transcript(),
      message: null,
    });
    expect(shiyanTranscriptNotReady(EMPTY_SHIYAN_TRANSCRIPT)).toBe(
      EMPTY_SHIYAN_TRANSCRIPT,
    );
  });

  it('keeps the last good transcript value when a read fails', () => {
    const previous = shiyanTranscriptReady(transcript());
    expect(shiyanTranscriptFailure(previous, '原文读取失败')).toEqual({
      status: 'error',
      value: transcript(),
      message: '原文读取失败',
    });
    expect(shiyanTranscriptFailure(EMPTY_SHIYAN_TRANSCRIPT, '原文读取失败')).toEqual({
      status: 'error',
      value: null,
      message: '原文读取失败',
    });
  });

  it('only retries the transcribe and organize stages', () => {
    expect(
      resolveShiyanStageRetryTarget(
        stage({ stage: 'transcribe', status: 'failed', retryable: true }),
      ),
    ).toBe('transcribe');
    expect(
      resolveShiyanStageRetryTarget(
        stage({ stage: 'organize', status: 'failed', retryable: true }),
      ),
    ).toBe('organize');
    expect(
      resolveShiyanStageRetryTarget(
        stage({ stage: 'upload', status: 'failed', retryable: true }),
      ),
    ).toBeNull();
    expect(
      resolveShiyanStageRetryTarget(
        stage({ stage: 'transcribe', status: 'failed', retryable: false }),
      ),
    ).toBeNull();
  });

  it('polls only an active task whose current stage has not failed', () => {
    const running = stage({ stage: 'transcribe', status: 'running' });
    expect(shouldPollShiyanTask(task({ lifecycle: 'active' }), running)).toBe(true);
    expect(
      shouldPollShiyanTask(
        task({ lifecycle: 'active' }),
        stage({ stage: 'transcribe', status: 'failed', retryable: true }),
      ),
    ).toBe(false);
    expect(shouldPollShiyanTask(task({ lifecycle: 'ready' }), running)).toBe(false);
    expect(shouldPollShiyanTask(null, running)).toBe(false);
  });

  it('omits a falsy title and base version from the save payload', () => {
    expect(buildShiyanFinalDraftSaveInput(task(), 3)).toEqual({
      title: '拾言任务',
      baseVersion: 3,
    });
    expect(buildShiyanFinalDraftSaveInput(task({ title: '' }), null)).toEqual({});
    expect(buildShiyanFinalDraftSaveInput(null, 0)).toEqual({});
  });
});
