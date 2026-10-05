import { create } from 'zustand';
import { localKeyValueStore } from '../storage/localKeyValueStore';
import {
  isThreadPinned,
  ThreadPinRepository,
  type ThreadPinMap,
} from './threadPinning';

const repository = new ThreadPinRepository(localKeyValueStore);
let hydratePromise: Promise<void> | null = null;

interface ThreadPinStore {
  pinnedAtByThreadId: ThreadPinMap;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  pinThread: (threadId: string) => Promise<void>;
  unpinThread: (threadId: string) => Promise<void>;
  removeThreads: (threadIds: readonly string[]) => Promise<ThreadPinMap>;
  restoreThreads: (pins: ThreadPinMap) => Promise<void>;
}

export const useThreadPinStore = create<ThreadPinStore>((set, get) => ({
  pinnedAtByThreadId: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (!hydratePromise) {
      hydratePromise = repository
        .load()
        .then((pinnedAtByThreadId) => {
          set({ pinnedAtByThreadId, hydrated: true });
        })
        .finally(() => {
          hydratePromise = null;
        });
    }
    await hydratePromise;
  },

  pinThread: async (threadId) => {
    if (!threadId.trim()) return;
    await get().hydrate();
    const previous = get().pinnedAtByThreadId;
    if (isThreadPinned(previous, threadId)) return;

    const next: ThreadPinMap = {
      ...previous,
      [threadId]: new Date().toISOString(),
    };
    set({ pinnedAtByThreadId: next });
    try {
      await repository.save(next);
    } catch (error) {
      if (get().pinnedAtByThreadId === next) {
        set({ pinnedAtByThreadId: previous });
      }
      throw error;
    }
  },

  unpinThread: async (threadId) => {
    await get().hydrate();
    const previous = get().pinnedAtByThreadId;
    if (!isThreadPinned(previous, threadId)) return;

    const next = { ...previous };
    delete next[threadId];
    set({ pinnedAtByThreadId: next });
    try {
      await repository.save(next);
    } catch (error) {
      if (get().pinnedAtByThreadId === next) {
        set({ pinnedAtByThreadId: previous });
      }
      throw error;
    }
  },

  removeThreads: async (threadIds) => {
    await get().hydrate();
    const ids = new Set(threadIds.filter((threadId) => threadId.trim().length > 0));
    const previous = get().pinnedAtByThreadId;
    const removed: ThreadPinMap = {};
    const next = { ...previous };
    for (const threadId of ids) {
      if (!isThreadPinned(previous, threadId)) continue;
      removed[threadId] = previous[threadId];
      delete next[threadId];
    }
    if (Object.keys(removed).length === 0) return removed;

    set({ pinnedAtByThreadId: next });
    try {
      await repository.save(next);
      return removed;
    } catch (error) {
      if (get().pinnedAtByThreadId === next) {
        set({ pinnedAtByThreadId: previous });
      }
      throw error;
    }
  },

  restoreThreads: async (pins) => {
    if (Object.keys(pins).length === 0) return;
    await get().hydrate();
    const previous = get().pinnedAtByThreadId;
    const next = { ...previous, ...pins };
    set({ pinnedAtByThreadId: next });
    try {
      await repository.save(next);
    } catch (error) {
      if (get().pinnedAtByThreadId === next) {
        set({ pinnedAtByThreadId: previous });
      }
      throw error;
    }
  },
}));
