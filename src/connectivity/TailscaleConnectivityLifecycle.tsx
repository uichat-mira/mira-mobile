import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { remoteMiraHostClient } from '../api/remoteMiraHost';
import { useHostStore } from '../store/hostStore';
import { useTailscaleConnectivityStore } from '../store/tailscaleConnectivityStore';
import { subscribeToSystemNetworkChanges } from './systemNetworkMonitor';
import { useDesktopConnectionStore } from './desktopConnectionAuthority';
import { activeDesktopConnectionKey, reconnectActiveDesktop } from './reconnectActiveDesktop';

/**
 * Keeps the observable Mobile -> Tailscale -> Mira Host transport state fresh.
 * It never clears device credentials on transport failures; authorization is a
 * separate layer and is validated through Remote Host V1 manifest checks.
 */
export function TailscaleConnectivityLifecycle() {
  const mode = useDesktopConnectionStore(state => state.mode);
  const configuredHostUrl = useHostStore((state) => state.config?.hostUrl ?? '');
  const setHostUrl = useTailscaleConnectivityStore((state) => state.setHostUrl);
  const probe = useTailscaleConnectivityStore((state) => state.probe);
  const connectivityState = useTailscaleConnectivityStore((state) => state.state);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const lastConfiguredHost = useRef('');
  const networkRecoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (mode !== 'direct' || configuredHostUrl || !remoteMiraHostClient.isSecureStorageAvailable()) {
      return () => {
        cancelled = true;
      };
    }

    remoteMiraHostClient
      .getStoredHostUrl()
      .then((storedHostUrl) => {
        if (cancelled || !storedHostUrl) return;
        useHostStore.getState().setConfig({
          hostUrl: storedHostUrl,
          token: '',
        });
      })
      .catch(() => {
        if (!cancelled) {
          useHostStore.getState().setConnectionStatus('disconnected');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [configuredHostUrl, mode]);

  useEffect(() => {
    if (mode !== 'direct') {
      lastConfiguredHost.current = '';
      return;
    }
    const target = configuredHostUrl.trim();
    if (!target) return;

    setHostUrl(target);
    if (lastConfiguredHost.current !== target) {
      lastConfiguredHost.current = target;
      void probe(target, 'startup');
    }
  }, [configuredHostUrl, mode, probe, setHostUrl]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasBackground =
        appState.current === 'background' || appState.current === 'inactive';
      appState.current = nextState;

      const target = useTailscaleConnectivityStore.getState().hostUrl.trim();
      const currentState = useTailscaleConnectivityStore.getState().state;
      if (
        useDesktopConnectionStore.getState().mode === 'direct' &&
        wasBackground &&
        nextState === 'active' &&
        target &&
        currentState !== 'probing'
      ) {
        void useTailscaleConnectivityStore
          .getState()
          .probe(target, 'foreground');
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToSystemNetworkChanges(() => {
      if (networkRecoveryTimer.current) {
        clearTimeout(networkRecoveryTimer.current);
      }

      // VPN, Wi-Fi and cellular transitions often emit several callbacks.
      // Debounce them into one transport verification against the actual Host.
      networkRecoveryTimer.current = setTimeout(() => {
        const mode = useDesktopConnectionStore.getState().mode;
        if (mode === 'cloud') {
          const key = activeDesktopConnectionKey();
          void reconnectActiveDesktop().then(result => {
            if (activeDesktopConnectionKey() === key) useDesktopConnectionStore.setState({ cloudConnectionStatus: result ? 'connected' : 'disconnected' });
          }).catch(() => {
            if (activeDesktopConnectionKey() === key) useDesktopConnectionStore.setState({ cloudConnectionStatus: 'reconnecting' });
          });
          return;
        }
        if (mode !== 'direct') return;
        const store = useTailscaleConnectivityStore.getState();
        const target = store.hostUrl.trim();
        if (!target || store.state === 'probing') return;
        void store.probe(target, 'network-recovery');
      }, 900);
    });

    return () => {
      unsubscribe();
      if (networkRecoveryTimer.current) {
        clearTimeout(networkRecoveryTimer.current);
        networkRecoveryTimer.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const hostState = useHostStore.getState();
    if (mode !== 'direct') return;
    const key = activeDesktopConnectionKey();

    if (connectivityState === 'probing') {
      if (hostState.connectionStatus === 'connected') {
        hostState.setConnectionStatus('reconnecting');
      }
      return () => {
        cancelled = true;
      };
    }

    if (connectivityState === 'ready') {
      if (!remoteMiraHostClient.isSecureStorageAvailable()) {
        hostState.setConnectionStatus('disconnected');
        return () => {
          cancelled = true;
        };
      }

      void reconnectActiveDesktop()
        .then((restored) => {
          if (cancelled || activeDesktopConnectionKey() !== key) return;
          useHostStore
            .getState()
            .setConnectionStatus(restored ? 'connected' : 'disconnected');
        })
        .catch(() => {
          if (cancelled || activeDesktopConnectionKey() !== key) return;

          // Network failure is not device revocation. restoreConnection clears
          // the device credential only for 401/403, so preserve reconnecting
          // while a credential still exists.
          void remoteMiraHostClient.getStoredHostUrl().then((storedHostUrl) => {
            if (cancelled || activeDesktopConnectionKey() !== key) return;
            useHostStore
              .getState()
              .setConnectionStatus(storedHostUrl ? 'reconnecting' : 'disconnected');
          });
        });

      return () => {
        cancelled = true;
      };
    }

    if (connectivityState !== 'idle') {
      const status = hostState.connectionStatus;
      if (
        status === 'connected' ||
        status === 'connecting' ||
        status === 'reconnecting'
      ) {
        // Keep the credential, but report transport recovery instead of a
        // false authenticated connection while Tailnet is unavailable.
        hostState.setConnectionStatus('reconnecting');
      }
    }

    return () => {
      cancelled = true;
    };
  }, [connectivityState, mode]);

  useEffect(() => {
    const transientHostUrl = useTailscaleConnectivityStore
      .getState()
      .hostUrl.trim();
    if (
      !configuredHostUrl &&
      !transientHostUrl &&
      connectivityState !== 'idle'
    ) {
      useTailscaleConnectivityStore.getState().reset();
      lastConfiguredHost.current = '';
    }
  }, [configuredHostUrl, connectivityState]);

  return null;
}
