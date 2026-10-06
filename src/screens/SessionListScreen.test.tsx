import React from 'react';
import { Alert } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

import { SessionListScreen } from './SessionListScreen';
import { resolveSessionOpenTarget } from '../session/sessionNavigation';

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
    onChange,
  }: {
    onChange: (value: 'all' | 'remote-host' | 'local-provider') => void;
  }) => {
    const { Pressable, Text } = jest.requireActual('react-native');
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="切换到本地连接"
        onPress={() => onChange('local-provider')}
      >
        <Text>切换到本地连接</Text>
      </Pressable>
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
    expect(texts).toContain('连接不可用');
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

  it('surfaces the Agent workspace contract error instead of navigating', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    runtimeRegistry.listSessions.mockResolvedValue([
      {
        id: 'thread-agent',
        title: 'Agent 会话',
        updatedAt: new Date('2026-08-28T00:10:00.000Z'),
        agentEnabled: true,
        workspaceId: '   ',
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

    expect(alertSpy).toHaveBeenCalledWith(
      '无法打开会话',
      '该 Agent 会话缺少项目归属，无法在移动端打开。',
    );

    alertSpy.mockRestore();
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
