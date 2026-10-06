/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import { saveGeneralSettings } from '../src/settings/generalSettings';
import { saveLastOpenedSession } from '../src/session/lastOpenedSession';

type MockRoute = { name: string; params?: Record<string, unknown> };
type MockNavigation = {
  navigate: (name: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
  canGoBack: () => boolean;
};
type MockScreenListenerFactory = (args: {
  navigation: MockNavigation;
}) => { focus?: () => void };

// The navigator mock below keeps an observable route stack. This lets the
// regression distinguish the broken [Chat] root from the required
// [SessionList, Chat] startup topology and exercise the same pop semantics used
// by Chat's back action / Android system back.
const mockInitialRouteNames: string[] = [];
const mockNavigationStacks: MockRoute[][] = [];
const mockNavigations: MockNavigation[] = [];
const mockScreenListeners: Record<string, MockScreenListenerFactory | undefined> = {};

jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }: { children: React.ReactNode }) => children ?? null,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children ?? null,
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children ?? null,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
}));

jest.mock('@react-navigation/native-stack', () => {
  const ReactActual = jest.requireActual('react') as typeof import('react');

  return {
    createNativeStackNavigator: () => ({
      Navigator: ({
        initialRouteName,
        children,
      }: {
        initialRouteName?: string;
        children?: React.ReactNode;
      }) => {
        ReactActual.useEffect(() => {
          const stack: MockRoute[] = [{ name: initialRouteName as string }];
          const navigation: MockNavigation = {
            navigate: (name, params) => {
              stack.push({ name, params });
            },
            goBack: () => {
              if (stack.length > 1) stack.pop();
            },
            canGoBack: () => stack.length > 1,
          };

          mockNavigationStacks.push(stack);
          mockNavigations.push(navigation);
          const initialListeners = mockScreenListeners[initialRouteName as string]?.({ navigation });
          initialListeners?.focus?.();
        }, [initialRouteName]);

        mockInitialRouteNames.push(initialRouteName as string);
        return children ?? null;
      },
      Screen: ({
        name,
        listeners,
      }: {
        name: string;
        listeners?: MockScreenListenerFactory;
      }) => {
        mockScreenListeners[name] = listeners;
        return null;
      },
    }),
  };
});

// Back the app's key-value store with an in-memory implementation so the test
// can seed the exact instance the app reads. The store must be created inside
// the factory: a module-scope const is not yet initialized when jest executes
// the mock factory during the hoisted import of App.
jest.mock('../src/storage/localKeyValueStore', () => {
  const actual = jest.requireActual('../src/storage/localKeyValueStore');
  return {
    ...actual,
    localKeyValueStore: new actual.MemoryLocalKeyValueStore(),
  };
});

const mockCredential = {
  hostUrl: 'https://host.example',
  scopes: ['chat'],
  relay: null,
};

jest.mock('../src/security/deviceCredentialStore', () => ({
  deviceCredentialStore: {
    load: jest.fn(async () => mockCredential),
    save: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
    isAvailable: () => true,
  },
}));

jest.mock('../src/api/remoteMiraHost', () => ({
  remoteMiraHostClient: {
    isSecureStorageAvailable: () => true,
    restoreConnection: jest.fn(async () => ({ hostUrl: 'https://host.example' })),
    refreshRelayConnection: jest.fn(),
    getStoredHostUrl: jest.fn(async () => 'https://host.example'),
  },
}));

const mockListedSessions = [
  {
    id: 'thread-42',
    title: '需求评审',
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    source: 'remote-host' as const,
  },
];

jest.mock('../src/api/miraHostClient', () => ({
  miraHostClient: {
    listSessions: jest.fn(async () => mockListedSessions),
  },
}));

jest.mock('../src/update/appUpdate', () => ({
  ...jest.requireActual('../src/update/appUpdate'),
  fetchLatestRelease: jest.fn(async () => null),
}));

jest.mock('../src/update/updatePrompt', () => ({
  presentUpdatePrompt: jest.fn(),
}));

// Tailscale connectivity probing is unrelated to startup routing and otherwise
// schedules async store updates that trip act() warnings.
jest.mock('../src/connectivity/TailscaleConnectivityLifecycle', () => ({
  TailscaleConnectivityLifecycle: () => null,
}));

// The full screen tree pulls in heavyweight, ESM-only renderers that are
// irrelevant to startup routing. Replace every screen with an inert component so
// the test exercises only bootstrap + navigator wiring.
jest.mock('../src/screens/BootstrapScreen', () => ({ BootstrapScreen: 'BootstrapScreen' }));
jest.mock('../src/screens/SessionListScreen', () => ({ SessionListScreen: 'SessionListScreen' }));
jest.mock('../src/screens/AgentChatScreen', () => ({ AgentChatScreen: 'AgentChatScreen' }));
jest.mock('../src/screens/WorkspaceListScreen', () => ({
  WorkspaceListScreen: 'WorkspaceListScreen',
}));
jest.mock('../src/screens/WorkspaceDetailScreen', () => ({
  WorkspaceDetailScreen: 'WorkspaceDetailScreen',
}));
jest.mock('../src/screens/HostConfigScreen', () => ({ HostConfigScreen: 'HostConfigScreen' }));
jest.mock('../src/screens/SettingsScreen', () => ({ SettingsScreen: 'SettingsScreen' }));
jest.mock('../src/screens/LocalProviderConfigScreen', () => ({
  LocalProviderConfigScreen: 'LocalProviderConfigScreen',
}));
jest.mock('../src/screens/SearchScreen', () => ({ SearchScreen: 'SearchScreen' }));
jest.mock('../src/screens/PersonalizationScreen', () => ({
  PersonalizationScreen: 'PersonalizationScreen',
}));
jest.mock('../src/screens/MemoryScreen', () => ({ MemoryScreen: 'MemoryScreen' }));
jest.mock('../src/screens/StorageScreen', () => ({ StorageScreen: 'StorageScreen' }));
jest.mock('../src/screens/GeneralSettingsScreen', () => ({
  GeneralSettingsScreen: 'GeneralSettingsScreen',
}));
jest.mock('../src/screens/NotificationSettingsScreen', () => ({
  NotificationSettingsScreen: 'NotificationSettingsScreen',
}));
jest.mock('../src/screens/ReportErrorScreen', () => ({ ReportErrorScreen: 'ReportErrorScreen' }));
jest.mock('../src/screens/AboutScreen', () => ({ AboutScreen: 'AboutScreen' }));
jest.mock('../src/screens/LicenseScreen', () => ({ LicenseScreen: 'LicenseScreen' }));
jest.mock('../src/screens/SecurityScreen', () => ({ SecurityScreen: 'SecurityScreen' }));
jest.mock('../src/shiyan/ShiyanScreens', () => ({
  PluginsScreen: 'PluginsScreen',
  ShiyanSceneConfigScreen: 'ShiyanSceneConfigScreen',
}));
jest.mock('../src/shiyan/ShiyanHomeScreen', () => ({
  ShiyanHomeScreen: 'ShiyanHomeScreen',
}));
jest.mock('../src/shiyan/ShiyanSceneSelectScreen', () => ({
  ShiyanSceneSelectScreen: 'ShiyanSceneSelectScreen',
}));
jest.mock('../src/shiyan/ShiyanRecordScreen', () => ({
  ShiyanRecordScreen: 'ShiyanRecordScreen',
}));
jest.mock('../src/shiyan/ShiyanLocalDraftsScreen', () => ({
  ShiyanLocalDraftsScreen: 'ShiyanLocalDraftsScreen',
}));
jest.mock('../src/shiyan/ShiyanCaptureSubmitScreen', () => ({
  ShiyanCaptureSubmitScreen: 'ShiyanCaptureSubmitScreen',
}));
jest.mock('../src/shiyan/ShiyanCloudConfigScreen', () => ({
  ShiyanCloudConfigScreen: 'ShiyanCloudConfigScreen',
}));
jest.mock('../src/shiyan/ShiyanHistoryScreen', () => ({
  ShiyanHistoryScreen: 'ShiyanHistoryScreen',
}));
jest.mock('../src/shiyan/ShiyanOrganizeRulesScreen', () => ({
  ShiyanOrganizeRulesScreen: 'ShiyanOrganizeRulesScreen',
}));
jest.mock('../src/shiyan/ShiyanTaskDetailWithDeliveryScreen', () => ({
  ShiyanTaskDetailWithDeliveryScreen: 'ShiyanTaskDetailWithDeliveryScreen',
}));

import { runtimeRegistry } from '../src/runtime/runtimeRegistry';
import { useHostStore } from '../src/store/hostStore';
import { localKeyValueStore } from '../src/storage/localKeyValueStore';
import App from '../App';

const flushMicrotasks = async (rounds = 12): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
};

const renderApp = async (): Promise<ReactTestRenderer.ReactTestRenderer> => {
  let component: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    component = ReactTestRenderer.create(<App />);
    await flushMicrotasks();
  });
  await ReactTestRenderer.act(async () => {
    await flushMicrotasks();
  });
  return component!;
};

describe('startup session restore', () => {
  beforeEach(() => {
    mockInitialRouteNames.length = 0;
    mockNavigationStacks.length = 0;
    mockNavigations.length = 0;
    for (const key of Object.keys(mockScreenListeners)) delete mockScreenListeners[key];
    useHostStore.getState().setConnectionStatus('connected');
    const remote = jest.requireMock('../src/api/remoteMiraHost').remoteMiraHostClient;
    remote.restoreConnection.mockResolvedValue({ hostUrl: 'https://host.example' });
    const host = jest.requireMock('../src/api/miraHostClient').miraHostClient;
    host.listSessions.mockReset();
    host.listSessions.mockResolvedValue(mockListedSessions);
    const update = jest.requireMock('../src/update/appUpdate');
    update.fetchLatestRelease.mockReset();
    update.fetchLatestRelease.mockResolvedValue(null);
    const prompt = jest.requireMock('../src/update/updatePrompt');
    prompt.presentUpdatePrompt.mockClear();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    useHostStore.getState().setConnectionStatus('disconnected');
    await localKeyValueStore.remove('mira.mobile.last-opened-session.v1');
    await localKeyValueStore.remove('mira.mobile.general.v1');
  });

  const enableLastSessionLaunch = () =>
    saveGeneralSettings(
      {
        defaultSessionSource: 'ask',
        launchBehavior: 'last-session',
        autoCheckUpdates: false,
        textScale: 'standard',
        hapticsEnabled: true,
      },
      localKeyValueStore,
    );

  const enableAutoUpdateCheck = () =>
    saveGeneralSettings(
      {
        defaultSessionSource: 'ask',
        launchBehavior: 'home',
        autoCheckUpdates: true,
        textScale: 'standard',
        hapticsEnabled: true,
      },
      localKeyValueStore,
    );

  const nextRelease = (level: 'patch' | 'minor' | 'major') => {
    const { parseSemver } = jest.requireActual('../src/update/semver');
    const { version: installedVersion } = jest.requireActual('../package.json');
    const installed = parseSemver(installedVersion);
    if (!installed) throw new Error(`Invalid installed version: ${installedVersion}`);

    const next =
      level === 'major'
        ? `${installed.major + 1}.0.0`
        : level === 'minor'
          ? `${installed.major}.${installed.minor + 1}.0`
          : `${installed.major}.${installed.minor}.${installed.patch + 1}`;

    return {
      version: parseSemver(next),
      displayVersion: `${next}-dev`,
      notes: null,
      apkUrl: `https://assets.tomz.io/mira/mobile/dev/releases/${next}/uichat-mira-mobile-release.apk`,
      sha256: 'a'.repeat(64),
    };
  };

  it('restores a remote last session above SessionList and can return to the list', async () => {
    await enableLastSessionLaunch();
    await saveLastOpenedSession(
      { sessionId: 'thread-42', title: '需求评审', source: 'remote-host' },
      localKeyValueStore,
    );

    await renderApp();

    expect(mockInitialRouteNames).toEqual(['SessionList']);
    expect(mockNavigationStacks[0]).toEqual([
      { name: 'SessionList' },
      {
        name: 'Chat',
        params: expect.objectContaining({ sessionId: 'thread-42', source: 'remote-host' }),
      },
    ]);
    expect(mockNavigations[0].canGoBack()).toBe(true);

    mockNavigations[0].goBack();

    expect(mockNavigationStacks[0]).toEqual([{ name: 'SessionList' }]);
    expect(mockNavigations[0].canGoBack()).toBe(false);

    // Returning to SessionList fires focus again in the real navigator. The
    // startup restore must already be consumed, otherwise the old Chat would be
    // pushed again and the user would be trapped in the same loop.
    mockScreenListeners.SessionList?.({ navigation: mockNavigations[0] }).focus?.();
    expect(mockNavigationStacks[0]).toEqual([{ name: 'SessionList' }]);
  });

  it('restores a local-provider last session above SessionList', async () => {
    jest.spyOn(runtimeRegistry.local, 'listSessions').mockResolvedValue([
      {
        id: 'local-42',
        title: '本地会话',
        updatedAt: new Date('2026-10-01T00:00:00Z'),
        source: 'local-provider',
      },
    ]);
    await enableLastSessionLaunch();
    await saveLastOpenedSession(
      { sessionId: 'local-42', title: '本地会话', source: 'local-provider' },
      localKeyValueStore,
    );

    await renderApp();

    expect(mockInitialRouteNames).toEqual(['SessionList']);
    expect(mockNavigationStacks[0]).toEqual([
      { name: 'SessionList' },
      {
        name: 'Chat',
        params: expect.objectContaining({ sessionId: 'local-42', source: 'local-provider' }),
      },
    ]);
  });

  it('falls back to the session list when a connected Host authoritatively lists it as absent', async () => {
    const { miraHostClient } = jest.requireMock('../src/api/miraHostClient');
    miraHostClient.listSessions.mockResolvedValue([]);

    await enableLastSessionLaunch();
    await saveLastOpenedSession(
      { sessionId: 'thread-deleted', title: '已删除', source: 'remote-host' },
      localKeyValueStore,
    );

    await renderApp();

    expect(mockInitialRouteNames).toEqual(['SessionList']);
    expect(mockNavigationStacks[0]).toEqual([{ name: 'SessionList' }]);
  });

  it('restores the remote session into Chat while the Host is unavailable', async () => {
    // restoreConnection rejecting models a temporarily unreachable Host: the
    // credential is kept and connectionStatus becomes "reconnecting".
    const { remoteMiraHostClient } = jest.requireMock('../src/api/remoteMiraHost');
    remoteMiraHostClient.restoreConnection.mockRejectedValueOnce(new Error('host unreachable'));

    await enableLastSessionLaunch();
    await saveLastOpenedSession(
      { sessionId: 'thread-42', title: '需求评审', source: 'remote-host' },
      localKeyValueStore,
    );

    await renderApp();

    expect(useHostStore.getState().connectionStatus).toBe('reconnecting');
    expect(mockInitialRouteNames).toEqual(['SessionList']);
    expect(mockNavigationStacks[0]).toEqual([
      { name: 'SessionList' },
      { name: 'Chat', params: expect.objectContaining({ sessionId: 'thread-42' }) },
    ]);
  });

  it('restores the remote session into Chat when session listing fails', async () => {
    // Host reports connected, but listing sessions errors. An unreachable listing
    // must not be reinterpreted as "the session was deleted".
    const { miraHostClient } = jest.requireMock('../src/api/miraHostClient');
    miraHostClient.listSessions.mockRejectedValue(new Error('list failed'));

    await enableLastSessionLaunch();
    await saveLastOpenedSession(
      { sessionId: 'thread-42', title: '需求评审', source: 'remote-host' },
      localKeyValueStore,
    );

    await renderApp();

    expect(mockInitialRouteNames).toEqual(['SessionList']);
    expect(mockNavigationStacks[0]).toEqual([
      { name: 'SessionList' },
      { name: 'Chat', params: expect.objectContaining({ sessionId: 'thread-42' }) },
    ]);
  });

  it('starts on the session list by default', async () => {
    await saveLastOpenedSession(
      { sessionId: 'thread-42', title: '需求评审', source: 'remote-host' },
      localKeyValueStore,
    );

    await renderApp();

    expect(mockInitialRouteNames).toEqual(['SessionList']);
    expect(mockNavigationStacks[0]).toEqual([{ name: 'SessionList' }]);
  });

  it('does not auto-prompt for a patch-only update', async () => {
    const { fetchLatestRelease } = jest.requireMock('../src/update/appUpdate');
    const { presentUpdatePrompt } = jest.requireMock('../src/update/updatePrompt');
    fetchLatestRelease.mockResolvedValue(nextRelease('patch'));
    await enableAutoUpdateCheck();

    await renderApp();

    expect(presentUpdatePrompt).not.toHaveBeenCalled();
  });

  it('auto-prompts for a minor update', async () => {
    const { fetchLatestRelease } = jest.requireMock('../src/update/appUpdate');
    const { presentUpdatePrompt } = jest.requireMock('../src/update/updatePrompt');
    const latest = nextRelease('minor');
    fetchLatestRelease.mockResolvedValue(latest);
    await enableAutoUpdateCheck();

    await renderApp();

    expect(presentUpdatePrompt).toHaveBeenCalledTimes(1);
    expect(presentUpdatePrompt).toHaveBeenCalledWith(latest);
  });

  it('auto-prompts for a major update', async () => {
    const { fetchLatestRelease } = jest.requireMock('../src/update/appUpdate');
    const { presentUpdatePrompt } = jest.requireMock('../src/update/updatePrompt');
    const latest = nextRelease('major');
    fetchLatestRelease.mockResolvedValue(latest);
    await enableAutoUpdateCheck();

    await renderApp();

    expect(presentUpdatePrompt).toHaveBeenCalledTimes(1);
    expect(presentUpdatePrompt).toHaveBeenCalledWith(latest);
  });
});
