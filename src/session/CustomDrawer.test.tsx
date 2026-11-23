import React from 'react';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

import { CustomDrawer } from './CustomDrawer';

let mockCloudState: {
  status: string;
  account: { id: string; username: string } | null;
} = { status: 'signed_out', account: null };

jest.mock('../cloud/cloudAccountStore', () => ({
  useCloudAccountStore: (selector: (state: typeof mockCloudState) => unknown) =>
    selector(mockCloudState),
}));

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

const mockListSessions = jest.fn<Promise<unknown[]>, []>(async () => []);
const mockCanDeleteSession = jest.fn(async () => true);

jest.mock('../api/miraHostClient', () => ({
  miraHostClient: {
    createSession: jest.fn(),
    canDeleteSession: () => mockCanDeleteSession(),
  },
}));

jest.mock('../runtime/runtimeRegistry', () => ({
  runtimeRegistry: {
    listSessions: () => mockListSessions(),
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
  User: () => null,
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
  onClose: () => void = jest.fn(),
): Promise<ReactTestRenderer> => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<CustomDrawer onClose={onClose} />);
  });
  await flush();
  return tree;
};

const setCloudAccount = (
  status: string,
  account: { id: string; username: string } | null,
) => {
  mockCloudState = { status, account };
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
    setCloudAccount('signed_out', null);
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

describe('CustomDrawer Cloud account entry', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockListSessions.mockReset();
    mockListSessions.mockResolvedValue([]);
    mockCanDeleteSession.mockReset();
    mockCanDeleteSession.mockResolvedValue(true);
    setCloudAccount('signed_out', null);
  });

  it('replaces the static M placeholder with an explicit signed-out entry', async () => {
    const tree = await renderDrawer();
    const texts = collectText(tree);

    expect(texts).toContain('未登录');
    expect(texts).not.toContain('M');
    await act(async () => tree.unmount());
  });

  it('opens the existing CloudAccount screen when the entry is pressed', async () => {
    setCloudAccount('signed_in', { id: 'account-alice', username: 'alice' });
    const onClose = jest.fn();
    const tree = await renderDrawer(onClose);

    const entry = tree.root.findAll(
      node =>
        node.props.testID === 'drawer-account-entry' &&
        typeof node.props.onPress === 'function',
    )[0];
    expect(entry.props.accessibilityRole).toBe('button');
    expect(entry.props.accessibilityLabel).toContain('alice');

    await act(async () => entry.props.onPress());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('CloudAccount');
    await act(async () => tree.unmount());
  });

  it('shows the verified identity and initial when signed in', async () => {
    setCloudAccount('signed_in', { id: 'account-alice', username: 'alice' });
    const tree = await renderDrawer();
    const texts = collectText(tree);

    expect(texts).toContain('alice');
    expect(texts).toContain('A');
    await act(async () => tree.unmount());
  });

  it('keeps the identity but marks a Cloud outage as an interruption', async () => {
    setCloudAccount('cloud_unavailable', {
      id: 'account-alice',
      username: 'alice',
    });
    const tree = await renderDrawer();
    const texts = collectText(tree);

    expect(texts).toContain('alice');
    expect(texts).toContain('Cloud 连接中断');
    expect(texts).not.toContain('未登录');
    await act(async () => tree.unmount());
  });

  it('drops the previous account when the Cloud session is rejected', async () => {
    setCloudAccount('session_rejected', {
      id: 'account-alice',
      username: 'alice',
    });
    const tree = await renderDrawer();
    const texts = collectText(tree);

    expect(texts).toContain('登录已失效');
    expect(texts).not.toContain('alice');
    await act(async () => tree.unmount());
  });

  it('does not flash a default identity while Cloud state is loading', async () => {
    setCloudAccount('loading', null);
    const tree = await renderDrawer();
    const texts = collectText(tree);

    expect(texts).toContain('检查中');
    expect(texts).not.toContain('未登录');
    expect(texts).not.toContain('M');
    await act(async () => tree.unmount());
  });

  it('truncates a long username without displacing the chat action', async () => {
    const username = 'a-very-long-cloud-username-that-needs-ellipsis';
    setCloudAccount('signed_in', { id: 'account-long', username });
    const tree = await renderDrawer();

    const name = tree.root.findAll(
      node => node.props.children === username && node.props.numberOfLines === 1,
    );
    expect(name.length).toBeGreaterThan(0);
    expect(
      tree.root.findAll(node => node.props.accessibilityLabel === '聊天').length,
    ).toBeGreaterThan(0);
    await act(async () => tree.unmount());
  });

  it('switches the visible identity immediately after an account change', async () => {
    setCloudAccount('signed_in', { id: 'account-alice', username: 'alice' });
    const onClose = jest.fn();
    const tree = await renderDrawer(onClose);
    expect(collectText(tree)).toContain('alice');

    setCloudAccount('signed_in', { id: 'account-bob', username: 'bob' });
    await act(async () => {
      tree.update(<CustomDrawer onClose={onClose} />);
    });

    const texts = collectText(tree);
    expect(texts).toContain('bob');
    expect(texts).not.toContain('alice');
    await act(async () => tree.unmount());
  });
});
