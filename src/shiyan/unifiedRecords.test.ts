import type { ShiyanHistoryTaskSummary } from './history';
import type { LocalCaptureMetadata } from './recording/localCaptureRepository';
import type { ShiyanSubmissionPointer } from './submissionRepository';
import { loadUnifiedRecords, projectUnifiedRecords } from './unifiedRecords';

const localCapture = (
  id: string,
  status: LocalCaptureMetadata['status'] = 'ready_for_submission',
): LocalCaptureMetadata => ({
  id,
  filePath: `/tmp/${id}.m4a`,
  sceneId: 'meeting',
  sceneName: '会议采集',
  title: `记录 ${id}`,
  startedAt: '2026-09-01T00:00:00.000Z',
  endedAt: '2026-09-01T00:10:00.000Z',
  durationMs: 600000,
  fileSizeBytes: 1024,
  status,
});

const pointer = (localCaptureId: string, taskId: string): ShiyanSubmissionPointer => ({
  localCaptureId,
  taskId,
  assetId: `asset-${taskId}`,
  uploadState: 'confirmed',
  updatedAt: '2026-09-01T00:11:00.000Z',
});

const task = (
  id: string,
  localCaptureId: string,
  overrides: Partial<ShiyanHistoryTaskSummary> = {},
): ShiyanHistoryTaskSummary => ({
  id,
  localCaptureId,
  title: `任务 ${id}`,
  sceneName: '会议采集',
  createdAt: '2026-09-01T00:12:00.000Z',
  lifecycle: 'active',
  currentStage: 'organize',
  stageStatus: 'running',
  canonicalDestinationUrl: null,
  ...overrides,
});

describe('projectUnifiedRecords', () => {
  it('projects an unsubmitted LocalCapture into one local record', () => {
    const records = projectUnifiedRecords({
      localCaptures: [localCapture('local-1')],
      tasks: [],
      submissions: [],
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      localCaptureId: 'local-1',
      taskId: null,
      statusLabel: '待提交',
    });
  });

  it('deduplicates a bound LocalCapture when the authoritative CaptureTask is available', () => {
    const records = projectUnifiedRecords({
      localCaptures: [localCapture('local-1', 'submitted')],
      submissions: [pointer('local-1', 'task-1')],
      tasks: [task('task-1', 'local-1')],
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: 'task:task-1',
      localCaptureId: 'local-1',
      taskId: 'task-1',
      title: '任务 task-1',
      statusLabel: '正在整理',
    });
  });

  it('reuses lifecycle-aware task presentation for processing, ready, completed and failed states', () => {
    const records = projectUnifiedRecords({
      localCaptures: [],
      submissions: [],
      tasks: [
        task('uploading', 'local-uploading', { currentStage: 'upload', stageStatus: 'running' }),
        task('transcribing', 'local-transcribing', {
          currentStage: 'transcribe',
          stageStatus: 'running',
        }),
        task('processing', 'local-processing'),
        task('ready', 'local-ready', {
          lifecycle: 'ready',
          currentStage: 'review',
          stageStatus: 'pending',
        }),
        task('completed', 'local-completed', {
          lifecycle: 'completed',
          currentStage: 'review',
          stageStatus: 'succeeded',
        }),
        task('failed', 'local-failed', { currentStage: 'organize', stageStatus: 'failed' }),
        task('delivered', 'local-delivered', {
          lifecycle: 'completed',
          currentStage: 'delivery',
          stageStatus: 'succeeded',
          canonicalDestinationUrl: 'https://example.com/final.md',
        }),
      ],
    });

    expect(records.find((item) => item.taskId === 'uploading')?.statusLabel).toBe('正在上传录音');
    expect(records.find((item) => item.taskId === 'transcribing')?.statusLabel).toBe('正在转写');
    expect(records.find((item) => item.taskId === 'processing')?.statusLabel).toBe('正在整理');
    expect(records.find((item) => item.taskId === 'ready')?.statusLabel).toBe('待你确认');
    expect(records.find((item) => item.taskId === 'completed')).toMatchObject({
      statusLabel: '已完成',
      statusTone: 'success',
    });
    expect(records.find((item) => item.taskId === 'failed')).toMatchObject({
      statusLabel: '需要处理',
      statusTone: 'error',
    });
    expect(records.find((item) => item.taskId === 'delivered')).toMatchObject({
      statusLabel: '已投递',
      statusTone: 'success',
    });
  });
});

describe('loadUnifiedRecords', () => {
  it('keeps local records visible when Cloud history fails', async () => {
    const result = await loadUnifiedRecords({
      listLocalCaptures: async () => [localCapture('local-1')],
      listSubmissions: async () => [],
      listTasks: async () => {
        throw new Error('offline');
      },
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].localCaptureId).toBe('local-1');
    expect(result.cloudError?.message).toBe('offline');
  });

  it('keeps a locally known task binding when Cloud history is temporarily unavailable', async () => {
    const result = await loadUnifiedRecords({
      listLocalCaptures: async () => [localCapture('local-1', 'submitted')],
      listSubmissions: async () => [pointer('local-1', 'task-1')],
      listTasks: async () => {
        throw new Error('offline');
      },
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      localCaptureId: 'local-1',
      taskId: 'task-1',
      statusLabel: '整理中',
    });
  });
});
