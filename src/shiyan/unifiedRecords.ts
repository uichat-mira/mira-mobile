import { getShiyanHistoryDataSource, type ShiyanHistoryTaskSummary } from './history';
import {
  localCaptureRepository,
  type LocalCaptureMetadata,
} from './recording/localCaptureRepository';
import {
  shiyanSubmissionRepository,
  type ShiyanSubmissionPointer,
} from './submissionRepository';
import {
  shiyanTaskStateUserStatus,
  type ShiyanUserStatusTone,
} from './taskPresentation';

export type UnifiedRecordTone = ShiyanUserStatusTone;

export interface UnifiedRecordPresentation {
  id: string;
  localCaptureId: string;
  taskId: string | null;
  title: string;
  sceneName: string;
  createdAt: string;
  statusLabel: string;
  statusTone: UnifiedRecordTone;
  canonicalDestinationUrl: string | null;
}

export interface UnifiedRecordLoadResult {
  records: UnifiedRecordPresentation[];
  cloudError: Error | null;
}

const localStatus = (
  capture: LocalCaptureMetadata,
  pointer: ShiyanSubmissionPointer | null,
): Pick<UnifiedRecordPresentation, 'statusLabel' | 'statusTone'> => {
  if (pointer) {
    if (pointer.uploadState === 'task_created') {
      return { statusLabel: '等待上传', statusTone: 'primary' };
    }
    if (pointer.uploadState === 'uploading') {
      return { statusLabel: '上传中', statusTone: 'primary' };
    }
    if (pointer.uploadState === 'uploaded') {
      return { statusLabel: '等待处理', statusTone: 'primary' };
    }
    return { statusLabel: '整理中', statusTone: 'primary' };
  }

  if (capture.status === 'pending_confirmation') {
    return { statusLabel: '待确认', statusTone: 'muted' };
  }
  if (capture.status === 'ready_for_submission') {
    return { statusLabel: '待提交', statusTone: 'primary' };
  }
  return { statusLabel: '已提交', statusTone: 'muted' };
};

const taskStatus = (
  task: ShiyanHistoryTaskSummary,
): Pick<UnifiedRecordPresentation, 'statusLabel' | 'statusTone'> => {
  if (task.canonicalDestinationUrl) {
    return { statusLabel: '已投递', statusTone: 'success' };
  }

  const status = shiyanTaskStateUserStatus({
    lifecycle: task.lifecycle,
    currentStage: task.currentStage,
    stageStatus: task.stageStatus,
  });
  return {
    statusLabel: status.label,
    statusTone: status.tone,
  };
};

export function projectUnifiedRecords(input: {
  localCaptures: readonly LocalCaptureMetadata[];
  tasks: readonly ShiyanHistoryTaskSummary[];
  submissions: readonly ShiyanSubmissionPointer[];
}): UnifiedRecordPresentation[] {
  const submissionByLocalCaptureId = new Map(
    input.submissions.map((pointer) => [pointer.localCaptureId, pointer] as const),
  );
  const byLocalCaptureId = new Map<string, UnifiedRecordPresentation>();

  for (const capture of input.localCaptures) {
    const pointer = submissionByLocalCaptureId.get(capture.id) ?? null;
    const status = localStatus(capture, pointer);
    byLocalCaptureId.set(capture.id, {
      id: pointer ? `task:${pointer.taskId}` : `local:${capture.id}`,
      localCaptureId: capture.id,
      taskId: pointer?.taskId ?? null,
      title: capture.title || '未命名录音',
      sceneName: capture.sceneName,
      createdAt: pointer?.updatedAt ?? capture.endedAt,
      ...status,
      canonicalDestinationUrl: null,
    });
  }

  for (const task of input.tasks) {
    const status = taskStatus(task);
    byLocalCaptureId.set(task.localCaptureId, {
      id: `task:${task.id}`,
      localCaptureId: task.localCaptureId,
      taskId: task.id,
      title: task.title,
      sceneName: task.sceneName,
      createdAt: task.createdAt,
      ...status,
      canonicalDestinationUrl: task.canonicalDestinationUrl,
    });
  }

  return [...byLocalCaptureId.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export async function loadUnifiedRecords(options: {
  listLocalCaptures?: () => Promise<readonly LocalCaptureMetadata[]>;
  listTasks?: () => Promise<readonly ShiyanHistoryTaskSummary[]>;
  listSubmissions?: () => Promise<readonly ShiyanSubmissionPointer[]>;
} = {}): Promise<UnifiedRecordLoadResult> {
  const listLocalCaptures =
    options.listLocalCaptures ?? (() => localCaptureRepository.listAll());
  const listTasks =
    options.listTasks ?? (() => getShiyanHistoryDataSource().listTasks());
  const listSubmissions =
    options.listSubmissions ?? (() => shiyanSubmissionRepository.list());

  const [localCaptures, submissions] = await Promise.all([
    listLocalCaptures(),
    listSubmissions(),
  ]);

  let tasks: readonly ShiyanHistoryTaskSummary[] = [];
  let cloudError: Error | null = null;
  try {
    tasks = await listTasks();
  } catch (error) {
    cloudError = error instanceof Error ? error : new Error('无法读取拾言 Cloud 记录。');
  }

  return {
    records: projectUnifiedRecords({ localCaptures, tasks, submissions }),
    cloudError,
  };
}
