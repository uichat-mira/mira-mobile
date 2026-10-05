const fencedThreadIds = new Map<string, number>();

export const beginThreadReferenceMutationFence = (
  threadIds: readonly string[],
): (() => void) => {
  const ids = [...new Set(
    threadIds
      .map((threadId) => threadId.trim())
      .filter((threadId) => threadId.length > 0),
  )];

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

export const assertThreadReferenceMutationAllowed = (threadId: string): void => {
  if (fencedThreadIds.has(threadId.trim())) {
    throw new Error('Thread reference is locked for Local Provider deletion');
  }
};
