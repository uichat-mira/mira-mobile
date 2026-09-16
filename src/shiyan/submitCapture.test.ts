import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import type { LocalCaptureMetadata } from './recording/localCaptureRepository';
import type { ShiyanCloudClient } from './client/ShiyanClient';
import { ShiyanClientError } from './client/ShiyanClient';
import { ShiyanSubmissionRepository } from './submissionRepository';
import { submitLocalCapture } from './submitCapture';

const capture: LocalCaptureMetadata = {
  id: 'capture-1',
  filePath: '/private/capture-1.m4a',
  sceneId: 'meeting',
  sceneName: '会议采集',
  title: '产品评审',
  startedAt: '2026-08-29T00:00:00.000Z',
  endedAt: '2026-08-29T00:10:00.000Z',
  durationMs: 600000,
  fileSizeBytes: 1024,
  status: 'ready_for_submission',
};

const task = {
  id: 'task-1',
  deviceId: 'device-1',
  userId: null,
  title: '产品评审',
  sceneId: 'meeting',
  lifecycle: 'active' as const,
  currentStage: 'upload',
  createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z',
  stages: [],
};

const client = (upload: ShiyanCloudClient['uploadLocalAudio']): ShiyanCloudClient => ({
  async createCaptureTask(input) {
    expect(input.idempotencyKey).toBe('mobile-capture:capture-1');
    return {
      task: { ...task, sceneId: input.sceneId },
      upload: {
        assetId: 'asset-1',
        objectKey: 'audio/task-1/asset-1',
        method: 'PUT',
        url: 'https://upload.invalid',
        expiresAt: '2026-08-29T00:15:00.000Z',
        headers: { 'content-type': 'audio/mp4' },
      },
    };
  },
  getCaptureTask: jest.fn(),
  getTranscript: jest.fn(),
  retryStt: jest.fn(),
  retryOrganize: jest.fn(),
  getAiDraft: jest.fn(),
  adjustAiDraft: jest.fn(),
  getFinalDraft: jest.fn(),
  saveFinalDraft: jest.fn(),
  listScenes: jest.fn(),
  createScene: jest.fn(async (scene) => ({ scene: { ...scene, builtIn: false } })),
  getDeliveries: jest.fn(),
  setAudioRetention: jest.fn(),
  uploadLocalAudio: upload,
  confirmAudio: jest.fn(async () => ({ task })),
});

const captures = () => ({
  confirm: jest.fn(async () => capture),
  markSubmitted: jest.fn(async () => undefined),
});

describe('submitLocalCapture', () => {
  it('keeps a recovery pointer when upload fails so the local recording can retry', async () => {
    const submissions = new ShiyanSubmissionRepository(new MemoryLocalKeyValueStore());
    const localCaptures = captures();
    const failingClient = client(async () => {
      throw new ShiyanClientError('upload timeout', 'upload_timeout', true);
    });

    await expect(
      submitLocalCapture(capture, {
        client: failingClient,
        submissions,
        captures: localCaptures,
      }),
    ).rejects.toMatchObject({ code: 'upload_timeout', retryable: true });

    expect(await submissions.get(capture.id)).toMatchObject({
      localCaptureId: capture.id,
      taskId: 'task-1',
      assetId: 'asset-1',
      uploadState: 'uploading',
    });
    expect(localCaptures.markSubmitted).not.toHaveBeenCalled();
  });

  it('can resume an interrupted upload through the same idempotent submission flow', async () => {
    const submissions = new ShiyanSubmissionRepository(new MemoryLocalKeyValueStore());
    const localCaptures = captures();
    let uploadAttempts = 0;
    const retryingClient = client(async () => {
      uploadAttempts += 1;
      if (uploadAttempts === 1) {
        throw new ShiyanClientError('upload timeout', 'upload_timeout', true);
      }
    });

    await expect(
      submitLocalCapture(capture, {
        client: retryingClient,
        submissions,
        captures: localCaptures,
      }),
    ).rejects.toMatchObject({ code: 'upload_timeout' });

    await expect(
      submitLocalCapture(capture, {
        client: retryingClient,
        submissions,
        captures: localCaptures,
      }),
    ).resolves.toBe('task-1');

    expect(uploadAttempts).toBe(2);
    expect(await submissions.get(capture.id)).toMatchObject({
      taskId: 'task-1',
      assetId: 'asset-1',
      uploadState: 'confirmed',
    });
    expect(localCaptures.markSubmitted).toHaveBeenCalledWith(capture.id);
  });

  it('marks confirmed state and local capture only after upload and Cloud confirm succeed', async () => {
    const submissions = new ShiyanSubmissionRepository(new MemoryLocalKeyValueStore());
    const localCaptures = captures();
    await submitLocalCapture(capture, {
      client: client(async (_grant, _path, onProgress) => onProgress?.(1)),
      submissions,
      captures: localCaptures,
    });

    expect(await submissions.get(capture.id)).toMatchObject({ uploadState: 'confirmed' });
    expect(localCaptures.markSubmitted).toHaveBeenCalledWith(capture.id);
  });

  it('registers a frozen custom scene before creating the CaptureTask', async () => {
    const submissions = new ShiyanSubmissionRepository(new MemoryLocalKeyValueStore());
    const cloud = client(async () => undefined);
    const customCapture: LocalCaptureMetadata = {
      ...capture,
      sceneId: 'custom-abc12',
      sceneName: '客户访谈',
      sceneSnapshot: {
        id: 'custom-abc12',
        name: '客户访谈',
        instruction: '区分事实与推测',
        sections: [{ id: 'section-1', title: '摘要', description: '摘要' }],
        builtIn: false,
      },
    };

    await submitLocalCapture(customCapture, {
      client: cloud,
      submissions,
      captures: captures(),
    });

    expect(cloud.createScene).toHaveBeenCalledWith({
      id: 'custom-abc12',
      name: '客户访谈',
      instruction: '区分事实与推测',
      sections: [{ id: 'section-1', title: '摘要', description: '摘要' }],
    });
  });
});
