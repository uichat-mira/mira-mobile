import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useDesktopConnectionStore } from '../connectivity/desktopConnectionAuthority';
import { activeDesktopConnectionKey, reconnectActiveDesktop } from '../connectivity/reconnectActiveDesktop';
import { deviceCredentialStore } from '../security/deviceCredentialStore';
import { useHostStore } from '../store/hostStore';
import { runtimeRegistry } from '../runtime/runtimeRegistry';
import { createAppLifecycleController } from './appLifecycle';
import { accountServiceCatalogCache } from '../mcp/accountServiceRegistry';
import { pushBindingService } from '../push/pushBindingService';
import { subscribePushProviderRegistration } from '../push/providerToken';

/**
 * React adapter for the global AppState lifecycle owner.
 */
export const useAppLifecycle = (): void => {
  useEffect(() => {
    const controller = createAppLifecycleController(AppState.currentState, {
      invalidateAccountServices: () => accountServiceCatalogCache.invalidate(),
      setLocalExecutionSuspended: (suspended) =>
        runtimeRegistry.local.setExecutionSuspended(suspended),
      connectionKey: activeDesktopConnectionKey,
      getConnectionStatus: () => useDesktopConnectionStore.getState().mode === 'cloud'
        ? useDesktopConnectionStore.getState().cloudConnectionStatus
        : useHostStore.getState().connectionStatus,
      setConnectionStatus: (status) => {
        const mode = useDesktopConnectionStore.getState().mode;
        if (mode === 'cloud') useDesktopConnectionStore.setState({ cloudConnectionStatus: status });
        if (mode === 'direct') useHostStore.getState().setConnectionStatus(status);
      },
      restoreConnection: async () => {
        const key = activeDesktopConnectionKey();
        if (useDesktopConnectionStore.getState().mode !== 'direct') {
          return reconnectActiveDesktop();
        }
        try {
          const restored = await reconnectActiveDesktop();
          if (activeDesktopConnectionKey() !== key) return null;
          if (!restored) {
            await pushBindingService.reconcileWithPairedDevice(false);
          }
          return restored;
        } catch (error) {
          if (activeDesktopConnectionKey() !== key) return null;
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
