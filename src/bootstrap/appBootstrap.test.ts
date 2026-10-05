import type { ConnectionStatus } from '../types';
import {
  DEFAULT_GENERAL_SETTINGS,
  type GeneralSettings,
} from '../settings/generalSettings';
import type { LastOpenedSession } from '../session/lastOpenedSession';
import type { AppRelease } from '../update/appUpdate';
import type { SemverVersion } from '../update/semver';
import { runAppBootstrap, type AppBootstrapDeps } from './appBootstrap';

const remoteTarget: LastOpenedSession = {
  sessionId: 'thread-1',
  title: '会话',
  source: 'remote-host',
  providerName: null,
  providerModel: null,
};

const generalSettings = (
  overrides: Partial<GeneralSettings> = {},
): GeneralSettings => ({
  ...DEFAULT_GENERAL_SETTINGS,
  autoCheckUpdates: false,
  ...overrides,
});

const release = (major: number, minor: number, patch: number): AppRelease => ({
  version: { major, minor, patch },
  displayVersion: `${major}.${minor}.${patch}-dev`,
  notes: null,
  apkUrl: 'https://assets.tomz.io/apk',
  sha256: 'a'.repeat(64),
});

const current = (major: number, minor: number, patch: number): SemverVersion => ({
  major,
  minor,
  patch,
});

interface Harness {
  deps: AppBootstrapDeps;
  order: string[];
  setStatus: jest.Mock;
  loadDeviceCredential: jest.Mock;
  restoreConnection: jest.Mock;
  resolveRestoreTarget: jest.Mock;
  fetchLatestRelease: jest.Mock;
  presentUpdatePrompt: jest.Mock;
}

const buildHarness = (overrides: Partial<AppBootstrapDeps> = {}): Harness => {
  const order: string[] = [];
  const step = (name: string) => {
    order.push(name);
  };

  const setStatus = jest.fn((status: ConnectionStatus) => {
    step(`status:${status}`);
  });
  const loadDeviceCredential = jest.fn(async () => {
    step('loadDeviceCredential');
    return { credential: 'device-credential' };
  });
  const restoreConnection = jest.fn(async () => {
    step('restoreConnection');
    return { manifest: {} };
  });
  const resolveRestoreTarget = jest.fn(async () => {
    step('resolveRestoreTarget');
    return remoteTarget;
  });
  const fetchLatestRelease = jest.fn(async () => {
    step('fetchLatestRelease');
    return null as AppRelease | null;
  });
  const presentUpdatePrompt = jest.fn((_latest: AppRelease) => {
    step('presentUpdatePrompt');
  });

  const deps: AppBootstrapDeps = {
    isSecureStorageAvailable: jest.fn(() => {
      step('isSecureStorageAvailable');
      return true;
    }),
    loadDeviceCredential,
    restoreConnection,
    setConnectionStatus: setStatus,
    loadGeneralSettings: jest.fn(async () => {
      step('loadGeneralSettings');
      return generalSettings();
    }),
    resolveRestoreTarget,
    fetchLatestRelease,
    parseCurrentVersion: jest.fn(() => {
      step('parseCurrentVersion');
      return current(0, 3, 11);
    }),
    presentUpdatePrompt,
    ...overrides,
  };

  return {
    deps,
    order,
    setStatus,
    loadDeviceCredential,
    restoreConnection,
    resolveRestoreTarget,
    fetchLatestRelease,
    presentUpdatePrompt,
  };
};

describe('runAppBootstrap', () => {
  it('runs the startup steps in the documented order and commits once', async () => {
    const { deps, order, setStatus } = buildHarness();

    await expect(runAppBootstrap(deps)).resolves.toEqual({
      hasDeviceCredential: true,
      restoreTarget: null,
    });

    expect(order).toEqual([
      'isSecureStorageAvailable',
      'loadDeviceCredential',
      'restoreConnection',
      'status:connected',
      'loadGeneralSettings',
    ]);
    expect(setStatus).toHaveBeenCalledTimes(1);
  });

  it('resolves the restore target after settings when launch behavior is last-session', async () => {
    const { deps, order, resolveRestoreTarget } = buildHarness({
      loadGeneralSettings: async () => generalSettings({ launchBehavior: 'last-session' }),
    });

    const result = await runAppBootstrap(deps);

    expect(result.restoreTarget).toEqual(remoteTarget);
    expect(resolveRestoreTarget).toHaveBeenCalledTimes(1);
    expect(order.indexOf('resolveRestoreTarget')).toBeGreaterThan(
      order.indexOf('loadGeneralSettings'),
    );
  });

  it('does not resolve a restore target for the default home launch behavior', async () => {
    const { deps, resolveRestoreTarget } = buildHarness();
    await runAppBootstrap(deps);
    expect(resolveRestoreTarget).not.toHaveBeenCalled();
  });

  it('reports disconnected with no credential when secure storage is unavailable', async () => {
    const { deps, setStatus, loadDeviceCredential } = buildHarness({
      isSecureStorageAvailable: () => false,
    });

    await expect(runAppBootstrap(deps)).resolves.toEqual({
      hasDeviceCredential: false,
      restoreTarget: null,
    });
    expect(setStatus).toHaveBeenCalledWith('disconnected');
    expect(loadDeviceCredential).not.toHaveBeenCalled();
  });

  it('reports disconnected with no credential when nothing is stored', async () => {
    const { deps, setStatus, restoreConnection } = buildHarness({
      loadDeviceCredential: async () => null,
    });

    await expect(runAppBootstrap(deps)).resolves.toEqual({
      hasDeviceCredential: false,
      restoreTarget: null,
    });
    expect(setStatus).toHaveBeenCalledWith('disconnected');
    expect(restoreConnection).not.toHaveBeenCalled();
  });

  it('isolates a credential read failure instead of rejecting', async () => {
    const { deps, setStatus } = buildHarness({
      loadDeviceCredential: async () => {
        throw new Error('credential store unavailable');
      },
    });

    await expect(runAppBootstrap(deps)).resolves.toEqual({
      hasDeviceCredential: false,
      restoreTarget: null,
    });
    expect(setStatus).toHaveBeenCalledWith('disconnected');
  });

  it('reports disconnected with no credential when restore resolves to null', async () => {
    const { deps, setStatus } = buildHarness({
      restoreConnection: async () => null,
    });

    await expect(runAppBootstrap(deps)).resolves.toEqual({
      hasDeviceCredential: false,
      restoreTarget: null,
    });
    expect(setStatus).toHaveBeenCalledWith('disconnected');
  });

  it('keeps the credential and reports reconnecting when restore fails', async () => {
    const { deps, setStatus } = buildHarness({
      restoreConnection: async () => {
        throw new Error('host unreachable');
      },
    });

    await expect(runAppBootstrap(deps)).resolves.toEqual({
      hasDeviceCredential: true,
      restoreTarget: null,
    });
    expect(setStatus).toHaveBeenCalledWith('reconnecting');
  });

  it('falls back to default settings when hydration fails and still checks for updates', async () => {
    const latest = release(0, 4, 0);
    const harness = buildHarness({
      loadGeneralSettings: async () => {
        throw new Error('settings unavailable');
      },
    });
    harness.fetchLatestRelease.mockResolvedValue(latest);

    await expect(runAppBootstrap(harness.deps)).resolves.toEqual({
      hasDeviceCredential: true,
      restoreTarget: null,
    });
    expect(harness.fetchLatestRelease).toHaveBeenCalledTimes(1);
    expect(harness.presentUpdatePrompt).toHaveBeenCalledWith(latest);
  });

  it('does not check for updates when the setting is disabled', async () => {
    const { deps, fetchLatestRelease } = buildHarness({
      loadGeneralSettings: async () => generalSettings({ autoCheckUpdates: false }),
    });

    await runAppBootstrap(deps);
    expect(fetchLatestRelease).not.toHaveBeenCalled();
  });

  it('isolates a failed release fetch and still commits', async () => {
    const { deps, presentUpdatePrompt } = buildHarness({
      loadGeneralSettings: async () => generalSettings({ autoCheckUpdates: true }),
      fetchLatestRelease: async () => {
        throw new Error('network down');
      },
    });

    await expect(runAppBootstrap(deps)).resolves.toEqual({
      hasDeviceCredential: true,
      restoreTarget: null,
    });
    expect(presentUpdatePrompt).not.toHaveBeenCalled();
  });

  const updateCases: Array<{ level: string; latest: AppRelease; prompts: boolean }> = [
    { level: 'major', latest: release(1, 0, 0), prompts: true },
    { level: 'minor', latest: release(0, 4, 0), prompts: true },
    { level: 'patch', latest: release(0, 3, 12), prompts: false },
    { level: 'equal', latest: release(0, 3, 11), prompts: false },
  ];

  it.each(updateCases)(
    'prompts=$prompts for a $level update',
    async ({ latest, prompts }) => {
      const { deps, presentUpdatePrompt } = buildHarness({
        loadGeneralSettings: async () => generalSettings({ autoCheckUpdates: true }),
        fetchLatestRelease: async () => latest,
      });

      await runAppBootstrap(deps);

      if (prompts) {
        expect(presentUpdatePrompt).toHaveBeenCalledWith(latest);
      } else {
        expect(presentUpdatePrompt).not.toHaveBeenCalled();
      }
    },
  );

  it('does not prompt when the installed version cannot be parsed', async () => {
    const { deps, presentUpdatePrompt } = buildHarness({
      loadGeneralSettings: async () => generalSettings({ autoCheckUpdates: true }),
      fetchLatestRelease: async () => release(0, 4, 0),
      parseCurrentVersion: () => null,
    });

    await runAppBootstrap(deps);
    expect(presentUpdatePrompt).not.toHaveBeenCalled();
  });

  it('isolates a restore target resolution failure', async () => {
    const { deps } = buildHarness({
      loadGeneralSettings: async () => generalSettings({ launchBehavior: 'last-session' }),
      resolveRestoreTarget: async () => {
        throw new Error('resolution failed');
      },
    });

    await expect(runAppBootstrap(deps)).resolves.toEqual({
      hasDeviceCredential: true,
      restoreTarget: null,
    });
  });

  it('stops after cancellation without running later side effects', async () => {
    let cancelled = false;
    const { deps, restoreConnection, resolveRestoreTarget } = buildHarness({
      loadDeviceCredential: async () => {
        cancelled = true;
        return { credential: 'device-credential' };
      },
      loadGeneralSettings: async () => generalSettings({ launchBehavior: 'last-session' }),
    });

    await expect(runAppBootstrap(deps, () => cancelled)).resolves.toEqual({
      hasDeviceCredential: false,
      restoreTarget: null,
    });
    expect(restoreConnection).not.toHaveBeenCalled();
    expect(resolveRestoreTarget).not.toHaveBeenCalled();
  });

  it('never rejects even when an injected effect throws', async () => {
    const { deps } = buildHarness({
      loadDeviceCredential: async () => null,
      setConnectionStatus: () => {
        throw new Error('store failure');
      },
    });

    await expect(runAppBootstrap(deps)).resolves.toEqual({
      hasDeviceCredential: false,
      restoreTarget: null,
    });
  });
});
