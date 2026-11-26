import React from 'react';
import { Alert } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

import { SessionListScreen } from './SessionListScreen';
import { resolveSessionOpenTarget } from '../session/sessionNavigation';
import { useDesktopConnectionStore } from '../connectivity/desktopConnectionAuthority';

let mockFocusCallback: (() => void) | null = null;

jest.mock('@react-navigation/native', () => ({
  useNavigation: jest.fn(() => ({ navigate: jest.fn(), goBack: jest.fn() })),
  useFocusEffect: (callback: () => void) => {
    const ReactActual = jest.requireActual('react') as typeof import('react');
    mockFocusCallback = callback;
    ReactActual.useEffect(callback, [callback]);
  },
}));

jest.mock('../api/miraHostClient', () => ({
  miraHostClient: { canDeleteSession: jest.fn(async () => true) },
}));

jest.mock('../runtime/runtimeRegistry', () => ({
  runtimeRegistry: {
    listSessions: jest.fn(),
    deleteSession: jest.fn(),
    cloud: { canDeleteSession: jest.fn(async () => false) },
  },
}));

jest.mock('../theme/ThemeContext', () => {
  const { createSessionSurfaceThemeMock } = jest.requireActual(
    '../test/sessionSurfaceTestKit',
  );
  return createSessionSurfaceThemeMock();
});

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children ?? null,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../connectivity/ConnectionSourceDropdown', () => ({
  ConnectionSourceDropdown: ({
    onChange, options, footerAction,
  }: {
    onChange: (value: 'all' | 'remote-host' | 'local-provider' | 'cloud-host') => void;
    options: Array<{ value: string; disabled?: boolean; description?: string }>;
    footerAction?: { label: string; onPress: () => void };
  }) => {
    const { Pressable, Text, View } = jest.requireActual('react-native');
    return (
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="切换到本地连接"
          onPress={() => onChange('local-provider')}
        >
          <Text>切换到本地连接</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="切换到 Mira Cloud"
          disabled={options.find(option => option.value === 'cloud-host')?.disabled}
          onPress={() => onChange('cloud-host')}
        >
          <Text>切换到 Mira Cloud</Text>
          <Text>{options.find(option => option.value === 'cloud-host')?.description}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="切换到 Tailscale 直连"
          disabled={options.find(option => option.value === 'remote-host')?.disabled}
          onPress={() => onChange('remote-host')}
        >
          <Text>切换到 Tailscale 直连</Text>
          <Text>{options.find(option => option.value === 'remote-host')?.description}</Text>
        </Pressable>
        {footerAction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`断开连接 ${footerAction.label}`}
            onPress={footerAction.onPress}
          >
            <Text>{footerAction.label}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  },
}));
jest.mock('../session/SessionKindIcon', () => ({
  SessionKindIcon: () => null,
  getSessionVisualKindLabel: () => '普通对话',
}));
jest.mock('../session/CustomDrawer', () => ({ CustomDrawer: () => null }));
jest.mock('../components/EmptyStateIllustration', () => ({
  EmptyStateIllustration: () => null,
}));
jest.mock('../connectivity/RemoteDiagnosticNotice', () => ({
  RemoteDiagnosticNotice: () => null,
}));
jest.mock('./SessionSwipeRow', () => ({
  SessionSwipeRow: ({
    item,
    onOpen,
  }: {
    item: { title: string };
    onOpen: () => void;
  }) => {
    const { Pressable, Text } = jest.requireActual('react-native');
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.title}
        onPress={onOpen}
      >
        <Text>{item.title}</Text>
      </Pressable>
    );
  },
}));
jest.mock('../provider/providerConfigStore', () => ({
  ProviderConfigStore: class {
    async load() {
      return [];
    }
  },
}));
jest.mock('../hooks/useRoleNameMap', () => ({ useRoleNameMap: () => ({}) }));
jest.mock('lucide-react-native', () => ({
  Menu: () => null,
  Settings: () => null,
}));

// Stable store actions across renders; regenerating them would change the
// hydrate callbacks' identity and retrigger the collection effect every render.
jest.mock('../store/threadPinStore', () => {
  const { createSessionSurfacePinStoreMock } = jest.requireActual(
    '../test/sessionSurfaceTestKit',
  );
  return createSessionSurfacePinStoreMock({
    'thread-pinned': '2026-08-28T00:00:00.000Z',
  });
});

jest.mock('../store/threadReadStore', () => {
  const { createSessionSurfaceReadStoreMock } = jest.requireActual(
    '../test/sessionSurfaceTestKit',
  );
  return createSessionSurfaceReadStoreMock();
});

jest.mock('../connectivity/remoteConnectionDiagnostics', () => ({
  classifySessionLoadFailure: jest.fn(async (_error: unknown) => ({
    kind: 'host_unreachable',
    title: '暂时无法连接 Mira Desktop',
    message: '已配对，但当前没有足够证据判断 Desktop 离线。',
    primaryAction: { kind: 'retry', label: '重试' },
  })),
}));

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const sessionTitle = '需求评审';

const renderScreen = async (): Promise<ReactTestRenderer> => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<SessionListScreen />);
  });
  await flush();
  return tree;
};

const collectText = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAll((node) => String(node.type) === 'Text')
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .map((child) => String(child));

describe('SessionListScreen session collection', () => {
  const { runtimeRegistry } = jest.requireMock('../runtime/runtimeRegistry');

  beforeEach(() => {
    const { useNavigation } = jest.requireMock('@react-navigation/native');
    (useNavigation as jest.Mock).mockReturnValue({
      navigate: jest.fn(),
      goBack: jest.fn(),
    });
    runtimeRegistry.listSessions.mockReset();
    runtimeRegistry.deleteSession.mockReset();
    useDesktopConnectionStore.setState({
      mode: 'none',
      generation: 0,
      hydrated: true,
      transitioning: false,
      message: null,
    });
  });

  it('renders the loaded collection ordered with pinned sessions first', async () => {
    runtimeRegistry.listSessions.mockResolvedValue([
      { id: 'thread-recent', title: '最近会话', updatedAt: new Date('2026-08-28T00:10:00.000Z') },
      { id: 'thread-pinned', title: sessionTitle, updatedAt: new Date('2026-08-28T00:05:00.000Z') },
    ]);

    const tree = await renderScreen();
    const texts = collectText(tree);

    expect(texts).toContain(sessionTitle);
    expect(texts).toContain('最近会话');
    // Pinned section label must render above the recent section.
    expect(texts.indexOf('置顶')).toBeLessThan(texts.indexOf('最近对话'));
    await act(async () => tree.unmount());
  });

  it('loads exactly once on first focus and reloads on later focus', async () => {
    runtimeRegistry.listSessions.mockResolvedValue([]);

    const tree = await renderScreen();
    expect(runtimeRegistry.listSessions).toHaveBeenCalledTimes(1);

    await act(async () => {
      mockFocusCallback?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runtimeRegistry.listSessions).toHaveBeenCalledTimes(2);
    await act(async () => tree.unmount());
  });

  it('reloads the shared collection when the source filter changes', async () => {
    runtimeRegistry.listSessions.mockResolvedValue([]);

    const tree = await renderScreen();
    const initialAllCalls = runtimeRegistry.listSessions.mock.calls.filter(
      ([filter]: [string]) => filter === 'all',
    ).length;
    expect(initialAllCalls).toBe(1);

    const switcher = tree.root.findAll(
      (node) => node.props.accessibilityLabel === '切换到本地连接',
    )[0];
    await act(async () => {
      switcher.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runtimeRegistry.listSessions).toHaveBeenCalledWith('local-provider');
    await act(async () => tree.unmount());
  });

  it('selects an authenticated Cloud Host without using the paired Host route', async () => {
    const { useCloudAccountStore } = jest.requireActual('../cloud/cloudAccountStore');
    const original = useCloudAccountStore.getState();
    const { useNavigation } = jest.requireMock('@react-navigation/native');
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    (useNavigation as jest.Mock).mockReturnValue(navigation);
    runtimeRegistry.listSessions.mockImplementation(async (filter: string) =>
      filter === 'cloud-host'
        ? [{ id: 'desktop-cloud-thread', title: 'Mac 云端线程', source: 'cloud-host',
          updatedAt: new Date('2026-11-16T02:00:00.000Z') }]
        : []
    );
    useCloudAccountStore.setState({
      status: 'signed_in',
      account: { id: 'account-a', username: 'alice' },
      initialized: true,
    });
    useDesktopConnectionStore.setState({ mode: 'cloud', hydrated: true });

    let tree!: ReactTestRenderer;
    try {
      tree = await renderScreen();
      const picker = tree.root.findAll(
        node => node.props.accessibilityLabel === '切换到 Mira Cloud',
      )[0];
      expect(picker.props.disabled).toBe(false);
      await act(async () => {
        picker.props.onPress();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(runtimeRegistry.listSessions).toHaveBeenCalledWith('cloud-host');
      expect(collectText(tree)).toContain('Mac 云端线程');
      const row = tree.root.findAll(
        node => node.props.accessibilityLabel === 'Mac 云端线程',
      )[0];
      await act(async () => row.props.onPress());
      expect(navigation.navigate).toHaveBeenCalledWith('Chat', expect.objectContaining({
        sessionId: 'desktop-cloud-thread',
        source: 'cloud-host',
        cloudAccountId: 'account-a',
      }));
    } finally {
      if (tree) await act(async () => tree.unmount());
      useCloudAccountStore.setState(original);
    }
  });

  it('opens a private Host Agent thread without imposing local read-only', async () => {
    const { useCloudAccountStore } = jest.requireActual('../cloud/cloudAccountStore');
    const previous = useCloudAccountStore.getState();
    const { useNavigation } = jest.requireMock('@react-navigation/native');
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    (useNavigation as jest.Mock).mockReturnValue(navigation);
    runtimeRegistry.listSessions.mockImplementation(async (filter: string) =>
      filter === 'cloud-host'
        ? [{ id: 'old-agent', title: '旧 Agent 会话', source: 'cloud-host',
          workspaceId: null, agentEnabled: true,
          updatedAt: new Date('2026-11-16T02:00:00.000Z') }]
        : []
    );
    useCloudAccountStore.setState({
      status: 'signed_in', account: { id: 'account-a', username: 'alice' },
      initialized: true,
    });
    useDesktopConnectionStore.setState({ mode: 'cloud', hydrated: true });
    let tree!: ReactTestRenderer;
    try {
      tree = await renderScreen();
      const picker = tree.root.findAll(node =>
        node.props.accessibilityLabel === '切换到 Mira Cloud')[0];
      await act(async () => {
        picker.props.onPress();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      const row = tree.root.findAll(node =>
        node.props.accessibilityLabel === '旧 Agent 会话')[0];
      await act(async () => row.props.onPress());
      expect(navigation.navigate).toHaveBeenCalledWith('Chat', expect.objectContaining({
        sessionId: 'old-agent',
        source: 'cloud-host',
      }));
    } finally {
      if (tree) await act(async () => tree.unmount());
      useCloudAccountStore.setState(previous);
    }
  });

  it('ignores Cloud selection while Direct is active and exposes an explicit disconnect path', async () => {
    const { useCloudAccountStore } = jest.requireActual('../cloud/cloudAccountStore');
    const original = useCloudAccountStore.getState();
    runtimeRegistry.listSessions.mockResolvedValue([]);
    useCloudAccountStore.setState({
      status: 'signed_in',
      account: { id: 'account-a', username: 'alice' },
      initialized: true,
    });
    useDesktopConnectionStore.setState({ mode: 'direct', hydrated: true });

    let tree!: ReactTestRenderer;
    try {
      tree = await renderScreen();
      const cloudPicker = tree.root.findAll(
        node => node.props.accessibilityLabel === '切换到 Mira Cloud',
      )[0];
      expect(cloudPicker.props.disabled).toBe(true);
      const directPicker = tree.root.findAll(
        node => node.props.accessibilityLabel === '切换到 Tailscale 直连',
      )[0];
      expect(directPicker.props.disabled).toBe(false);
      expect(collectText(tree)).toContain('先断开 Tailscale 直连');
      expect(
        tree.root.findAll(
          node => node.props.accessibilityLabel === '断开连接 断开 Tailscale 直连',
        ).length,
      ).toBeGreaterThan(0);
    } finally {
      if (tree) await act(async () => tree.unmount());
      useCloudAccountStore.setState(original);
    }
  });

  it('activates Cloud only after the explicit connection selection', async () => {
    const { useCloudAccountStore } = jest.requireActual('../cloud/cloudAccountStore');
    const original = useCloudAccountStore.getState();
    runtimeRegistry.listSessions.mockResolvedValue([]);
    useCloudAccountStore.setState({
      status: 'signed_in',
      account: { id: 'account-a', username: 'alice' },
      initialized: true,
    });
    useDesktopConnectionStore.setState({ mode: 'none', hydrated: true });

    let tree!: ReactTestRenderer;
    try {
      tree = await renderScreen();
      expect(useDesktopConnectionStore.getState().mode).toBe('none');
      const picker = tree.root.findAll(
        node => node.props.accessibilityLabel === '切换到 Mira Cloud',
      )[0];
      expect(picker.props.disabled).toBe(false);

      await act(async () => {
        picker.props.onPress();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(useDesktopConnectionStore.getState().mode).toBe('cloud');
      expect(runtimeRegistry.listSessions).toHaveBeenCalledWith('cloud-host');
    } finally {
      if (tree) await act(async () => tree.unmount());
      useCloudAccountStore.setState(original);
    }
  });

  it('disconnects the active transport without changing the Cloud account', async () => {
    const { useCloudAccountStore } = jest.requireActual('../cloud/cloudAccountStore');
    const original = useCloudAccountStore.getState();
    const originalDisconnect = useDesktopConnectionStore.getState().disconnect;
    const disconnect = jest.fn(async () => {
      useDesktopConnectionStore.setState({ mode: 'none' });
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    runtimeRegistry.listSessions.mockResolvedValue([]);
    useCloudAccountStore.setState({
      status: 'signed_in',
      account: { id: 'account-a', username: 'alice' },
      initialized: true,
    });
    useDesktopConnectionStore.setState({
      mode: 'cloud', hydrated: true, disconnect,
    });

    let tree!: ReactTestRenderer;
    try {
      tree = await renderScreen();
      const action = tree.root.findAll(
        node => node.props.accessibilityLabel === '断开连接 断开 Mira Cloud 桌面连接',
      )[0];
      await act(async () => action.props.onPress());
      const buttons = alert.mock.calls[0]?.[2] as Array<{ text: string; onPress?: () => void }>;
      await act(async () => buttons.find(button => button.text === '断开')?.onPress?.());
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(useCloudAccountStore.getState().account?.id).toBe('account-a');
    } finally {
      if (tree) await act(async () => tree.unmount());
      useDesktopConnectionStore.setState({ disconnect: originalDisconnect });
      useCloudAccountStore.setState(original);
      alert.mockRestore();
    }
  });

  it('does not keep previous-source rows visible while a filter reload is pending', async () => {
    let resolveLocal!: (value: unknown[]) => void;
    runtimeRegistry.listSessions.mockImplementation((filter: string) => {
      if (filter === 'local-provider') {
        return new Promise((resolve) => {
          resolveLocal = resolve;
        });
      }
      return Promise.resolve([
        {
          id: 'remote-old',
          title: '远程旧会话',
          updatedAt: new Date('2026-08-28T00:10:00.000Z'),
        },
      ]);
    });

    const tree = await renderScreen();
    expect(collectText(tree)).toContain('远程旧会话');

    const switcher = tree.root.findAll(
      (node) => node.props.accessibilityLabel === '切换到本地连接',
    )[0];
    await act(async () => {
      switcher.props.onPress();
      await Promise.resolve();
    });

    expect(collectText(tree)).not.toContain('远程旧会话');

    await act(async () => {
      resolveLocal([
        {
          id: 'local-new',
          title: '本地新会话',
          source: 'local-provider',
          updatedAt: new Date('2026-08-28T00:11:00.000Z'),
        },
      ]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(collectText(tree)).toContain('本地新会话');
    await act(async () => tree.unmount());
  });

  it('does not degrade a Remote collection failure into an empty list', async () => {
    const { RemoteHostError } = jest.requireActual('../api/remoteHttp');
    runtimeRegistry.listSessions.mockImplementation(async () => {
      throw new RemoteHostError('NETWORK_ERROR', 'offline');
    });

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SessionListScreen />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const texts = collectText(tree);
    expect(texts).toContain('暂时无法连接 Mira Desktop');
    expect(texts).not.toContain('暂无会话');
    await act(async () => tree.unmount());
  });

  it('keeps the workspace session open path resolving to direct chat', () => {
    expect(
      resolveSessionOpenTarget({
        workspaceId: 'workspace-1',
        agentEnabled: false,
      }),
    ).toEqual({ kind: 'chat' });
  });

  it('opens an Agent session without a public project instead of blocking it', async () => {
    const { useNavigation } = jest.requireMock('@react-navigation/native');
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    (useNavigation as jest.Mock).mockReturnValue(navigation);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    runtimeRegistry.listSessions.mockResolvedValue([
      {
        id: 'thread-agent',
        title: 'Agent 会话',
        updatedAt: new Date('2026-08-28T00:10:00.000Z'),
        agentEnabled: true,
        workspaceId: null,
      },
    ]);

    const tree = await renderScreen();
    const row = tree.root.findAll(
      (node) =>
        node.props.accessibilityRole === 'button' &&
        node.props.accessibilityLabel === 'Agent 会话',
    )[0];

    await act(async () => {
      row.props.onPress();
    });

    // Desktop's default-Agent thread owns a private Host workspace and has no
    // public workspaceId, which is a valid state on Mobile.
    expect(alertSpy).not.toHaveBeenCalled();
    expect(navigation.navigate).toHaveBeenCalledWith(
      'Chat',
      expect.objectContaining({ sessionId: 'thread-agent' }),
    );

    alertSpy.mockRestore();
    (useNavigation as jest.Mock).mockReturnValue({
      navigate: jest.fn(),
      goBack: jest.fn(),
    });
    await act(async () => tree.unmount());
  });

  it('opens an ordinary workspace session directly through the Chat route', async () => {
    const { useNavigation } = jest.requireMock('@react-navigation/native');
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    (useNavigation as jest.Mock).mockReturnValue(navigation);
    runtimeRegistry.listSessions.mockResolvedValue([
      {
        id: 'thread-workspace',
        title: '项目会话',
        updatedAt: new Date('2026-08-28T00:10:00.000Z'),
        workspaceId: 'workspace-1',
      },
    ]);

    const tree = await renderScreen();
    const row = tree.root.findAll(
      (node) =>
        node.props.accessibilityRole === 'button' &&
        node.props.accessibilityLabel === '项目会话',
    )[0];

    await act(async () => {
      row.props.onPress();
    });

    expect(navigation.navigate).toHaveBeenCalledWith(
      'Chat',
      expect.objectContaining({ sessionId: 'thread-workspace' }),
    );
    (useNavigation as jest.Mock).mockReturnValue({
      navigate: jest.fn(),
      goBack: jest.fn(),
    });
    await act(async () => tree.unmount());
  });

  it('renders an empty state only when the host authoritatively lists nothing', async () => {
    runtimeRegistry.listSessions.mockResolvedValue([]);

    const tree = await renderScreen();
    const texts = collectText(tree);

    expect(texts).toContain('暂无会话');
    expect(texts).not.toContain('连接不可用');
    await act(async () => tree.unmount());
  });
});
