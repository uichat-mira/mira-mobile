const fencedThreadIds = new Map<string, number>();

const normalizeThreadIds = (threadIds: readonly string[]): string[] =>
  [...new Set(
    threadIds
      .map((threadId) => threadId.trim())
      .filter((threadId) => threadId.length > 0),
  )];

export const beginThreadReferenceMutationFence = (
  threadIds: readonly string[],
): (() => void) => {
  const ids = normalizeThreadIds(threadIds);

  for (const threadId of ids) {
    fencedThreadIds.set(threadId, (fencedThreadIds.get(threadId) ?? 0) + 1);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const threadId of ids) {
      const next = (fencedThreadIds.get(threadId) ?? 1) - 1;
      if (next <= 0) {
        fencedThreadIds.delete(threadId);
      } else {
        fencedThreadIds.set(threadId, next);
      }
    }
  };
};

export const isThreadReferenceMutationFenced = (threadId: string): boolean =>
  fencedThreadIds.has(threadId.trim());

export const filterUnfencedThreadReferences = <T>(
  values: Readonly<Record<string, T>>,
): Record<string, T> =>
  Object.fromEntries(
    Object.entries(values).filter(
      ([threadId]) => !isThreadReferenceMutationFenced(threadId),
    ),
  );

export const removeThreadReferences = <T>(
  values: Readonly<Record<string, T>>,
  threadIds: readonly string[],
): { next: Record<string, T>; removed: Record<string, T> } => {
  const next = { ...values };
  const removed: Record<string, T> = {};

  for (const threadId of normalizeThreadIds(threadIds)) {
    if (!(threadId in values)) continue;
    removed[threadId] = values[threadId];
    delete next[threadId];
  }

  return { next, removed };
};

export const restoreThreadReferences = <T>(
  values: Readonly<Record<string, T>>,
  restored: Readonly<Record<string, T>>,
): Record<string, T> => ({
  ...values,
  ...restored,
});
