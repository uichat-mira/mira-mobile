import {
  localKeyValueStore,
  type LocalKeyValueStore,
} from '../../storage/localKeyValueStore';
import {
  snapshotShiyanSceneById,
  type ShiyanSceneSnapshot,
} from '../scenes';
import type { CompletedRecording } from './RecordingAdapter';
import { nativeAudioRecorder } from './nativeAudioRecorder';

const STORAGE_KEY = 'mira.shiyan.local-captures.v1';

export type LocalCaptureStatus =
  | 'pending_confirmation'
  | 'ready_for_submission'
  | 'submitted';

export interface LocalCaptureMetadata {
  id: string;
  filePath: string;
  sceneId: string;
  sceneName: string;
  sceneSnapshot?: ShiyanSceneSnapshot;
  title: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  fileSizeBytes: number;
  status: LocalCaptureStatus;
}

export interface RecordingFileStore {
  fileInfo(path: string): Promise<{ exists: boolean; size: number }>;
  deleteFile(path: string): Promise<void>;
}

const nativeRecordingFileStore: RecordingFileStore = {
  fileInfo: (path) => nativeAudioRecorder.fileInfo(path),
  deleteFile: (path) => nativeAudioRecorder.deleteFile(path),
};

const isSceneSnapshot = (value: unknown): value is ShiyanSceneSnapshot => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<ShiyanSceneSnapshot>;
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.instruction === 'string' &&
    typeof item.builtIn === 'boolean' &&
    Array.isArray(item.sections) &&
    item.sections.every(
      (section) =>
        !!section &&
        typeof section === 'object' &&
        typeof section.id === 'string' &&
        typeof section.title === 'string' &&
        typeof section.description === 'string',
    )
  );
};

const isCapture = (value: unknown): value is LocalCaptureMetadata => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<LocalCaptureMetadata>;
  return (
    typeof item.id === 'string' &&
    typeof item.filePath === 'string' &&
    typeof item.sceneId === 'string' &&
    typeof item.sceneName === 'string' &&
    (item.sceneSnapshot === undefined || isSceneSnapshot(item.sceneSnapshot)) &&
    typeof item.title === 'string' &&
    typeof item.startedAt === 'string' &&
    typeof item.endedAt === 'string' &&
    typeof item.durationMs === 'number' &&
    typeof item.fileSizeBytes === 'number' &&
    (item.status === 'pending_confirmation' ||
      item.status === 'ready_for_submission' ||
      item.status === 'submitted')
  );
};

export class LocalCaptureRepository {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: LocalKeyValueStore,
    private readonly files: RecordingFileStore,
  ) {}

  async listAll(): Promise<LocalCaptureMetadata[]> {
    const stored = await this.readAll();
    return stored.sort((a, b) => b.endedAt.localeCompare(a.endedAt));
  }

  async listRecoverable(): Promise<LocalCaptureMetadata[]> {
    const captures = (await this.listAll()).filter(
      (capture) => capture.status !== 'submitted',
    );
    const checked = await Promise.all(
      captures.map(async (capture) => ({
        capture,
        info: await this.files.fileInfo(capture.filePath).catch(() => ({ exists: false, size: 0 })),
      })),
    );
    return checked
      .filter(({ info }) => info.exists && info.size > 0)
      .map(({ capture, info }) => ({ ...capture, fileSizeBytes: info.size }));
  }

  async get(id: string): Promise<LocalCaptureMetadata | null> {
    const captures = await this.readAll();
    return captures.find((capture) => capture.id === id) ?? null;
  }

  async saveCompleted(input: {
    id: string;
    sceneId: string;
    sceneName: string;
    sceneSnapshot?: ShiyanSceneSnapshot;
    recording: CompletedRecording;
  }): Promise<LocalCaptureMetadata> {
    const sceneSnapshot = input.sceneSnapshot ?? snapshotShiyanSceneById(input.sceneId);
    const capture: LocalCaptureMetadata = {
      id: input.id,
      filePath: input.recording.filePath,
      sceneId: sceneSnapshot?.id ?? input.sceneId,
      sceneName: sceneSnapshot?.name ?? input.sceneName,
      ...(sceneSnapshot ? { sceneSnapshot } : {}),
      title: '',
      startedAt: input.recording.startedAt,
      endedAt: input.recording.endedAt,
      durationMs: input.recording.durationMs,
      fileSizeBytes: input.recording.fileSizeBytes,
      status: 'pending_confirmation',
    };

    await this.mutate((captures) => [capture, ...captures.filter((item) => item.id !== capture.id)]);
    return capture;
  }

  async confirm(input: {
    id: string;
    title: string;
    sceneId: string;
    sceneName: string;
    sceneSnapshot?: ShiyanSceneSnapshot;
  }): Promise<LocalCaptureMetadata> {
    const title = input.title.trim();
    if (!title) throw new Error('请填写录音标题。');

    let updated: LocalCaptureMetadata | null = null;
    await this.mutate((captures) =>
      captures.map((capture) => {
        if (capture.id !== input.id) return capture;
        updated = {
          ...capture,
          title,
          sceneId: input.sceneId,
          sceneName: input.sceneName,
          ...(input.sceneSnapshot ? { sceneSnapshot: input.sceneSnapshot } : {}),
          status: 'ready_for_submission',
        };
        return updated;
      }),
    );
    if (!updated) throw new Error('本地录音草稿不存在。');
    return updated;
  }

  async markSubmitted(id: string): Promise<void> {
    await this.mutate((captures) =>
      captures.map((capture) =>
        capture.id === id ? { ...capture, status: 'submitted' } : capture,
      ),
    );
  }

  async delete(id: string): Promise<void> {
    const capture = await this.get(id);
    if (!capture) return;
    await this.files.deleteFile(capture.filePath);
    await this.mutate((captures) => captures.filter((item) => item.id !== id));
  }

  /**
   * 删除所有已提交（status === 'submitted'）拾言录音对应的本地原始音频文件。
   * 仅删除文件本身，不修改元数据；提交记录、历史列表与 Cloud 事实不受影响，
   * 这些仍然依赖 `mira.shiyan.submissions.v1` 与 Cloud 任务本身。
   *
   * 返回值细分三种结果，让 UI 能明确告诉用户"已清理 N / 已不存在 M / 失败 F"，
   * 避免把仍然存在的文件冒充为缺失或清理成功。
   */
  async purgeSubmittedAudioFiles(): Promise<{
    purgedCount: number;
    missingCount: number;
    failedCount: number;
  }> {
    const captures = await this.readAll();
    let purgedCount = 0;
    let missingCount = 0;
    let failedCount = 0;

    for (const capture of captures) {
      if (capture.status !== 'submitted') continue;
      let info;
      try {
        info = await this.files.fileInfo(capture.filePath);
      } catch {
        failedCount += 1;
        continue;
      }
      if (!info.exists || info.size <= 0) {
        missingCount += 1;
        continue;
      }
      try {
        await this.files.deleteFile(capture.filePath);
        purgedCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    return { purgedCount, missingCount, failedCount };
  }

  private async readAll(): Promise<LocalCaptureMetadata[]> {
    const raw = await this.store.get(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isCapture);
    } catch {
      return [];
    }
  }

  private mutate(transform: (captures: LocalCaptureMetadata[]) => LocalCaptureMetadata[]) {
    const run = this.mutationQueue.then(async () => {
      const current = await this.readAll();
      await this.store.set(STORAGE_KEY, JSON.stringify(transform(current)));
    });
    this.mutationQueue = run.catch(() => undefined);
    return run;
  }
}

export const localCaptureRepository = new LocalCaptureRepository(
  localKeyValueStore,
  nativeRecordingFileStore,
);
