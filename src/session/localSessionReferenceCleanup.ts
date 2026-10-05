import type { ThreadPinMap } from '../store/threadPinning';
import type { ThreadReadMap } from '../store/threadReadState';
import { useThreadPinStore } from '../store/threadPinStore';
import { useThreadReadStore } from '../store/threadReadStore';
import {
  loadLastOpenedSession,
  removeLastOpenedSessions,
  saveLastOpenedSession,
  type LastOpenedSession,
} from './lastOpenedSession';

export interface LocalSessionReferenceSnapshot {
  pins: ThreadPinMap;
  readProgress: ThreadReadMap;
  lastOpened: LastOpenedSession | null;
}

export interface LocalSessionReferenceCleanupDependencies {
  removePins(threadIds: readonly string[]): Promise<ThreadPinMap>;
  restorePins(pins: ThreadPinMap): Promise<void>;
  readPins(): Promise<ThreadPinMap>;
  removeReadProgress(threadIds: readonly string[]): Promise<ThreadReadMap>;
  restoreReadProgress(progress: ThreadReadMap): Promise<void>;
  readReadProgress(): Promise<ThreadReadMap>;
  removeLastOpened(threadIds: readonly string[]): Promise<LastOpenedSession | null>;
  restoreLastOpened(record: LastOpenedSession): Promise<void>;
  loadLastOpened(): Promise<LastOpenedSession | null>;
}

const defaultDependencies: LocalSessionReferenceCleanupDependencies = {
  removePins: (threadIds) => useThreadPinStore.getState().removeThreads(threadIds),
  restorePins: (pins) => useThreadPinStore.getState().restoreThreads(pins),
  readPins: async () => {
    await useThreadPinStore.getState().hydrate();
    return { ...useThreadPinStore.getState().pinnedAtByThreadId };
  },
  removeReadProgress: (threadIds) =>
    useThreadReadStore.getState().removeThreads(threadIds),
  restoreReadProgress: (progress) =>
    useThreadReadStore.getState().restoreThreads(progress),
  readReadProgress: async () => {
    await useThreadReadStore.getState().hydrate();
    return { ...useThreadReadStore.getState().progressByThreadId };
  },
  removeLastOpened: (threadIds) => removeLastOpenedSessions(threadIds),
  restoreLastOpened: (record) => saveLastOpenedSession(record),
  loadLastOpened: () => loadLastOpenedSession(),
};

const restoreSnapshot = async (
  snapshot: LocalSessionReferenceSnapshot,
  dependencies: LocalSessionReferenceCleanupDependencies,
): Promise<void> => {
  const operations: Promise<void>[] = [
    dependencies.restorePins(snapshot.pins),
    dependencies.restoreReadProgress(snapshot.readProgress),
  ];
  if (snapshot.lastOpened) {
    operations.push(dependencies.restoreLastOpened(snapshot.lastOpened));
  }

  const results = await Promise.allSettled(operations);
  if (results.some((result) => result.status === 'rejected')) {
    throw new Error('本地会话引用回滚未完整完成。');
  }

  const [pins, readProgress, lastOpened] = await Promise.all([
    dependencies.readPins(),
    dependencies.readReadProgress(),
    dependencies.loadLastOpened(),
  ]);
  const pinsRestored = Object.entries(snapshot.pins).every(
    ([threadId, pinnedAt]) => pins[threadId] === pinnedAt,
  );
  const readsRestored = Object.entries(snapshot.readProgress).every(
    ([threadId, progress]) =>
      JSON.stringify(readProgress[threadId]) === JSON.stringify(progress),
  );
  const lastOpenedRestored =
    snapshot.lastOpened === null ||
    JSON.stringify(lastOpened) === JSON.stringify(snapshot.lastOpened);

  if (!pinsRestored || !readsRestored || !lastOpenedRestored) {
    throw new Error('本地会话引用回滚未完整完成。');
  }
};

/**
 * Removes device-local references before a destructive Provider cascade.
 *
 * The returned callback restores the exact removed reference state when the
 * later canonical Provider/session commit fails. A cleanup failure is rolled
 * back here before it escapes, so the caller never commits canonical deletion
 * after a partially prepared reference cleanup.
 */
export async function stageLocalSessionReferenceRemoval(
  sessionIds: readonly string[],
  dependencies: LocalSessionReferenceCleanupDependencies = defaultDependencies,
): Promise<() => Promise<void>> {
  const normalizedIds = [...new Set(sessionIds.filter((sessionId) => sessionId.trim().length > 0))];
  if (normalizedIds.length === 0) {
    return async () => undefined;
  }

  const snapshot: LocalSessionReferenceSnapshot = {
    pins: {},
    readProgress: {},
    lastOpened: null,
  };
  let pinsRemoved = false;
  let readProgressRemoved = false;
  let lastOpenedRemoved = false;

  try {
    snapshot.pins = await dependencies.removePins(normalizedIds);
    pinsRemoved = true;
    snapshot.readProgress = await dependencies.removeReadProgress(normalizedIds);
    readProgressRemoved = true;
    snapshot.lastOpened = await dependencies.removeLastOpened(normalizedIds);
    lastOpenedRemoved = snapshot.lastOpened !== null;
  } catch (error) {
    const rollback: Promise<void>[] = [];
    if (pinsRemoved) rollback.push(dependencies.restorePins(snapshot.pins));
    if (readProgressRemoved) {
      rollback.push(dependencies.restoreReadProgress(snapshot.readProgress));
    }
    if (lastOpenedRemoved && snapshot.lastOpened) {
      rollback.push(dependencies.restoreLastOpened(snapshot.lastOpened));
    }
    const rollbackResults = await Promise.allSettled(rollback);
    if (rollbackResults.some((result) => result.status === 'rejected')) {
      throw new Error('无法安全清理本地会话引用，且回滚未完整完成。');
    }
    throw error;
  }

  return () => restoreSnapshot(snapshot, dependencies);
}
