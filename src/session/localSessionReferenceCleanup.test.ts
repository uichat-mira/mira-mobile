import type { ThreadPinMap } from '../store/threadPinning';
import type { ThreadReadMap } from '../store/threadReadState';
import type { LastOpenedSession } from './lastOpenedSession';
import {
  stageLocalSessionReferenceRemoval,
  type LocalSessionReferenceCleanupDependencies,
} from './localSessionReferenceCleanup';
import { assertThreadReferenceMutationAllowed } from '../store/threadReferenceMutationFence';

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

    await expect(rollback()).rejects.toThrow('回滚未完整完成');
  });

  it('fences only staged session ids until the transaction settles', async () => {
    const { dependencies } = makeDependencies();

    const transaction = await stageLocalSessionReferenceRemoval(
      ['local-a'],
      dependencies,
    );

    expect(() => assertThreadReferenceMutationAllowed('local-a')).toThrow(
      'locked',
    );
    expect(() => assertThreadReferenceMutationAllowed('local-b')).not.toThrow();

    transaction.commit();

    expect(() => assertThreadReferenceMutationAllowed('local-a')).not.toThrow();
  });

  it('does not touch reference stores for a zero-session cascade', async () => {
    const { dependencies } = makeDependencies();

    const transaction = await stageLocalSessionReferenceRemoval([], dependencies);
    transaction.commit();

    expect(dependencies.removePins).not.toHaveBeenCalled();
    expect(dependencies.removeReadProgress).not.toHaveBeenCalled();
    expect(dependencies.removeLastOpened).not.toHaveBeenCalled();
    expect(dependencies.restorePins).not.toHaveBeenCalled();
  });
});
