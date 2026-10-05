import React from 'react';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

import { CustomDrawer } from './CustomDrawer';

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

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      bg: { canvas: '#fff', card: '#fff', soft: '#eee' },
      border: { soft: '#eee', default: '#ddd' },
      text: { ink: '#111', base: '#222', soft: '#777', muted: '#777', placeholder: '#aaa' },
      primary: '#00f',
      primaryActive: '#009',
      onPrimary: '#fff',
      overlay: 'rgba(0,0,0,0.4)',
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('./RemoteDiagnosticNotice', () => ({
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
  const hydrate = async () => undefined;
  return {
    useThreadPinStore: (selector: (state: unknown) => unknown) =>
      selector({
        pinnedAtByThreadId: { 'thread-pinned': '2026-08-28T00:00:00.000Z' },
        hydrate,
      }),
  };
});

jest.mock('../store/threadReadStore', () => {
  const hydrate = async () => undefined;
  const syncSessions = async () => undefined;
  return {
    selectThreadUnread: () => false,
    useThreadReadStore: (selector: (state: unknown) => unknown) =>
      selector({ progressByThreadId: {}, hydrate, syncSessions }),
  };
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

const renderDrawer = async (): Promise<ReactTestRenderer> => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<CustomDrawer onClose={jest.fn()} />);
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
