import type { ThreadPinMap } from '../store/threadPinning';
import type { ThreadReadMap } from '../store/threadReadState';
import type { LastOpenedSession } from './lastOpenedSession';
import {
  stageLocalSessionReferenceRemoval,
  type LocalSessionReferenceCleanupDependencies,
} from './localSessionReferenceCleanup';
import { isThreadReferenceMutationFenced } from '../store/threadReferenceMutationFence';

const lastOpened: LastOpenedSession = {
  sessionId: 'local-a',
  title: 'A',
  source: 'local-provider',
  providerName: 'Provider A',
  providerModel: 'model-a',
};

const makeDependencies = () => {
  const removedPins: ThreadPinMap = {
    'local-a': '2026-10-05T00:00:00.000Z',
  };
  const removedReadProgress: ThreadReadMap = {
    'local-a': { observedMessageCount: 1 },
  };
  let pinsState: ThreadPinMap = { ...removedPins };
  let readState: ThreadReadMap = { ...removedReadProgress };
  let lastOpenedState: LastOpenedSession | null = lastOpened;

  const dependencies: LocalSessionReferenceCleanupDependencies = {
    hydrateReferences: jest.fn(async () => undefined),
    removePins: jest.fn(async () => {
      pinsState = {};
      return removedPins;
    }),
    restorePins: jest.fn(async (pins) => {
      pinsState = { ...pinsState, ...pins };
    }),
    readPins: jest.fn(async () => ({ ...pinsState })),
    removeReadProgress: jest.fn(async () => {
      readState = {};
      return removedReadProgress;
    }),
    restoreReadProgress: jest.fn(async (progress) => {
      readState = { ...readState, ...progress };
    }),
    readReadProgress: jest.fn(async () => ({ ...readState })),
    removeLastOpened: jest.fn(async () => {
      const removed = lastOpenedState;
      lastOpenedState = null;
      return removed;
    }),
    restoreLastOpened: jest.fn(async (record) => {
      lastOpenedState = record;
    }),
    loadLastOpened: jest.fn(async () => lastOpenedState),
  };
  return { dependencies, removedPins, removedReadProgress };
};

describe('localSessionReferenceCleanup', () => {
  it('hydrates persisted references before activating the deletion fence', async () => {
    const { dependencies } = makeDependencies();
    (dependencies.hydrateReferences as jest.Mock).mockImplementationOnce(
      async () => {
        expect(isThreadReferenceMutationFenced('local-a')).toBe(false);
      },
    );
    (dependencies.removePins as jest.Mock).mockImplementationOnce(async () => {
      expect(isThreadReferenceMutationFenced('local-a')).toBe(true);
      return { 'local-a': '2026-10-05T00:00:00.000Z' };
    });

    const transaction = await stageLocalSessionReferenceRemoval(
      ['local-a'],
      dependencies,
    );

    expect(dependencies.hydrateReferences).toHaveBeenCalledTimes(1);
    transaction.commit();
  });

  it('stages exact session references and exposes a rollback callback', async () => {
    const { dependencies, removedPins, removedReadProgress } = makeDependencies();

    const transaction = await stageLocalSessionReferenceRemoval(
      ['local-a', 'local-b', 'local-a'],
      dependencies,
    );

    expect(dependencies.removePins).toHaveBeenCalledWith(['local-a', 'local-b']);
    expect(dependencies.removeReadProgress).toHaveBeenCalledWith([
      'local-a',
      'local-b',
    ]);
    expect(dependencies.removeLastOpened).toHaveBeenCalledWith([
      'local-a',
      'local-b',
    ]);

    await transaction.rollback();

    expect(dependencies.restorePins).toHaveBeenCalledWith(removedPins);
    expect(dependencies.restoreReadProgress).toHaveBeenCalledWith(
      removedReadProgress,
    );
    expect(dependencies.restoreLastOpened).toHaveBeenCalledWith(lastOpened);
  });

  it('rolls back earlier reference cleanup before surfacing a later failure', async () => {
    const { dependencies, removedPins } = makeDependencies();
    (dependencies.removeReadProgress as jest.Mock).mockRejectedValueOnce(
      new Error('read state failed'),
    );

    await expect(
      stageLocalSessionReferenceRemoval(['local-a'], dependencies),
    ).rejects.toThrow('read state failed');

    expect(dependencies.restorePins).toHaveBeenCalledWith(removedPins);
    expect(dependencies.restoreReadProgress).not.toHaveBeenCalled();
    expect(dependencies.removeLastOpened).not.toHaveBeenCalled();
  });

  it('detects a restore that resolves without restoring persisted reference state', async () => {
    const { dependencies } = makeDependencies();
    (dependencies.restorePins as jest.Mock).mockImplementationOnce(
      async () => undefined,
    );

    const transaction = await stageLocalSessionReferenceRemoval(
      ['local-a'],
      dependencies,
    );

    await expect(transaction.rollback()).rejects.toThrow('回滚未完整完成');
    expect(isThreadReferenceMutationFenced('local-a')).toBe(false);
  });

  it('ignores unrelated pin and read changes when verifying rollback', async () => {
    const { dependencies, removedPins, removedReadProgress } = makeDependencies();
    const transaction = await stageLocalSessionReferenceRemoval(
      ['local-a'],
      dependencies,
    );

    (dependencies.readPins as jest.Mock).mockResolvedValueOnce({
      ...removedPins,
      'local-b': '2026-10-05T01:00:00.000Z',
    });
    (dependencies.readReadProgress as jest.Mock).mockResolvedValueOnce({
      ...removedReadProgress,
      'local-b': { observedMessageCount: 9 },
    });

    await expect(transaction.rollback()).resolves.toBeUndefined();
  });

  it('preserves a newer unrelated last-opened record but reports incomplete rollback', async () => {
    const { dependencies } = makeDependencies();
    const transaction = await stageLocalSessionReferenceRemoval(
      ['local-a'],
      dependencies,
    );
    const concurrentLastOpened: LastOpenedSession = {
      sessionId: 'remote-new',
      title: 'New current session',
      source: 'remote-host',
      providerName: null,
      providerModel: null,
    };
    (dependencies.restoreLastOpened as jest.Mock).mockImplementationOnce(
      async () => undefined,
    );
    (dependencies.loadLastOpened as jest.Mock).mockResolvedValueOnce(
      concurrentLastOpened,
    );

    await expect(transaction.rollback()).rejects.toThrow('回滚未完整完成');
    expect(isThreadReferenceMutationFenced('local-a')).toBe(false);
  });

  it('fences only staged session ids until the transaction settles', async () => {
    const { dependencies } = makeDependencies();

    const transaction = await stageLocalSessionReferenceRemoval(
      ['local-a'],
      dependencies,
    );

    expect(isThreadReferenceMutationFenced('local-a')).toBe(true);
    expect(isThreadReferenceMutationFenced('local-b')).toBe(false);

    transaction.commit();

    expect(isThreadReferenceMutationFenced('local-a')).toBe(false);
  });

  it('does not touch reference stores for a zero-session cascade', async () => {
    const { dependencies } = makeDependencies();

    const transaction = await stageLocalSessionReferenceRemoval([], dependencies);
    transaction.commit();

    expect(dependencies.hydrateReferences).not.toHaveBeenCalled();
    expect(dependencies.removePins).not.toHaveBeenCalled();
    expect(dependencies.removeReadProgress).not.toHaveBeenCalled();
    expect(dependencies.removeLastOpened).not.toHaveBeenCalled();
    expect(dependencies.restorePins).not.toHaveBeenCalled();
  });
});
