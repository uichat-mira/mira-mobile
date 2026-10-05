import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { remoteMiraHostClient } from '../api/remoteMiraHost';
import { useHostStore } from '../store/hostStore';
import { runtimeRegistry } from '../runtime/runtimeRegistry';

/**
 * Owns the global AppState side effects that are not tied to any screen:
 * - suspend/resume local execution so a backgrounded turn cannot keep running;
 * - on resume, drop stale Relay sockets and re-establish the Remote connection.
 *
 * A resume generation counter invalidates any in-flight restore callback once a
 * newer resume or an unmount happens, so a stale promise can never write a
 * destroyed tree or overwrite a newer connection status.
 */
export const useAppLifecycle = (): void => {
  useEffect(() => {
    let previousState: AppStateStatus = AppState.currentState;
    let resumeGeneration = 0;

    const subscription = AppState.addEventListener('change', (nextState) => {
      runtimeRegistry.local.setExecutionSuspended(nextState !== 'active');

      if (nextState === 'active' && previousState !== 'active') {
        remoteMiraHostClient.refreshRelayConnection();
        if (useHostStore.getState().connectionStatus === 'connected') {
          const generation = ++resumeGeneration;
          useHostStore.getState().setConnectionStatus('reconnecting');
          void remoteMiraHostClient
            .restoreConnection()
            .then((restored) => {
              if (generation !== resumeGeneration) return;
              useHostStore
                .getState()
                .setConnectionStatus(restored ? 'connected' : 'disconnected');
            })
            .catch(() => {
              if (generation !== resumeGeneration) return;
              useHostStore.getState().setConnectionStatus('reconnecting');
            });
        }
      }

      previousState = nextState;
    });

    return () => {
      resumeGeneration += 1;
      subscription.remove();
    };
  }, []);
};
