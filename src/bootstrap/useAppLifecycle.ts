import { useEffect } from 'react';
import { AppState } from 'react-native';
import { remoteMiraHostClient } from '../api/remoteMiraHost';
import { useHostStore } from '../store/hostStore';
import { runtimeRegistry } from '../runtime/runtimeRegistry';
import { createAppLifecycleController } from './appLifecycle';

/**
 * React adapter for the global AppState lifecycle owner.
 */
export const useAppLifecycle = (): void => {
  useEffect(() => {
    const controller = createAppLifecycleController(AppState.currentState, {
      setLocalExecutionSuspended: (suspended) =>
        runtimeRegistry.local.setExecutionSuspended(suspended),
      refreshRelayConnection: () => remoteMiraHostClient.refreshRelayConnection(),
      getConnectionStatus: () => useHostStore.getState().connectionStatus,
      setConnectionStatus: (status) =>
        useHostStore.getState().setConnectionStatus(status),
      restoreConnection: () => remoteMiraHostClient.restoreConnection(),
    });

    const subscription = AppState.addEventListener('change', (nextState) => {
      controller.handleStateChange(nextState);
    });

    return () => {
      controller.dispose();
      subscription.remove();
    };
  }, []);
};
