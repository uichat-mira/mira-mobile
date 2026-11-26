import { useEffect, useState } from 'react';
import { releaseChannel } from 'mira-release-channel';
import { version } from '../../package.json';
import { miraHostClient } from '../api/miraHostClient';
import { restoreDesktopConnection, useDesktopConnectionStore } from '../connectivity/desktopConnectionAuthority';
import { activeDesktopConnectionKey, reconnectActiveDesktop } from '../connectivity/reconnectActiveDesktop';
import { remoteMiraHostClient } from '../api/remoteMiraHost';
import { deviceCredentialStore } from '../security/deviceCredentialStore';
import { useHostStore } from '../store/hostStore';
import { runtimeRegistry } from '../runtime/runtimeRegistry';
import { loadGeneralSettings } from '../settings/generalSettings';
import { loadLastOpenedSession } from '../session/lastOpenedSession';
import { fetchLatestRelease } from '../update/appUpdate';
import { parseSemver } from '../update/semver';
import { presentUpdatePrompt } from '../update/updatePrompt';
import {
  runAppBootstrap,
  type AppBootstrapDeps,
  type AppBootstrapResult,
} from './appBootstrap';
import { resolveRestoreTarget } from './restoreTarget';

// The app singletons are resolved at call time (not captured) so tests can spy
// or replace them after module import.
const createBootstrapDeps = (): AppBootstrapDeps => ({
  isSecureStorageAvailable: () => remoteMiraHostClient.isSecureStorageAvailable(),
  loadDeviceCredential: () => useDesktopConnectionStore.getState().mode === 'direct'
    ? deviceCredentialStore.load() : Promise.resolve(null),
  restoreConnection: () => reconnectActiveDesktop(),
  setConnectionStatus: (status) => useHostStore.getState().setConnectionStatus(status),
  loadGeneralSettings: () => loadGeneralSettings(),
  resolveRestoreTarget: () =>
    resolveRestoreTarget({
      loadLastOpenedSession: async () => {
        const target = await loadLastOpenedSession();
        if (!target || target.source === 'local-provider') return target;
        return target.source === 'remote-host' && useDesktopConnectionStore.getState().mode === 'direct'
          ? target : null;
      },
      listLocalSessions: () => runtimeRegistry.local.listSessions(),
      listRemoteSessions: () => miraHostClient.listSessions(),
      isRemoteConnected: () => useHostStore.getState().connectionStatus === 'connected',
    }),
  fetchLatestRelease: () => fetchLatestRelease(releaseChannel, fetch).catch(() => null),
  parseCurrentVersion: () => parseSemver(version),
  presentUpdatePrompt: (latest) => presentUpdatePrompt(latest),
});

/**
 * Single bootstrap entry for cold start. It owns the ordered, failure-isolated
 * startup sequence (settings hydration, connection restore, last-opened restore
 * target, automatic update check) and commits the navigator's initial inputs in
 * one state update. The cancellation flag drops the commit on unmount so a
 * stale async callback can never update a destroyed tree.
 *
 * Returns `null` until the sequence has committed; callers gate the navigator on
 * that so it mounts exactly once with both values already in place.
 */
export const useAppBootstrap = (): AppBootstrapResult | null => {
  const [bootstrap, setBootstrap] = useState<AppBootstrapResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await restoreDesktopConnection().catch(() => undefined);
      if (cancelled) return null;
      if (useDesktopConnectionStore.getState().mode === 'cloud') {
        const key = activeDesktopConnectionKey();
        useDesktopConnectionStore.setState({ cloudConnectionStatus: 'connecting' });
        try {
          const restored = await reconnectActiveDesktop();
          if (!cancelled && activeDesktopConnectionKey() === key) {
            useDesktopConnectionStore.setState({ cloudConnectionStatus: restored ? 'connected' : 'disconnected' });
          }
        } catch {
          if (!cancelled && activeDesktopConnectionKey() === key) {
            useDesktopConnectionStore.setState({ cloudConnectionStatus: 'reconnecting' });
          }
        }
      }
      return runAppBootstrap(createBootstrapDeps(), () => cancelled);
    })().then((result) => {
      if (cancelled || !result) return;
      setBootstrap(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return bootstrap;
};
