import { MemoryLocalKeyValueStore } from '../../storage/localKeyValueStore';
import {
  LocalCaptureRepository,
  type RecordingFileStore,
} from './localCaptureRepository';

class FakeRecordingFileStore implements RecordingFileStore {
  readonly files = new Map<string, number>();
  readonly failDeletePaths = new Set<string>();
  readonly failInfoPaths = new Set<string>();

  async fileInfo(path: string) {
    if (this.failInfoPaths.has(path)) throw new Error('native info failed');
    const size = this.files.get(path);
    return { exists: size != null, size: size ?? 0 };
  }

  async deleteFile(path: string) {
    if (this.failDeletePaths.has(path)) throw new Error('native delete failed');
    this.files.delete(path);
  }
}

describe('LocalCaptureRepository', () => {
  it('recovers a completed local recording after repository recreation', async () => {
    const store = new MemoryLocalKeyValueStore();
    const files = new FakeRecordingFileStore();
    files.files.set('/private/shiyan/a.m4a', 2048);

    const first = new LocalCaptureRepository(store, files);
    await first.saveCompleted({
      id: 'a',
      sceneId: 'meeting',
      sceneName: '会议采集',
      recording: {
        filePath: '/private/shiyan/a.m4a',
        startedAt: '2026-08-29T01:00:00.000Z',
        endedAt: '2026-08-29T01:01:00.000Z',
        durationMs: 60000,
        fileSizeBytes: 2048,
      },
    });

    const afterRestart = new LocalCaptureRepository(store, files);
    await expect(afterRestart.listRecoverable()).resolves.toEqual([
      expect.objectContaining({
        id: 'a',
        status: 'pending_confirmation',
        fileSizeBytes: 2048,
      }),
    ]);
  });

  it('keeps title and scene confirmation local without creating a cloud task', async () => {
    const store = new MemoryLocalKeyValueStore();
    const files = new FakeRecordingFileStore();
    files.files.set('/private/shiyan/b.m4a', 4096);
    const repository = new LocalCaptureRepository(store, files);

    await repository.saveCompleted({
      id: 'b',
      sceneId: 'dictation',
      sceneName: '临时口述需求',
      recording: {
        filePath: '/private/shiyan/b.m4a',
        startedAt: '2026-08-29T02:00:00.000Z',
        endedAt: '2026-08-29T02:02:00.000Z',
        durationMs: 120000,
        fileSizeBytes: 4096,
      },
    });

    await repository.confirm({
      id: 'b',
      title: '  客户补充需求  ',
      sceneId: 'meeting',
      sceneName: '会议采集',
    });

    await expect(repository.get('b')).resolves.toEqual(
      expect.objectContaining({
        title: '客户补充需求',
        sceneId: 'meeting',
        status: 'ready_for_submission',
      }),
    );
  });

  it('keeps submitted audio locally but removes it from actionable drafts', async () => {
    const store = new MemoryLocalKeyValueStore();
    const files = new FakeRecordingFileStore();
    files.files.set('/private/shiyan/submitted.m4a', 8192);
    const repository = new LocalCaptureRepository(store, files);

    await repository.saveCompleted({
      id: 'submitted',
      sceneId: 'meeting',
      sceneName: '会议采集',
      recording: {
        filePath: '/private/shiyan/submitted.m4a',
        startedAt: '2026-08-29T03:00:00.000Z',
        endedAt: '2026-08-29T03:10:00.000Z',
        durationMs: 600000,
        fileSizeBytes: 8192,
      },
    });
    await repository.confirm({
      id: 'submitted',
      title: '已提交会议',
      sceneId: 'meeting',
      sceneName: '会议采集',
    });
    await repository.markSubmitted('submitted');

    await expect(repository.listRecoverable()).resolves.toEqual([]);
    expect(files.files.has('/private/shiyan/submitted.m4a')).toBe(true);
    await expect(repository.get('submitted')).resolves.toEqual(
      expect.objectContaining({ status: 'submitted' }),
    );
  });

  it('deletes both local audio and metadata only on explicit delete', async () => {
    const store = new MemoryLocalKeyValueStore();
    const files = new FakeRecordingFileStore();
    files.files.set('/private/shiyan/c.m4a', 1024);
    const repository = new LocalCaptureRepository(store, files);

    await repository.saveCompleted({
      id: 'c',
      sceneId: 'reflection',
      sceneName: '个人复盘 / 想法记录',
      recording: {
        filePath: '/private/shiyan/c.m4a',
        startedAt: '2026-08-29T03:00:00.000Z',
        endedAt: '2026-08-29T03:00:10.000Z',
        durationMs: 10000,
        fileSizeBytes: 1024,
      },
    });

    await repository.delete('c');

    expect(files.files.has('/private/shiyan/c.m4a')).toBe(false);
    await expect(repository.get('c')).resolves.toBeNull();
  });

  it('purges submitted audio files without touching metadata or pending drafts', async () => {
    const store = new MemoryLocalKeyValueStore();
    const files = new FakeRecordingFileStore();
    files.files.set('/private/shiyan/submitted-1.m4a', 2048);
    files.files.set('/private/shiyan/submitted-2.m4a', 4096);
    files.files.set('/private/shiyan/draft.m4a', 8192);
    const repository = new LocalCaptureRepository(store, files);

    await repository.saveCompleted({
      id: 'submitted-1',
      sceneId: 'meeting',
      sceneName: '会议采集',
      recording: {
        filePath: '/private/shiyan/submitted-1.m4a',
        startedAt: '2026-08-29T03:00:00.000Z',
        endedAt: '2026-08-29T03:10:00.000Z',
        durationMs: 600000,
        fileSizeBytes: 2048,
      },
    });
    await repository.confirm({
      id: 'submitted-1',
      title: '已提交会议 1',
      sceneId: 'meeting',
      sceneName: '会议采集',
    });
    await repository.markSubmitted('submitted-1');

    await repository.saveCompleted({
      id: 'submitted-2',
      sceneId: 'meeting',
      sceneName: '会议采集',
      recording: {
        filePath: '/private/shiyan/submitted-2.m4a',
        startedAt: '2026-08-29T04:00:00.000Z',
        endedAt: '2026-08-29T04:10:00.000Z',
        durationMs: 600000,
        fileSizeBytes: 4096,
      },
    });
    await repository.confirm({
      id: 'submitted-2',
      title: '已提交会议 2',
      sceneId: 'meeting',
      sceneName: '会议采集',
    });
    await repository.markSubmitted('submitted-2');

    await repository.saveCompleted({
      id: 'draft',
      sceneId: 'reflection',
      sceneName: '个人复盘',
      recording: {
        filePath: '/private/shiyan/draft.m4a',
        startedAt: '2026-08-29T05:00:00.000Z',
        endedAt: '2026-08-29T05:01:00.000Z',
        durationMs: 60000,
        fileSizeBytes: 8192,
      },
    });

    const result = await repository.purgeSubmittedAudioFiles();

    expect(result).toEqual({ purgedCount: 2, missingCount: 0, failedCount: 0 });
    expect(files.files.has('/private/shiyan/submitted-1.m4a')).toBe(false);
    expect(files.files.has('/private/shiyan/submitted-2.m4a')).toBe(false);
    expect(files.files.has('/private/shiyan/draft.m4a')).toBe(true);
    await expect(repository.get('submitted-1')).resolves.toEqual(
      expect.objectContaining({ status: 'submitted', title: '已提交会议 1' }),
    );
    await expect(repository.get('submitted-2')).resolves.toEqual(
      expect.objectContaining({ status: 'submitted' }),
    );
    await expect(repository.get('draft')).resolves.toEqual(
      expect.objectContaining({ status: 'pending_confirmation' }),
    );
  });

  it('reports missing submitted files instead of throwing on purge', async () => {
    const store = new MemoryLocalKeyValueStore();
    const files = new FakeRecordingFileStore();
    const repository = new LocalCaptureRepository(store, files);

    await repository.saveCompleted({
      id: 'submitted-missing',
      sceneId: 'meeting',
      sceneName: '会议采集',
      recording: {
        filePath: '/private/shiyan/gone.m4a',
        startedAt: '2026-08-29T03:00:00.000Z',
        endedAt: '2026-08-29T03:10:00.000Z',
        durationMs: 600000,
        fileSizeBytes: 0,
      },
    });
    await repository.confirm({
      id: 'submitted-missing',
      title: '已删除会议',
      sceneId: 'meeting',
      sceneName: '会议采集',
    });
    await repository.markSubmitted('submitted-missing');

    const result = await repository.purgeSubmittedAudioFiles();
    expect(result).toEqual({ purgedCount: 0, missingCount: 1, failedCount: 0 });
  });

  it('reports a separate failed count when delete throws', async () => {
    const store = new MemoryLocalKeyValueStore();
    const files = new FakeRecordingFileStore();
    files.files.set('/private/shiyan/good.m4a', 2048);
    files.files.set('/private/shiyan/broken.m4a', 4096);
    files.failDeletePaths.add('/private/shiyan/broken.m4a');
    const repository = new LocalCaptureRepository(store, files);

    const completed = async (id: string, path: string) => {
      await repository.saveCompleted({
        id,
        sceneId: 'meeting',
        sceneName: '会议采集',
        recording: {
          filePath: path,
          startedAt: '2026-08-29T03:00:00.000Z',
          endedAt: '2026-08-29T03:10:00.000Z',
          durationMs: 600000,
          fileSizeBytes: 2048,
        },
      });
      await repository.confirm({
        id,
        title: id,
        sceneId: 'meeting',
        sceneName: '会议采集',
      });
      await repository.markSubmitted(id);
    };
    await completed('good', '/private/shiyan/good.m4a');
    await completed('broken', '/private/shiyan/broken.m4a');

    const result = await repository.purgeSubmittedAudioFiles();
    expect(result).toEqual({ purgedCount: 1, missingCount: 0, failedCount: 1 });
    expect(files.files.has('/private/shiyan/good.m4a')).toBe(false);
    expect(files.files.has('/private/shiyan/broken.m4a')).toBe(true);
  });
});
