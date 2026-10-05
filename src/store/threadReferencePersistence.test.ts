import { persistOptimisticThreadReferenceMap } from './threadReferencePersistence';

describe('persistOptimisticThreadReferenceMap', () => {
  it('keeps the optimistic value when persistence succeeds', async () => {
    const previous = { a: 1 };
    const next = { a: 2 };
    let current: Record<string, number> = previous;

    await persistOptimisticThreadReferenceMap(
      previous,
      next,
      (value) => {
        current = value;
      },
      () => current,
      async () => undefined,
    );

    expect(current).toBe(next);
  });

  it('rolls back when persistence fails and no newer state replaced it', async () => {
    const previous = { a: 1 };
    const next = { a: 2 };
    let current: Record<string, number> = previous;

    await expect(
      persistOptimisticThreadReferenceMap(
        previous,
        next,
        (value) => {
          current = value;
        },
        () => current,
        async () => {
          throw new Error('persist failed');
        },
      ),
    ).rejects.toThrow('persist failed');

    expect(current).toBe(previous);
  });

  it('does not clobber a newer concurrent state when persistence fails', async () => {
    const previous = { a: 1 };
    const next = { a: 2 };
    const newer = { a: 3 };
    let current: Record<string, number> = previous;

    await expect(
      persistOptimisticThreadReferenceMap(
        previous,
        next,
        (value) => {
          current = value;
        },
        () => current,
        async () => {
          current = newer;
          throw new Error('persist failed');
        },
      ),
    ).rejects.toThrow('persist failed');

    expect(current).toBe(newer);
  });
});
