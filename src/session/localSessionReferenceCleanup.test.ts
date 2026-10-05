import type { ThreadPinMap } from '../store/threadPinning';
import type { ThreadReadMap } from '../store/threadReadState';
import type { LastOpenedSession } from './lastOpenedSession';
import {
  stageLocalSessionReferenceRemoval,
  type LocalSessionReferenceCleanupDependencies,
} from './localSessionReferenceCleanup';

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
  const dependencies: LocalSessionReferenceCleanupDependencies = {
    removePins: jest.fn(async () => removedPins),
    restorePins: jest.fn(async () => undefined),
    removeReadProgress: jest.fn(async () => removedReadProgress),
    restoreReadProgress: jest.fn(async () => undefined),
    removeLastOpened: jest.fn(async () => lastOpened),
    restoreLastOpened: jest.fn(async () => undefined),
  };
  return { dependencies, removedPins, removedReadProgress };
};

describe('localSessionReferenceCleanup', () => {
  it('stages exact session references and exposes a rollback callback', async () => {
    const { dependencies, removedPins, removedReadProgress } = makeDependencies();

    const rollback = await stageLocalSessionReferenceRemoval(
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

    await rollback();

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

  it('does not touch reference stores for a zero-session cascade', async () => {
    const { dependencies } = makeDependencies();

    const rollback = await stageLocalSessionReferenceRemoval([], dependencies);
    await rollback();

    expect(dependencies.removePins).not.toHaveBeenCalled();
    expect(dependencies.removeReadProgress).not.toHaveBeenCalled();
    expect(dependencies.removeLastOpened).not.toHaveBeenCalled();
    expect(dependencies.restorePins).not.toHaveBeenCalled();
  });
});
