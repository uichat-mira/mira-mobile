import React from 'react';
import { Alert, Text } from 'react-native';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { CloudAccountScreen } from './CloudAccountScreen';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';

const mockNavigate = jest.fn();
let mockFocusEnabled = false;
jest.mock('@react-navigation/native', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return {
    useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactModule.useEffect(() => {
        if (!mockFocusEnabled) return undefined;
        return callback();
      }, [callback]);
    },
  };
});
jest.mock('../settings/SettingsPageHeader', () => ({
  SettingsPageHeader: () => null,
}));
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      bg: { canvas: '#f5f4ed', card: '#faf9f5', soft: '#e8e6dc' },
      border: { default: '#e8e6dc', soft: '#f0eee6' },
      text: {
        ink: '#141413',
        base: '#3d3d3a',
        muted: '#5e5d59',
        soft: '#87867f',
      },
      primary: '#c96442',
      onPrimary: '#fff',
      status: {
        success: '#5db872',
        warning: '#d4a017',
        error: '#c64545',
        errorBg: '#fce8e8',
      },
    },
  }),
}));

const base = {
  account: null,
  expiresAt: null,
  message: null,
  busy: false,
  initialized: true,
  devices: [],
  devicesStatus: 'idle' as const,
  devicesMessage: null,
  revokingDeviceId: null,
};
const setState = (
  state: Partial<ReturnType<typeof useCloudAccountStore.getState>>,
) =>
  act(() => {
    useCloudAccountStore.setState(state);
  });
const textOf = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map(x =>
      Array.isArray(x.props.children)
        ? x.props.children.join('')
        : String(x.props.children),
    );
const labels = (tree: ReactTestRenderer) =>
  tree.root
    .findAll(
      x =>
        typeof x.props.onPress === 'function' &&
        typeof x.props.accessibilityLabel === 'string',
    )
    .map(x => x.props.accessibilityLabel as string);
let current: ReactTestRenderer | null = null;
const render = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<CloudAccountScreen />);
    current = tree;
  });
  return tree;
};

beforeEach(() => {
  mockFocusEnabled = false;
  mockNavigate.mockReset();
  setState({ ...base, status: 'signed_out' });
});
afterEach(() => {
  jest.restoreAllMocks();
  act(() => {
    current?.unmount();
    current = null;
  });
});

test('signed out keeps Cloud optional and allows browser login', async () => {
  const tree = await render();
  expect(textOf(tree).join(' ')).toContain('不影响本地模型与独立直连');
  expect(labels(tree)).toContain('使用浏览器登录 Mira Cloud');
  expect(labels(tree)).not.toContain('我的设备');
});

test('signed in shows account and active devices on a single page without subpage entries', async () => {
  setState({
    ...base,
    status: 'signed_in',
    account: { id: 'account-1', username: 'alice' },
    devicesStatus: 'loaded',
    devices: [
      {
        id: 'device-1',
        platform: 'mobile',
        clientName: 'Mira Mobile',
        clientVersion: '0.3.31',
        createdAt: '2026-11-01T00:00:00Z',
        lastSeenAt: '2026-11-20T00:00:00Z',
        revokedAt: null,
      },
    ],
    expiresAt: '2026-11-25T11:00:00.000Z',
  });
  const tree = await render();
  const all = textOf(tree).join(' ');
  expect(all).toContain('alice');
  expect(all).toContain('已连接');
  expect(all).toContain('我的设备');
  expect(all).toContain('Mira Mobile');
  expect(all).not.toContain('登录与安全');
  expect(all).not.toContain('会话有效期至');
  expect(labels(tree)).toEqual(
    expect.arrayContaining([
      '刷新设备列表',
      '撤销设备 Mira Mobile',
      '退出 Mira Cloud',
    ]),
  );
  expect(labels(tree)).not.toContain('登录与安全');
  expect(labels(tree)).not.toContain('检查登录状态');
  expect(labels(tree)).not.toContain('我的设备');
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('Cloud outage keeps account visible but never shows a green connected badge', async () => {
  setState({
    ...base,
    status: 'cloud_unavailable',
    account: { id: 'account-1', username: 'alice' },
    message: 'Mira Cloud 暂时不可用。本地模型和 Tailscale 直连不受影响。',
  });
  const tree = await render();
  expect(textOf(tree)).toContain('alice');
  expect(textOf(tree)).toContain('连接中断');
  expect(textOf(tree)).not.toContain('已连接');
  expect(labels(tree)).toContain('刷新设备列表');
  expect(labels(tree)).toContain('退出 Mira Cloud');
});

test('retry Cloud connection does not load devices when Cloud remains unavailable', async () => {
  const refresh = jest.fn(async () => undefined);
  const loadDevices = jest.fn(async () => undefined);
  setState({
    ...base,
    status: 'cloud_unavailable',
    account: { id: 'a', username: 'alice' },
    refresh,
    loadDevices,
  });
  const tree = await render();
  await act(async () => {
    tree.root
      .findByProps({ accessibilityLabel: '刷新设备列表' })
      .props.onPress();
    await Promise.resolve();
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(loadDevices).not.toHaveBeenCalled();
});

test('rejected session demands explicit browser reauthentication', async () => {
  setState({
    ...base,
    status: 'session_rejected',
    message: 'Mira Cloud 登录已失效，请重新登录。',
  });
  const tree = await render();
  expect(textOf(tree).join(' ')).toContain('登录已失效');
  expect(labels(tree)).toContain('重新登录 Mira Cloud');
  expect(labels(tree)).not.toContain('我的设备');
});

test('sign out requires confirmation and only invokes existing Cloud store action', async () => {
  const signOut = jest.fn(async () => undefined);
  setState({
    ...base,
    status: 'signed_in',
    account: { id: 'a', username: 'alice' },
    signOut,
  });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const tree = await render();
  act(() =>
    tree.root
      .findByProps({ accessibilityLabel: '退出 Mira Cloud' })
      .props.onPress(),
  );
  expect(signOut).not.toHaveBeenCalled();
  expect(alert.mock.calls[0]?.[1]).toContain('本地模型');
  const confirm = alert.mock.calls[0]?.[2]?.find(x => x.text === '退出登录');
  await act(async () => {
    confirm?.onPress?.();
    await Promise.resolve();
  });
  expect(signOut).toHaveBeenCalledTimes(1);
});

test('focus refreshes Cloud then loads devices on the same account page', async () => {
  const refresh = jest.fn(async () => undefined);
  const loadDevices = jest.fn(async () => undefined);
  mockFocusEnabled = true;
  setState({
    ...base,
    status: 'signed_in',
    account: { id: 'a', username: 'alice' },
    refresh,
    loadDevices,
  });
  await render();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(loadDevices).toHaveBeenCalledTimes(1);
});
