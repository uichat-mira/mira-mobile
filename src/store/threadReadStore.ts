import { create } from 'zustand';
import type { ChatMessage, Session } from '../types';
import { miraHostClient } from '../api/miraHostClient';
import { RemoteHostError } from '../api/remoteHttp';
import { localKeyValueStore } from '../storage/localKeyValueStore';
import {
  filterUnfencedThreadReferences,
  isThreadReferenceMutationFenced,
  removeThreadReferences,
  restoreThreadReferences,
} from './threadReferenceMutationFence';
import {
  isThreadUnread,
  markThreadMessagesRead,
  needsThreadObservation,
  observeThreadMessages,
  ThreadReadRepository,
  type ThreadReadMap,
} from './threadReadState';

const repository = new ThreadReadRepository(localKeyValueStore);
let hydratePromise: Promise<void> | null = null;
const inFlightObservations = new Map<string, Promise<void>>();

interface ThreadReadStore {
  progressByThreadId: ThreadReadMap;
  hydrated: boolean;
  hydrationError: string | null;
  hydrate: () => Promise<void>;
  observeThread: (
    threadId: string,
    messages: ChatMessage[],
    observedMessageCount: number,
  ) => Promise<void>;
  markThreadRead: (
    threadId: string,
    messages: ChatMessage[],
    observedMessageCount: number,
  ) => Promise<void>;
  clearThread: (threadId: string) => Promise<void>;
  removeThreads: (threadIds: readonly string[]) => Promise<ThreadReadMap>;
  restoreThreads: (progress: ThreadReadMap) => Promise<void>;
  syncSessions: (sessions: Session[]) => Promise<void>;
}

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message
    ? error.message
    : 'Unable to read local thread state';

export const useThreadReadStore = create<ThreadReadStore>((set, get) => ({
  progressByThreadId: {},
  hydrated: false,
  hydrationError: null,

  hydrate: async () => {
    if (get().hydrated) return;
    if (!hydratePromise) {
      hydratePromise = repository
        .load()
        .then((progressByThreadId) => {
          set({
            progressByThreadId:
              filterUnfencedThreadReferences(progressByThreadId),
            hydrated: true,
            hydrationError: null,
          });
        })
        .catch((error) => {
          set({ hydrationError: errorMessage(error) });
          throw error;
        })
        .finally(() => {
          hydratePromise = null;
        });
    }
    await hydratePromise;
  },

  observeThread: async (threadId, messages, observedMessageCount) => {
    if (!threadId.trim()) return;
    if (isThreadReferenceMutationFenced(threadId)) return;
    await get().hydrate();
    const previousMap = get().progressByThreadId;
    const previous = previousMap[threadId];
    const nextProgress = observeThreadMessages(
      previous,
      messages,
      observedMessageCount,
    );
    const nextMap = { ...previousMap, [threadId]: nextProgress };
    set({ progressByThreadId: nextMap });
    try {
      await repository.save(nextMap);
    } catch (error) {
      if (get().progressByThreadId === nextMap) {
        set({ progressByThreadId: previousMap });
      }
      throw error;
    }
  },

  markThreadRead: async (threadId, messages, observedMessageCount) => {
    if (!threadId.trim()) return;
    if (isThreadReferenceMutationFenced(threadId)) return;
    await get().hydrate();
    const previousMap = get().progressByThreadId;
    const previous = previousMap[threadId];
    const nextProgress = markThreadMessagesRead(
      previous,
      messages,
      observedMessageCount,
    );
    const nextMap = { ...previousMap, [threadId]: nextProgress };
    set({ progressByThreadId: nextMap });
    try {
      await repository.save(nextMap);
    } catch (error) {
      if (get().progressByThreadId === nextMap) {
        set({ progressByThreadId: previousMap });
      }
      throw error;
    }
  },

  clearThread: async (threadId) => {
    if (isThreadReferenceMutationFenced(threadId)) return;
    await get().hydrate();
    const previousMap = get().progressByThreadId;
    if (!previousMap[threadId]) return;
    const nextMap = { ...previousMap };
    delete nextMap[threadId];
    set({ progressByThreadId: nextMap });
    try {
      await repository.save(nextMap);
    } catch (error) {
      if (get().progressByThreadId === nextMap) {
        set({ progressByThreadId: previousMap });
      }
      throw error;
    }
  },

  removeThreads: async (threadIds) => {
    await get().hydrate();
    const previousMap = get().progressByThreadId;
    const { next: nextMap, removed } =
      removeThreadReferences(previousMap, threadIds);
    if (Object.keys(removed).length === 0) return removed;

    set({ progressByThreadId: nextMap });
    try {
      await repository.save(nextMap);
      return removed;
    } catch (error) {
      if (get().progressByThreadId === nextMap) {
        set({ progressByThreadId: previousMap });
      }
      throw error;
    }
  },

  restoreThreads: async (progress) => {
    if (Object.keys(progress).length === 0) return;
    await get().hydrate();
    const previousMap = get().progressByThreadId;
    const nextMap = restoreThreadReferences(previousMap, progress);
    set({ progressByThreadId: nextMap });
    try {
      await repository.save(nextMap);
    } catch (error) {
      if (get().progressByThreadId === nextMap) {
        set({ progressByThreadId: previousMap });
      }
      throw error;
    }
  },

  syncSessions: async (sessions) => {
    await get().hydrate();
    const candidates = sessions.filter((session) =>
      needsThreadObservation(
        get().progressByThreadId[session.id],
        session.messageCount,
      ),
    );

    const observeOne = (session: Session): Promise<void> => {
      const existing = inFlightObservations.get(session.id);
      if (existing) return existing;

      const operation = (async () => {
        try {
          const messages = await miraHostClient.getMessages(session.id);
          await get().observeThread(
            session.id,
            messages,
            session.messageCount ?? messages.length,
          );
        } catch (error) {
          if (error instanceof RemoteHostError && error.status === 404) {
            try {
              await get().clearThread(session.id);
            } catch {
              // A failed local cleanup must not turn a Host read into false state.
            }
          }
          // Network, offline, 401 and 403 preserve the previous local progress.
        } finally {
          inFlightObservations.delete(session.id);
        }
      })();

      inFlightObservations.set(session.id, operation);
      return operation;
    };

    // Keep the initial device sync bounded instead of issuing one request per
    // thread at once. Later refreshes normally touch only changed messageCount.
    for (let index = 0; index < candidates.length; index += 4) {
      await Promise.all(candidates.slice(index, index + 4).map(observeOne));
    }
  },
}));

export const selectThreadUnread = (
  progressByThreadId: ThreadReadMap,
  threadId: string,
) => isThreadUnread(progressByThreadId[threadId]);
