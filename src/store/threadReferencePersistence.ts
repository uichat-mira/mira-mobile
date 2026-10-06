export async function persistOptimisticThreadReferenceMap<T>(
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
