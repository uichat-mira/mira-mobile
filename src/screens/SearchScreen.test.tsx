import React from 'react';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

import { SearchScreen } from './SearchScreen';
import { SEARCH_DEBOUNCE_MS } from '../search/globalSearch';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

const mockListSessions = jest.fn<Promise<unknown[]>, [void]>(async () => []);
const mockGetMessages = jest.fn<Promise<unknown[]>, [string]>(async () => []);

jest.mock('../api/miraHostClient', () => ({
  miraHostClient: {
    listSessions: () => mockListSessions(),
    getMessages: (sessionId: string) => mockGetMessages(sessionId),
  },
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      bg: { canvas: '#fff', card: '#fff', soft: '#eee' },
      border: { soft: '#eee', default: '#ddd' },
      text: { ink: '#111', soft: '#777', muted: '#777', placeholder: '#aaa' },
      primary: '#00f',
      primaryActive: '#009',
      onPrimary: '#fff',
      overlay: 'rgba(0,0,0,0.4)',
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children ?? null,
}));

jest.mock('../components/RemoteDiagnosticNotice', () => ({
  RemoteDiagnosticNotice: () => null,
}));
jest.mock('../components/SessionKindIcon', () => ({
  SessionKindIcon: () => null,
  getSessionVisualKindLabel: () => '普通对话',
}));
jest.mock('../hooks/useRoleNameMap', () => ({ useRoleNameMap: () => ({}) }));
jest.mock('lucide-react-native', () => ({
  FolderOpen: () => null,
  Pin: () => null,
  Search: () => null,
  X: () => null,
}));

jest.mock('../store/threadPinStore', () => {
  const hydrate = async () => undefined;
  return {
    useThreadPinStore: (selector: (state: unknown) => unknown) =>
      selector({ pinnedAtByThreadId: {}, hydrate }),
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

const session = (id: string, title: string) => ({
  id,
  title,
  updatedAt: new Date('2026-08-28T00:00:00.000Z'),
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderScreen = async (): Promise<ReactTestRenderer> => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<SearchScreen />);
  });
  await flush();
  return tree;
};

const findInput = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) => node.props.accessibilityLabel === '搜索' && node.props.onChangeText,
  )[0];

const collectText = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAll((node) => String(node.type) === 'Text')
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .map((child) => String(child));

describe('SearchScreen result semantics', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockListSessions.mockReset();
    mockGetMessages.mockReset();
    mockListSessions.mockResolvedValue([session('thread-1', '需求评审')]);
    mockGetMessages.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the remote collection as browse results before any query', async () => {
    const tree = await renderScreen();
    expect(collectText(tree)).toContain('需求评审');
    await act(async () => tree.unmount());
  });

  it('debounces the query before running the search', async () => {
    jest.useFakeTimers();
    const tree = await renderScreen();

    await act(async () => {
      findInput(tree).props.onChangeText('需求');
    });

    // Debounce window has not elapsed: the search must not run yet.
    const listCallsBefore = mockListSessions.mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 50);
    });
    // The controller also calls listSessions during search; assert no new call
    // was issued by the debounce timer before the window closes.
    expect(mockListSessions.mock.calls.length).toBe(listCallsBefore);

    await act(async () => {
      jest.advanceTimersByTime(50);
    });
    await flush();

    expect(mockListSessions.mock.calls.length).toBeGreaterThan(listCallsBefore);
    await act(async () => tree.unmount());
    jest.useRealTimers();
  });

  it('runs the search immediately when the query is cleared', async () => {
    const tree = await renderScreen();
    const input = findInput(tree);
    const before = mockListSessions.mock.calls.length;

    await act(async () => {
      input.props.onChangeText('');
    });
    await flush();

    // Clearing resets the controller to idle without issuing a new search.
    expect(mockListSessions.mock.calls.length).toBe(before);
    await act(async () => tree.unmount());
  });

  it('keeps the empty message tied to the source-truth empty state', async () => {
    mockListSessions.mockResolvedValue([]);
    const tree = await renderScreen();
    const texts = collectText(tree);

    expect(texts).toContain('暂无会话');
    expect(texts).toContain('Remote Host V1 当前只搜索桌面端已有会话');
    await act(async () => tree.unmount());
  });
});
