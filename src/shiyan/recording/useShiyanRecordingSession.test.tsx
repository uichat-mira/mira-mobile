import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import type {
  CompletedRecording,
  RecordingAdapter,
  RecordingPermissionResult,
  RecordingSnapshot,
} from './RecordingAdapter';
import type { LocalCaptureMetadata } from './localCaptureRepository';
import {
  useShiyanRecordingSession,
  type ShiyanRecordingSession,
  type ShiyanRecordingSessionDeps,
} from './useShiyanRecordingSession';

const flush = async (rounds = 8): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
};

class FakeRecordingAdapter implements RecordingAdapter {
  snapshot: RecordingSnapshot = { state: 'idle', durationMs: 0 };
  readonly listeners = new Set<(snapshot: RecordingSnapshot) => void>();
  readonly calls: string[] = [];
  permission: RecordingPermissionResult = 'granted';
  startError: Error | null = null;
  readonly stopped: CompletedRecording = {
    filePath: '/private/shiyan/rec-1.m4a',
    startedAt: '2026-10-05T00:00:00.000Z',
    endedAt: '2026-10-05T00:01:00.000Z',
    durationMs: 60000,
    fileSizeBytes: 2048,
  };

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: RecordingSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async requestPermission() {
    this.calls.push('requestPermission');
    return this.permission;
  }

  async openPermissionSettings() {
    this.calls.push('openPermissionSettings');
  }

  async start(recordingId: string) {
    this.calls.push(`start:${recordingId}`);
    if (this.startError) throw this.startError;
    this.emit({ state: 'recording', durationMs: 0 });
  }

  async pause() {
    this.calls.push('pause');
    this.emit({ state: 'paused', durationMs: this.snapshot.durationMs });
  }

  async resume() {
    this.calls.push('resume');
    this.emit({ state: 'recording', durationMs: this.snapshot.durationMs });
  }

  async stop() {
    this.calls.push('stop');
    this.emit({ state: 'idle', durationMs: 0 });
    return this.stopped;
  }

  async cancel() {
    this.calls.push('cancel');
    this.emit({ state: 'idle', durationMs: 0 });
  }

  emit(snapshot: RecordingSnapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach(listener => listener(snapshot));
  }
}

const makeDeps = (overrides: Partial<ShiyanRecordingSessionDeps> = {}) => {
  const adapter = new FakeRecordingAdapter();
  const saveCompleted: jest.MockedFunction<ShiyanRecordingSessionDeps['saveCompleted']> = jest.fn(
    async input =>
      ({
        id: input.id,
        filePath: input.recording.filePath,
        sceneId: input.sceneId,
        sceneName: input.sceneName,
        title: '',
        startedAt: input.recording.startedAt,
        endedAt: input.recording.endedAt,
        durationMs: input.recording.durationMs,
        fileSizeBytes: input.recording.fileSizeBytes,
        status: 'pending_confirmation',
      }) as LocalCaptureMetadata,
  );
  const deps: ShiyanRecordingSessionDeps = {
    adapter,
    saveCompleted,
    createRecordingId: () => 'capture-fixed',
    ...overrides,
  };
  return { deps, adapter, saveCompleted };
};

let handle: ShiyanRecordingSession | null = null;
let activeRenderer: ReactTestRenderer.ReactTestRenderer | null = null;

const Probe = ({ deps }: { deps: ShiyanRecordingSessionDeps }) => {
  handle = useShiyanRecordingSession({ sceneId: 'meeting', sceneName: '会议采集' }, deps);
  return null;
};

const renderProbe = async (deps: ShiyanRecordingSessionDeps): Promise<void> => {
  await ReactTestRenderer.act(async () => {
    activeRenderer = ReactTestRenderer.create(<Probe deps={deps} />);
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
});

describe('useShiyanRecordingSession lifecycle', () => {
  it('subscribes on mount and unsubscribes on unmount', async () => {
    const { deps, adapter } = makeDeps();
    await renderProbe(deps);
    expect(adapter.listeners.size).toBe(1);

    ReactTestRenderer.act(() => {
      activeRenderer?.unmount();
    });
    activeRenderer = null;

    expect(adapter.listeners.size).toBe(0);
  });

  it('reports blocked and unavailable permissions without starting the recorder', async () => {
    const blocked = makeDeps();
    blocked.adapter.permission = 'blocked';
    await renderProbe(blocked.deps);

    let result: Awaited<ReturnType<ShiyanRecordingSession['start']>> | undefined;
    await ReactTestRenderer.act(async () => {
      result = await handle?.start();
    });
    expect(result).toEqual({ status: 'blocked' });
    expect(blocked.adapter.calls).not.toContain('start:capture-fixed');
  });

  it('reports a denied permission as a distinct result', async () => {
    const { deps, adapter } = makeDeps();
    adapter.permission = 'denied';
    await renderProbe(deps);

    let result: Awaited<ReturnType<ShiyanRecordingSession['start']>> | undefined;
    await ReactTestRenderer.act(async () => {
      result = await handle?.start();
    });
    expect(result).toEqual({ status: 'denied' });
    expect(adapter.calls).not.toContain('start:capture-fixed');
  });

  it('starts a recording with the generated id once permission is granted', async () => {
    const { deps, adapter } = makeDeps();
    await renderProbe(deps);

    let result: Awaited<ReturnType<ShiyanRecordingSession['start']>> | undefined;
    await ReactTestRenderer.act(async () => {
      result = await handle?.start();
    });

    expect(result).toEqual({ status: 'started' });
    expect(adapter.calls).toContain('start:capture-fixed');
    expect(handle?.snapshot.state).toBe('recording');
    expect(handle?.active).toBe(true);
    expect(handle?.busy).toBe(false);
  });

  it('surfaces a start failure and clears the busy flag', async () => {
    const { deps, adapter } = makeDeps();
    adapter.startError = new Error('麦克风被占用');
    await renderProbe(deps);

    let result: Awaited<ReturnType<ShiyanRecordingSession['start']>> | undefined;
    await ReactTestRenderer.act(async () => {
      result = await handle?.start();
    });

    expect(result).toEqual({ status: 'failed', message: '麦克风被占用' });
    expect(handle?.busy).toBe(false);
  });

  it('persists exactly one completed capture on stop using the recording file id', async () => {
    const { deps, adapter, saveCompleted } = makeDeps();
    await renderProbe(deps);
    ReactTestRenderer.act(() => {
      adapter.emit({ state: 'recording', durationMs: 1000 });
    });

    let result: Awaited<ReturnType<ShiyanRecordingSession['stop']>> | undefined;
    await ReactTestRenderer.act(async () => {
      result = await handle?.stop();
    });

    expect(result).toEqual({ status: 'completed', captureId: 'rec-1' });
    expect(saveCompleted).toHaveBeenCalledTimes(1);
    expect(saveCompleted).toHaveBeenCalledWith({
      id: 'rec-1',
      sceneId: 'meeting',
      sceneName: '会议采集',
      recording: adapter.stopped,
    });
    expect(handle?.snapshot.state).toBe('idle');
    expect(handle?.busy).toBe(false);
  });

  it('returns the in-flight result instead of persisting a second capture on re-entrant stop', async () => {
    const { deps, adapter, saveCompleted } = makeDeps();
    await renderProbe(deps);
    ReactTestRenderer.act(() => {
      adapter.emit({ state: 'recording', durationMs: 1000 });
    });

    let first: ReturnType<ShiyanRecordingSession['stop']> | undefined;
    let second: ReturnType<ShiyanRecordingSession['stop']> | undefined;
    await ReactTestRenderer.act(async () => {
      first = handle?.stop();
      second = handle?.stop();
      await Promise.all([first, second]);
    });

    expect(second).toBe(first);
    expect(saveCompleted).toHaveBeenCalledTimes(1);
  });

  it('cancels an active session without persisting a draft', async () => {
    const { deps, adapter, saveCompleted } = makeDeps();
    await renderProbe(deps);
    ReactTestRenderer.act(() => {
      adapter.emit({ state: 'recording', durationMs: 1000 });
    });

    await ReactTestRenderer.act(async () => {
      await handle?.cancel();
    });

    expect(adapter.calls).toContain('cancel');
    expect(saveCompleted).not.toHaveBeenCalled();
    expect(handle?.snapshot.state).toBe('idle');
  });

  it('tracks whether a session is active from the adapter snapshot', async () => {
    const { deps, adapter } = makeDeps();
    await renderProbe(deps);
    expect(handle?.hasActiveSession).toBe(false);

    ReactTestRenderer.act(() => {
      adapter.emit({ state: 'paused', durationMs: 500 });
    });
    expect(handle?.hasActiveSession).toBe(true);
    expect(handle?.active).toBe(true);
  });

  it('delegates openPermissionSettings to the adapter', async () => {
    const { deps, adapter } = makeDeps();
    await renderProbe(deps);

    await ReactTestRenderer.act(async () => {
      await handle?.openPermissionSettings();
    });

    expect(adapter.calls).toContain('openPermissionSettings');
  });
});
