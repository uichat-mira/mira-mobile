import type { ConnectionStatus } from '../types';
import {
  createAppLifecycleController,
  type AppLifecycleDeps,
} from './appLifecycle';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createHarness = (
  restoreConnection: AppLifecycleDeps['restoreConnection'] = async () => ({
    connected: true,
  }),
) => {
  let connectionStatus: ConnectionStatus = 'connected';
  const setLocalExecutionSuspended = jest.fn();
  const refreshRelayConnection = jest.fn();
  const setConnectionStatus = jest.fn((status: ConnectionStatus) => {
    connectionStatus = status;
  });
  const restore = jest.fn(restoreConnection);

  const controller = createAppLifecycleController('active', {
    setLocalExecutionSuspended,
    refreshRelayConnection,
    getConnectionStatus: () => connectionStatus,
    setConnectionStatus,
    restoreConnection: restore,
  });

  return {
    controller,
    setLocalExecutionSuspended,
    refreshRelayConnection,
    setConnectionStatus,
    restore,
    getConnectionStatus: () => connectionStatus,
  };
};

describe('app lifecycle owner', () => {
  it('suspends local execution in background and restores on foreground', async () => {
    const harness = createHarness();

    harness.controller.handleStateChange('background');
    expect(harness.setLocalExecutionSuspended).toHaveBeenLastCalledWith(true);

    harness.controller.handleStateChange('active');
    expect(harness.setLocalExecutionSuspended).toHaveBeenLastCalledWith(false);
    expect(harness.refreshRelayConnection).toHaveBeenCalledTimes(1);
    expect(harness.setConnectionStatus).toHaveBeenCalledWith('reconnecting');

    await flush();

    expect(harness.restore).toHaveBeenCalledTimes(1);
    expect(harness.getConnectionStatus()).toBe('connected');
  });

  it('ignores a stale resume completion after the app backgrounds again', async () => {
    const first = deferred<unknown | null>();
    const second = deferred<unknown | null>();
    const restoreConnection = jest
      .fn<Promise<unknown | null>, []>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const harness = createHarness(restoreConnection);

    harness.controller.handleStateChange('background');
    harness.controller.handleStateChange('active');
    expect(harness.getConnectionStatus()).toBe('reconnecting');

    harness.controller.handleStateChange('background');
    first.resolve({ connected: true });
    await flush();

    expect(harness.getConnectionStatus()).toBe('reconnecting');

    harness.controller.handleStateChange('active');
    expect(restoreConnection).toHaveBeenCalledTimes(2);

    second.resolve({ connected: true });
    await flush();

    expect(harness.getConnectionStatus()).toBe('connected');
  });

  it('drops an in-flight resume completion after dispose', async () => {
    const pending = deferred<unknown | null>();
    const harness = createHarness(() => pending.promise);

    harness.controller.handleStateChange('background');
    harness.controller.handleStateChange('active');
    harness.controller.dispose();

    pending.resolve({ connected: true });
    await flush();

    expect(harness.getConnectionStatus()).toBe('reconnecting');
  });

  it('keeps a failed active resume reconnecting', async () => {
    const harness = createHarness(async () => {
      throw new Error('host unavailable');
    });

    harness.controller.handleStateChange('background');
    harness.controller.handleStateChange('active');
    await flush();

    expect(harness.getConnectionStatus()).toBe('reconnecting');
  });
});
