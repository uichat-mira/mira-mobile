import React from 'react';
import { Text } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

import { CloudAuthCallbackScreen } from './CloudAuthCallbackScreen';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';

var mockReplace: jest.Mock;
var mockReset: jest.Mock;
var mockRoutes: Array<{ name: string }>;
var mockRouteParams:
  | { code?: string; state?: string; error?: string }
  | undefined;

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: mockRouteParams }),
  useNavigation: () => ({
    popTo: (...args: unknown[]) => mockReplace(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    reset: (...args: unknown[]) => mockReset(...args),
    getState: () => ({ routes: mockRoutes }),
  }),
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      bg: { canvas: '#fff', card: '#faf9f5', soft: '#eee' },
      border: { default: '#ddd' },
      text: { ink: '#111', base: '#333', soft: '#777', muted: '#777' },
      primary: '#c96442',
      onPrimary: '#fff',
      status: {
        success: '#0a0',
        warning: '#aa0',
        error: '#c00',
        errorBg: '#fee',
      },
    },
  }),
}));

jest.mock('../cloud/cloudAuthService', () => {
  const actual = jest.requireActual('../cloud/cloudAuthService');
  const completeSignIn = jest.fn();
  return {
    ...actual,
    __cloudAuthMocks: { completeSignIn },
    cloudAuthService: {
      restoreSession: jest.fn(),
      beginSignIn: jest.fn(),
      completeSignIn,
      logout: jest.fn(),
      cancelPendingSignIn: jest.fn(),
    },
  };
});

const authModule = jest.requireMock('../cloud/cloudAuthService') as {
  __cloudAuthMocks: { completeSignIn: jest.Mock };
  CloudAuthServiceError: typeof import('../cloud/cloudAuthService').CloudAuthServiceError;
};
const authMocks = authModule.__cloudAuthMocks;

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

let currentTree: ReactTestRenderer | null = null;

const renderScreen = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<CloudAuthCallbackScreen />);
    currentTree = tree;
  });
  await flush();
  return tree;
};

const renderedStrings = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAllByType(Text)
    .map(node =>
      Array.isArray(node.props.children)
        ? node.props.children.join('')
        : String(node.props.children),
    );

describe('CloudAuthCallbackScreen', () => {
  beforeEach(() => {
    mockReplace = jest.fn();
    mockReset = jest.fn();
    mockRoutes = [{ name: 'CloudAuthCallback' }];
    mockRouteParams = {
      code: `mca_v1.${'a'.repeat(22)}.${'b'.repeat(43)}`,
      state: 'state-0123456789-abcdef',
    };
    authMocks.completeSignIn.mockReset();
    act(() => {
      useCloudAccountStore.setState({
        status: 'loading',
        account: null,
        expiresAt: null,
        message: null,
        busy: false,
        initialized: true,
      });
    });
  });

  afterEach(() => {
    act(() => {
      currentTree?.unmount();
      currentTree = null;
    });
  });

  it('completes the callback and shows the recovered session', async () => {
    authMocks.completeSignIn.mockResolvedValue({
      status: 'signed_in',
      account: { id: 'account-1', username: 'alice' },
      expiresAt: '2026-11-25T11:00:00.000Z',
    });
    const tree = await renderScreen();

    expect(authMocks.completeSignIn).toHaveBeenCalledWith({
      code: mockRouteParams?.code,
      state: mockRouteParams?.state,
      error: undefined,
    });
    expect(renderedStrings(tree)).toContain('已登录 Mira Cloud');
  });

  it('restores a usable application root when launched by a cold OAuth callback', async () => {
    authMocks.completeSignIn.mockResolvedValue({
      status: 'signed_in',
      account: { id: 'account-1', username: 'alice' },
      expiresAt: '2026-11-25T11:00:00.000Z',
    });
    const tree = await renderScreen();
    const returnButton = tree.root.findByProps({
      accessibilityLabel: '返回 Mira Cloud 账户',
    });
    act(() => { returnButton.props.onPress(); });

    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockReset).toHaveBeenCalledWith({
      index: 1,
      routes: [{ name: 'Bootstrap' }, { name: 'CloudAccount' }],
    });
  });

  it('preserves the existing Cloud Account route in a warm callback', async () => {
    mockRoutes = [
      { name: 'SessionList' },
      { name: 'CloudAccount' },
      { name: 'CloudAuthCallback' },
    ];
    authMocks.completeSignIn.mockResolvedValue({
      status: 'signed_in',
      account: { id: 'account-1', username: 'alice' },
      expiresAt: '2026-11-25T11:00:00.000Z',
    });
    const tree = await renderScreen();
    const returnButton = tree.root.findByProps({
      accessibilityLabel: '返回 Mira Cloud 账户',
    });
    act(() => { returnButton.props.onPress(); });

    expect(mockReplace).toHaveBeenCalledWith('CloudAccount');
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('reports a failed callback without hiding the reason', async () => {
    authMocks.completeSignIn.mockRejectedValue(
      new authModule.CloudAuthServiceError(
        'invalid_state',
        '登录回调校验失败，请重新发起登录。',
      ),
    );
    const tree = await renderScreen();
    const strings = renderedStrings(tree);

    expect(strings).toContain('未完成 Mira Cloud 登录');
    expect(strings).toContain('登录回调校验失败，请重新发起登录。');
  });
});
