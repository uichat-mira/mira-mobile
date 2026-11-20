import React from 'react';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

import { CustomDrawer } from './CustomDrawer';

const mockNavigate = jest.fn();
const mockCreateCloudSession = jest.fn();
const mockCreatePairedSession = jest.fn();
let mockCloudState: {
  status: 'signed_in' | 'signed_out';
  account: { id: string } | null;
} = { status: 'signed_out', account: null };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

const mockListSessions = jest.fn<Promise<unknown[]>, []>(async () => []);
const mockCanDeleteSession = jest.fn(async () => true);

jest.mock('../api/miraHostClient', () => ({
  miraHostClient: {
    createSession: (...args: unknown[]) => mockCreatePairedSession(...args),
    canDeleteSession: () => mockCanDeleteSession(),
  },
}));

jest.mock('../runtime/runtimeRegistry', () => ({
  runtimeRegistry: {
    listSessions: () => mockListSessions(),
    cloud: { createSession: () => mockCreateCloudSession() },
  },
}));

jest.mock('../cloud/cloudAccountStore', () => {
  const useCloudAccountStore = (selector: (state: typeof mockCloudState) => unknown) =>
    selector(mockCloudState);
  useCloudAccountStore.getState = () => mockCloudState;
  return { useCloudAccountStore };
});

jest.mock('../settings/SettingsChoiceModal', () => ({
  SettingsChoiceModal: ({
    visible, options, onChange,
  }: {
    visible: boolean;
    options: Array<{ value: string; label: string; accessibilityLabel?: string }>;
    onChange: (value: string) => void;
  }) => {
    if (!visible) return null;
    const { Pressable, Text, View } = jest.requireActual('react-native');
    return (
      <View>
        {options.map(option => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            onPress={() => onChange(option.value)}
          >
            <Text>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    );
  },
}));

jest.mock('../theme/ThemeContext', () => {
  const { createSessionSurfaceThemeMock } = jest.requireActual(
    '../test/sessionSurfaceTestKit',
  );
  return createSessionSurfaceThemeMock();
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../connectivity/RemoteDiagnosticNotice', () => ({
  RemoteDiagnosticNotice: () => null,
}));
jest.mock('./SessionKindIcon', () => ({
  SessionKindIcon: () => null,
  getSessionVisualKindLabel: () => '普通对话',
}));
jest.mock('../hooks/useRoleNameMap', () => ({ useRoleNameMap: () => ({}) }));
jest.mock('lucide-react-native', () => ({
  Clock: () => null,
  FolderKanban: () => null,
  FolderOpen: () => null,
  Grid3x3: () => null,
  Image: () => null,
  Monitor: () => null,
  Search: () => null,
  Smartphone: () => null,
  SquarePen: () => null,
}));

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
  classifySessionLoadFailure: jest.fn(async () => ({
    kind: 'host_unreachable',
    title: '暂时无法连接 Mira Desktop',
    message: 'unavailable',
    primaryAction: { kind: 'retry', label: '重试' },
  })),
}));

const session = (id: string, title: string, updatedAt: string) => ({
  id,
  title,
  updatedAt: new Date(updatedAt),
  source: 'remote-host' as const,
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderDrawer = async (
  source: 'all' | 'cloud-host' | 'remote-host' = 'all',
): Promise<ReactTestRenderer> => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<CustomDrawer onClose={jest.fn()} activeSource={source} />);
  });
  await flush();
  return tree;
};

const collectText = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAll((node) => String(node.type) === 'Text')
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .map((child) => String(child));

describe('CustomDrawer session collection', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockListSessions.mockReset();
    mockCanDeleteSession.mockReset();
    mockCanDeleteSession.mockResolvedValue(true);
    mockCreateCloudSession.mockReset();
    mockCreatePairedSession.mockReset();
    mockCloudState = { status: 'signed_out', account: null };
  });

  it('creates a Cloud Agent thread from the shared drawer choice and binds account navigation', async () => {
    mockCloudState = { status: 'signed_in', account: { id: 'account-a' } };
    mockCreateCloudSession.mockResolvedValue({
      id: 'cloud-new', title: '新对话', source: 'cloud-host',
    });
    const tree = await renderDrawer('cloud-host');
    const button = tree.root.findAllByProps({ accessibilityLabel: '聊天' })[0]!;
    await act(async () => button.props.onPress());
    const option = tree.root.findByProps({ accessibilityLabel: '远程连接（Mira Cloud）' });
    await act(async () => {
      option.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCreateCloudSession).toHaveBeenCalledTimes(1);
    expect(mockCreatePairedSession).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('Chat', {
      sessionId: 'cloud-new', title: '新对话', source: 'cloud-host',
      cloudAccountId: 'account-a',
    });
    await act(async () => tree.unmount());
  });

  it('keeps paired Tailscale creation when it is explicitly selected', async () => {
    mockCloudState = { status: 'signed_in', account: { id: 'account-a' } };
    mockCreatePairedSession.mockResolvedValue({
      id: 'paired-new', title: '新对话', source: 'remote-host',
    });
    const tree = await renderDrawer('remote-host');
    await act(async () => tree.root.findAllByProps({ accessibilityLabel: '聊天' })[0]!.props.onPress());
    const option = tree.root.findByProps({ accessibilityLabel: '远程连接（Tailscale）' });
    await act(async () => {
      option.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCreateCloudSession).not.toHaveBeenCalled();
    expect(mockCreatePairedSession).toHaveBeenCalledWith(undefined, { agentEnabled: true });
    await act(async () => tree.unmount());
  });

  it('does not navigate into a stale Cloud account after a creation race', async () => {
    mockCloudState = { status: 'signed_in', account: { id: 'account-a' } };
    let finish!: (value: unknown) => void;
    mockCreateCloudSession.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const tree = await renderDrawer('cloud-host');
    await act(async () => tree.root.findAllByProps({ accessibilityLabel: '聊天' })[0]!.props.onPress());
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: '远程连接（Mira Cloud）' }).props.onPress();
    });
    mockCloudState = { status: 'signed_out', account: null };
    await act(async () => {
      finish({ id: 'cloud-new', title: '新对话' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockNavigate).not.toHaveBeenCalledWith('Chat', expect.anything());
    await act(async () => tree.unmount());
  });

  it('groups pinned threads above recent threads', async () => {
    mockListSessions.mockResolvedValue([
      session('thread-recent', '最近会话', '2026-08-28T00:10:00.000Z'),
      session('thread-pinned', '置顶会话', '2026-08-28T00:05:00.000Z'),
    ]);

    const tree = await renderDrawer();
    const texts = collectText(tree);

    expect(texts.indexOf('置顶')).toBeLessThan(texts.indexOf('最近'));
    expect(texts).toContain('置顶会话');
    expect(texts).toContain('最近会话');
    await act(async () => tree.unmount());
  });

  it('does not turn a Remote collection failure into an empty drawer', async () => {
    mockListSessions.mockRejectedValue(new Error('unreachable'));

    const tree = await renderDrawer();
    const texts = collectText(tree);

    expect(texts).not.toContain('暂无会话');
    await act(async () => tree.unmount());
  });

  it('shows the empty hint when the collection is genuinely empty', async () => {
    mockListSessions.mockResolvedValue([]);

    const tree = await renderDrawer();
    expect(collectText(tree)).toContain('暂无会话');
    await act(async () => tree.unmount());
  });
});
