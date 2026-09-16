import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import {
  computeDeviceStorageUsage,
  formatBytes,
} from './deviceStorageUsage';
import type { LocalCaptureMetadata } from '../shiyan/recording/localCaptureRepository';

const baseCaptures = (
  overrides: Partial<LocalCaptureMetadata> = {},
): LocalCaptureMetadata => ({
  id: 'cap-1',
  filePath: '/private/shiyan/cap-1.m4a',
  sceneId: 'scene-1',
  sceneName: '会议',
  title: '标题',
  startedAt: '2026-09-16T01:00:00.000Z',
  endedAt: '2026-09-16T01:05:00.000Z',
  durationMs: 5 * 60 * 1000,
  fileSizeBytes: 1024 * 1024,
  status: 'submitted',
  ...overrides,
});

describe('computeDeviceStorageUsage', () => {
  it('reports zero usage on an empty store with no audio files', async () => {
    const store = new MemoryLocalKeyValueStore();
    const usage = await computeDeviceStorageUsage({
      store,
      includeAudioFiles: false,
    });
    expect(usage.totalBytes).toBe(0);
    expect(usage.audioFileCount).toBe(0);
    expect(usage.submittedAudioFileCount).toBe(0);
    expect(usage.audioFilesAvailable).toBe(false);
    expect(usage.categories.length).toBeGreaterThan(0);
    for (const category of usage.categories) {
      expect(category.keyValueBytes).toBe(0);
      expect(category.fileBytes).toBe(0);
    }
  });

  it('aggregates appearance keys into the appearance category', async () => {
    const store = new MemoryLocalKeyValueStore();
    await store.set('mira.mobile.theme.mode', 'dark');
    await store.set('mira.mobile.theme.accent', 'archive-green');

    const usage = await computeDeviceStorageUsage({
      store,
      includeAudioFiles: false,
    });

    const appearance = usage.categories.find((c) => c.id === 'appearance');
    expect(appearance).toBeDefined();
    expect(appearance!.keyValueBytes).toBeGreaterThan(0);
    expect(usage.totalBytes).toBe(appearance!.keyValueBytes);
  });

  it('counts submitted capture audio bytes and separates non-submitted captures', async () => {
    const store = new MemoryLocalKeyValueStore();
    const captures: LocalCaptureMetadata[] = [
      baseCaptures({ id: 'submitted-1', status: 'submitted', fileSizeBytes: 2048 }),
      baseCaptures({ id: 'submitted-2', status: 'submitted', fileSizeBytes: 4096 }),
      baseCaptures({
        id: 'draft-1',
        status: 'pending_confirmation',
        fileSizeBytes: 8192,
      }),
      baseCaptures({ id: 'ready-1', status: 'ready_for_submission', fileSizeBytes: 16384 }),
    ];

    const usage = await computeDeviceStorageUsage({
      store,
      captures,
      includeAudioFiles: true,
    });

    expect(usage.audioFileCount).toBe(4);
    expect(usage.submittedAudioFileCount).toBe(2);
    const audio = usage.categories.find((c) => c.id === 'shiyan-submitted-audio');
    expect(audio).toBeDefined();
    expect(audio!.fileBytes).toBe(2048 + 4096);
    expect(usage.totalBytes).toBe(audio!.fileBytes);
  });

  it('does not show submitted-audio category when no submitted captures exist', async () => {
    const store = new MemoryLocalKeyValueStore();
    const captures: LocalCaptureMetadata[] = [
      baseCaptures({ id: 'draft-1', status: 'pending_confirmation' }),
    ];
    const usage = await computeDeviceStorageUsage({
      store,
      captures,
      includeAudioFiles: true,
    });
    expect(usage.submittedAudioFileCount).toBe(0);
    expect(usage.categories.find((c) => c.id === 'shiyan-submitted-audio')).toBeUndefined();
  });

  it('groups unknown keys under "other"', async () => {
    const store = new MemoryLocalKeyValueStore();
    await store.set('mira.experimental.telemetry.v1', 'ping-pong');

    const usage = await computeDeviceStorageUsage({
      store,
      knownKeys: ['mira.experimental.telemetry.v1'],
      includeAudioFiles: false,
    });

    const other = usage.categories.find((c) => c.id === 'other');
    expect(other).toBeDefined();
    expect(other!.keyValueBytes).toBeGreaterThan(0);
  });

  it('treats read failures as missing values rather than throwing', async () => {
    const broken = {
      get: () => Promise.reject(new Error('storage offline')),
      set: () => Promise.reject(new Error('storage offline')),
      remove: () => Promise.reject(new Error('storage offline')),
      isAvailable: () => false,
    };

    const usage = await computeDeviceStorageUsage({
      store: broken,
      includeAudioFiles: false,
    });
    expect(usage.totalBytes).toBe(0);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [10 * 1024, '10 KB'],
    [1024 * 1024, '1 MB'],
    [5.5 * 1024 * 1024, '5.5 MB'],
  ])('formats %i as %s', (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });
});