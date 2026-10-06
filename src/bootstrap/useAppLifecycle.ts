import { useEffect } from 'react';
import { AppState } from 'react-native';
import { remoteMiraHostClient } from '../api/remoteMiraHost';
import { deviceCredentialStore } from '../security/deviceCredentialStore';
import { useHostStore } from '../store/hostStore';
import { runtimeRegistry } from '../runtime/runtimeRegistry';
import { createAppLifecycleController } from './appLifecycle';
import { pushBindingService } from '../push/pushBindingService';
import { subscribePushProviderRegistration } from '../push/providerToken';

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
      restoreConnection: async () => {
        try {
          const restored = await remoteMiraHostClient.restoreConnection();
          if (!restored) {
            await pushBindingService.reconcileWithPairedDevice(false);
          }
          return restored;
        } catch (error) {
          try {
            const storedCredential = await deviceCredentialStore.load();
            if (!storedCredential) {
              await pushBindingService.reconcileWithPairedDevice(false);
            }
          } catch {
            // Preserve the original restore failure when secure storage itself
            // is unavailable; an unknown credential state must not trigger revoke.
          }
          throw error;
        }
      },
    });

    void deviceCredentialStore
      .load()
      .then(credential =>
        credential
          ? pushBindingService.refreshProviderRegistrationIfBound()
          : pushBindingService.reconcileWithPairedDevice(false),
      )
      .catch(() => undefined);

    const providerSubscription = subscribePushProviderRegistration(
      registration => {
        void pushBindingService
          .refreshProviderRegistrationIfBound(registration)
          .catch(() => undefined);
      },
    );

    const subscription = AppState.addEventListener('change', (nextState) => {
      controller.handleStateChange(nextState);
      if (nextState === 'active') {
        void pushBindingService
          .refreshProviderRegistrationIfBound()
          .catch(() => undefined);
      }
    });

    return () => {
      controller.dispose();
      providerSubscription.remove();
      subscription.remove();
    };
  }, []);
};
