import type { ConnectionStatus } from '../types';

export interface AppLifecycleDeps {
  setLocalExecutionSuspended(suspended: boolean): void;
  refreshRelayConnection(): void;
  getConnectionStatus(): ConnectionStatus;
  setConnectionStatus(status: ConnectionStatus): void;
  restoreConnection(): Promise<unknown | null>;
}

export interface AppLifecycleController {
  handleStateChange(nextState: string): void;
  dispose(): void;
}

/**
 * Pure owner for global AppState transitions.
 *
 * A resume reconnect may outlive the foreground state that started it. When the
 * app backgrounds again we invalidate that promise, remember that the resume
 * reconnect was interrupted, and retry on the next foreground transition. This
 * prevents a stale async completion from writing "connected" while the app is
 * already backgrounded without leaving the connection stuck in "reconnecting".
 */
export const createAppLifecycleController = (
  initialState: string,
  deps: AppLifecycleDeps,
): AppLifecycleController => {
  let previousState = initialState;
  let resumeGeneration = 0;
  let resumeRestoreInFlight = false;
  let retryInterruptedResume = false;
  let disposed = false;

  const invalidateResumeRestore = () => {
    if (!resumeRestoreInFlight) return;
    resumeGeneration += 1;
    resumeRestoreInFlight = false;
    retryInterruptedResume = true;
  };

  return {
    handleStateChange(nextState) {
      if (disposed) return;

      deps.setLocalExecutionSuspended(nextState !== 'active');

      if (nextState !== 'active') {
        invalidateResumeRestore();
      }

      if (nextState === 'active' && previousState !== 'active') {
        deps.refreshRelayConnection();

        const shouldRestore =
          deps.getConnectionStatus() === 'connected' || retryInterruptedResume;
        if (shouldRestore) {
          retryInterruptedResume = false;
          const generation = ++resumeGeneration;
          resumeRestoreInFlight = true;
          deps.setConnectionStatus('reconnecting');

          deps
            .restoreConnection()
            .then((restored) => {
              if (disposed || generation !== resumeGeneration) return;
              resumeRestoreInFlight = false;
              deps.setConnectionStatus(restored ? 'connected' : 'disconnected');
            })
            .catch(() => {
              if (disposed || generation !== resumeGeneration) return;
              resumeRestoreInFlight = false;
              deps.setConnectionStatus('reconnecting');
            });
        }
      }

      previousState = nextState;
    },

    dispose() {
      disposed = true;
      resumeGeneration += 1;
      resumeRestoreInFlight = false;
      retryInterruptedResume = false;
    },
  };
};
