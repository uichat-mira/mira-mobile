import { create } from 'zustand';
import { localKeyValueStore } from '../storage/localKeyValueStore';
import {
  isThreadPinned,
  ThreadPinRepository,
  type ThreadPinMap,
} from './threadPinning';
import {
  filterUnfencedThreadReferences,
  isThreadReferenceMutationFenced,
  removeThreadReferences,
  restoreThreadReferences,
} from './threadReferenceMutationFence';
import { persistOptimisticThreadReferenceMap } from './threadReferencePersistence';

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
          set({
            pinnedAtByThreadId:
              filterUnfencedThreadReferences(pinnedAtByThreadId),
            hydrated: true,
          });
        })
        .finally(() => {
          hydratePromise = null;
        });
    }
    await hydratePromise;
  },

  pinThread: async (threadId) => {
    if (!threadId.trim()) return;
    if (isThreadReferenceMutationFenced(threadId)) return;
    await get().hydrate();
    const previous = get().pinnedAtByThreadId;
    if (isThreadPinned(previous, threadId)) return;

    const next: ThreadPinMap = {
      ...previous,
      [threadId]: new Date().toISOString(),
    };
    await persistOptimisticThreadReferenceMap(
      previous,
      next,
      (value) => set({ pinnedAtByThreadId: value }),
      () => get().pinnedAtByThreadId,
      (value) => repository.save(value),
    );
  },

  unpinThread: async (threadId) => {
    if (isThreadReferenceMutationFenced(threadId)) return;
    await get().hydrate();
    const previous = get().pinnedAtByThreadId;
    if (!isThreadPinned(previous, threadId)) return;

    const next = { ...previous };
    delete next[threadId];
    await persistOptimisticThreadReferenceMap(
      previous,
      next,
      (value) => set({ pinnedAtByThreadId: value }),
      () => get().pinnedAtByThreadId,
      (value) => repository.save(value),
    );
  },

  removeThreads: async (threadIds) => {
    await get().hydrate();
    const previous = get().pinnedAtByThreadId;
    const { next, removed } = removeThreadReferences(previous, threadIds);
    if (Object.keys(removed).length === 0) return removed;

    await persistOptimisticThreadReferenceMap(
      previous,
      next,
      (value) => set({ pinnedAtByThreadId: value }),
      () => get().pinnedAtByThreadId,
      (value) => repository.save(value),
    );
    return removed;
  },

  restoreThreads: async (pins) => {
    if (Object.keys(pins).length === 0) return;
    await get().hydrate();
    const previous = get().pinnedAtByThreadId;
    const next = restoreThreadReferences(previous, pins);
    await persistOptimisticThreadReferenceMap(
      previous,
      next,
      (value) => set({ pinnedAtByThreadId: value }),
      () => get().pinnedAtByThreadId,
      (value) => repository.save(value),
    );
  },
}));
