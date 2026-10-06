import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  recordingAdapter,
  type CompletedRecording,
  type RecordingAdapter,
  type RecordingSnapshot,
} from './RecordingAdapter';
import {
  localCaptureRepository,
  type LocalCaptureMetadata,
} from './localCaptureRepository';

export interface ShiyanRecordingSessionScene {
  sceneId: string;
  sceneName: string;
}

export interface ShiyanRecordingSessionDeps {
  adapter: RecordingAdapter;
  saveCompleted(input: {
    id: string;
    sceneId: string;
    sceneName: string;
    recording: CompletedRecording;
  }): Promise<LocalCaptureMetadata>;
  createRecordingId(): string;
}

export type ShiyanRecordingStartResult =
  | { status: 'started' }
  | { status: 'denied' }
  | { status: 'blocked' }
  | { status: 'unavailable' }
  | { status: 'failed'; message: string };

export type ShiyanRecordingStopResult =
  | { status: 'completed'; captureId: string }
  | { status: 'failed'; message: string };

export interface ShiyanRecordingSession {
  snapshot: RecordingSnapshot;
  active: boolean;
  hasActiveSession: boolean;
  busy: boolean;
  start(): Promise<ShiyanRecordingStartResult>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<ShiyanRecordingStopResult>;
  cancel(): Promise<void>;
  openPermissionSettings(): Promise<void>;
}

// Singletons are resolved at call time (not captured) so tests can replace them
// after module import, matching the task-detail orchestration convention.
let recordingIdSequence = 0;

export const createShiyanRecordingId = (): string => {
  recordingIdSequence += 1;
  return `capture_${Date.now().toString(36)}_${recordingIdSequence.toString(36)}`;
};

const createDefaultDeps = (): ShiyanRecordingSessionDeps => ({
  adapter: recordingAdapter,
  saveCompleted: input => localCaptureRepository.saveCompleted(input),
  createRecordingId: createShiyanRecordingId,
});

const recordingIdFromFilePath = (filePath: string): string | null =>
  filePath.split('/').pop()?.replace(/\.m4a$/i, '') || null;

/**
 * Owns the Shiyan recording session lifecycle: permission, start/pause/resume/
 * stop/cancel, the adapter snapshot subscription (with unmount cleanup) and the
 * single completed-capture persistence handoff after a successful stop.
 *
 * The screen keeps only rendering, navigation and the permission/confirmation
 * alert copy. Persistence happens exactly once per stop; a re-entrant stop
 * returns the in-flight result instead of saving a second capture.
 */
export const useShiyanRecordingSession = (
  scene: ShiyanRecordingSessionScene,
  deps?: ShiyanRecordingSessionDeps,
): ShiyanRecordingSession => {
  const resolvedDeps = useMemo(() => deps ?? createDefaultDeps(), [deps]);
  const depsRef = useRef(resolvedDeps);
  depsRef.current = resolvedDeps;

  const [snapshot, setSnapshot] = useState<RecordingSnapshot>(() =>
    resolvedDeps.adapter.getSnapshot(),
  );
  const [busy, setBusy] = useState(false);
  const stopInFlight = useRef<Promise<ShiyanRecordingStopResult> | null>(null);

  useEffect(() => resolvedDeps.adapter.subscribe(setSnapshot), [resolvedDeps.adapter]);

  const active = snapshot.state === 'recording' || snapshot.state === 'paused';
  const hasActiveSession = snapshot.state !== 'idle';

  const start = useCallback(async (): Promise<ShiyanRecordingStartResult> => {
    setBusy(true);
    try {
      const permission = await depsRef.current.adapter.requestPermission();
      if (permission !== 'granted') {
        if (permission === 'blocked') return { status: 'blocked' };
        if (permission === 'unavailable') return { status: 'unavailable' };
        return { status: 'denied' };
      }
      await depsRef.current.adapter.start(depsRef.current.createRecordingId());
      return { status: 'started' };
    } catch (error) {
      return {
        status: 'failed',
        message: error instanceof Error ? error.message : '请稍后重试。',
      };
    } finally {
      setBusy(false);
    }
  }, []);

  const pause = useCallback(async () => {
    await depsRef.current.adapter.pause();
  }, []);

  const resume = useCallback(async () => {
    await depsRef.current.adapter.resume();
  }, []);

  const stop = useCallback((): Promise<ShiyanRecordingStopResult> => {
    if (stopInFlight.current) return stopInFlight.current;
    const run = (async (): Promise<ShiyanRecordingStopResult> => {
      setBusy(true);
      try {
        const recording = await depsRef.current.adapter.stop();
        const id =
          recordingIdFromFilePath(recording.filePath) ?? depsRef.current.createRecordingId();
        const capture = await depsRef.current.saveCompleted({
          id,
          sceneId: scene.sceneId,
          sceneName: scene.sceneName,
          recording,
        });
        return { status: 'completed', captureId: capture.id };
      } catch (error) {
        return {
          status: 'failed',
          message: error instanceof Error ? error.message : '本地录音未能可靠保存。',
        };
      } finally {
        setBusy(false);
      }
    })();
    stopInFlight.current = run;
    void run.finally(() => {
      stopInFlight.current = null;
    });
    return run;
  }, [scene.sceneId, scene.sceneName]);

  const cancel = useCallback(async () => {
    await depsRef.current.adapter.cancel();
  }, []);

  const openPermissionSettings = useCallback(async () => {
    await depsRef.current.adapter.openPermissionSettings();
  }, []);

  return {
    snapshot,
    active,
    hasActiveSession,
    busy,
    start,
    pause,
    resume,
    stop,
    cancel,
    openPermissionSettings,
  };
};
