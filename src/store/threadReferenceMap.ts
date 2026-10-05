import { isThreadReferenceMutationFenced } from './threadReferenceMutationFence';

export interface ThreadMapRemoval<T> {
  next: Record<string, T>;
  removed: Record<string, T>;
}

export const normalizeThreadIds = (threadIds: readonly string[]): string[] =>
  [...new Set(
    threadIds
      .map((threadId) => threadId.trim())
      .filter((threadId) => threadId.length > 0),
  )];

export const removeThreadMapEntries = <T>(
  current: Record<string, T>,
  threadIds: readonly string[],
): ThreadMapRemoval<T> => {
  const next = { ...current };
  const removed: Record<string, T> = {};

  for (const threadId of normalizeThreadIds(threadIds)) {
    if (!Object.prototype.hasOwnProperty.call(current, threadId)) continue;
    removed[threadId] = current[threadId];
    delete next[threadId];
  }

  return { next, removed };
};

export const mergeThreadMapEntries = <T>(
  current: Record<string, T>,
  restored: Record<string, T>,
): Record<string, T> => ({ ...current, ...restored });

export const filterFencedThreadMapEntries = <T>(
  current: Record<string, T>,
): Record<string, T> =>
  Object.fromEntries(
    Object.entries(current).filter(
      ([threadId]) => !isThreadReferenceMutationFenced(threadId),
    ),
  ) as Record<string, T>;

export async function persistOptimisticThreadMap<T>(
  previous: Record<string, T>,
  next: Record<string, T>,
  apply: (value: Record<string, T>) => void,
  current: () => Record<string, T>,
  persist: (value: Record<string, T>) => Promise<void>,
): Promise<void> {
  apply(next);
  try {
    await persist(next);
  } catch (error) {
    if (current() === next) {
      apply(previous);
    }
    throw error;
  }
}
