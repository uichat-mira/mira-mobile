import React from 'react';
import { Alert, Text } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

import { CloudAccountScreen } from './CloudAccountScreen';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';

let mockFocusEnabled = false;

jest.mock('@react-navigation/native', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return {
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

const baseState = {
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

let currentTree: ReactTestRenderer | null = null;

const renderScreen = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<CloudAccountScreen />);
    currentTree = tree;
    await Promise.resolve();
  });
  return tree;
};

const setCloudState = (
  state: Partial<ReturnType<typeof useCloudAccountStore.getState>>,
) => {
  act(() => {
    useCloudAccountStore.setState(state);
  });
};

const renderedStrings = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAllByType(Text)
    .map(node =>
      Array.isArray(node.props.children)
        ? node.props.children.join('')
        : String(node.props.children),
    );

const labels = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAll(
      node =>
        typeof node.props.onPress === 'function' &&
        typeof node.props.accessibilityLabel === 'string',
    )
    .map(node => node.props.accessibilityLabel as string);

describe('CloudAccountScreen baseline states', () => {
  beforeEach(() => {
    mockFocusEnabled = false;
    setCloudState({
      ...baseState,
      status: 'signed_out',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    act(() => {
      currentTree?.unmount();
      currentTree = null;
    });
  });

  it('keeps Mira Cloud optional and offers browser authorization when signed out', async () => {
    const tree = await renderScreen();
    const strings = renderedStrings(tree);

    expect(strings).toContain('Mira Cloud 账户');
    expect(strings).toContain('可选');
    expect(labels(tree)).toContain('使用浏览器登录 Mira Cloud');
    expect(strings.join(' ')).toContain('不会接触你的账户密码');
  });

  it('shows the signed-in account and session restore explanation', async () => {
    setCloudState({
      ...baseState,
      status: 'signed_in',
      account: { id: 'account-1', username: 'alice' },
      expiresAt: '2026-11-25T11:00:00.000Z',
    });
    const tree = await renderScreen();
    const strings = renderedStrings(tree);

    expect(strings).toContain('已登录 Mira Cloud');
    expect(strings).toContain('alice');
    expect(strings).toContain('会话有效期至 2026-11-25');
    expect(labels(tree)).toContain('退出 Mira Cloud 登录');
    expect(strings.join(' ')).toContain('不会删除 Local Provider 密钥');
  });

  it('keeps Local Provider and Tailscale usable during a temporary Cloud outage', async () => {
    setCloudState({
      ...baseState,
      status: 'cloud_unavailable',
      account: { id: 'account-1', username: 'alice' },
      expiresAt: '2026-11-25T11:00:00.000Z',
      message: 'Mira Cloud 暂时不可用。本地模型和 Tailscale 直连不受影响。',
    });
    const tree = await renderScreen();
    const strings = renderedStrings(tree);
    const joined = strings.join(' ');

    expect(strings).toContain('Mira Cloud 暂时不可用');
    expect(labels(tree)).toContain('重试连接');
    expect(labels(tree)).toContain('尝试退出 Mira Cloud 登录');
    expect(joined).toContain('本地模型和 Tailscale 直连仍然可用');
  });

  it('asks for reauthentication when the session was rejected', async () => {
    setCloudState({
      ...baseState,
      status: 'session_rejected',
      message: 'Mira Cloud 登录已失效，请重新登录。',
    });
    const tree = await renderScreen();
    const strings = renderedStrings(tree);

    expect(strings).toContain('Mira Cloud 登录已失效');
    expect(labels(tree)).toContain('重新登录 Mira Cloud');
  });

  it('shows server-returned devices and their revoked state without guessing the current device', async () => {
    const revokedDesktop = {
      id: 'desktop-1',
      platform: 'desktop' as const,
      clientName: 'Mira Desktop',
      clientVersion: '1.0.0',
      createdAt: '2026-10-18T08:00:00.000Z',
      lastSeenAt: '2026-10-24T09:00:00.000Z',
      revokedAt: '2026-10-25T10:00:00.000Z',
    };
    setCloudState({
      ...baseState,
      status: 'signed_in',
      account: { id: 'account-1', username: 'alice' },
      expiresAt: '2026-11-25T11:00:00.000Z',
      devices: [
        {
          id: 'mobile-1',
          platform: 'mobile',
          clientName: 'Mira Mobile',
          clientVersion: '0.3.17',
          createdAt: '2026-10-20T08:00:00.000Z',
          lastSeenAt: '2026-10-25T09:00:00.000Z',
          revokedAt: null,
        },
        revokedDesktop,
      ],
      devicesStatus: 'loaded',
    });
    const tree = await renderScreen();
    const strings = renderedStrings(tree);

    expect(strings).toContain('我的 Mira 设备');
    expect(strings).toContain('Mira Mobile');
    expect(strings).toContain('Mira Desktop');
    expect(strings).toContain('已撤销');
    expect(strings).toContain('撤销于 2026-10-25');
    expect(strings).not.toContain('此设备');
    expect(labels(tree)).toContain('撤销设备 Mira Mobile');
    expect(labels(tree)).not.toContain('撤销设备 Mira Desktop');
  });

  it('renders a clear empty device list state', async () => {
    setCloudState({
      ...baseState,
      status: 'signed_in',
      account: { id: 'account-1', username: 'alice' },
      expiresAt: '2026-11-25T11:00:00.000Z',
      devices: [],
      devicesStatus: 'loaded',
    });
    const tree = await renderScreen();
    const strings = renderedStrings(tree);

    expect(strings).toContain('Mira Cloud 尚未返回任何设备。');
    expect(labels(tree)).not.toContain('撤销设备 Mira Mobile');
  });

  it('keeps a retryable device-list outage distinct from account and revoke failures', async () => {
    setCloudState({
      ...baseState,
      status: 'signed_in',
      account: { id: 'account-1', username: 'alice' },
      expiresAt: '2026-11-25T11:00:00.000Z',
      devicesStatus: 'unavailable',
      devicesMessage: '无法连接 Mira Cloud，暂时无法读取设备列表。',
    });
    const tree = await renderScreen();
    const strings = renderedStrings(tree);

    expect(strings).toContain('无法连接 Mira Cloud，暂时无法读取设备列表。');
    expect(labels(tree)).toContain('重试读取设备列表');
    expect(strings).not.toContain('Mira Cloud 已确认撤销这台设备。');
  });

  it('loads devices when a focused screen finishes cold-start authentication', async () => {
    mockFocusEnabled = true;
    const refresh = jest.fn(async () => undefined);
    const loadDevices = jest.fn(async () => {
      useCloudAccountStore.setState({ devicesStatus: 'loaded' });
    });
    setCloudState({
      ...baseState,
      initialized: false,
      status: 'loading',
      refresh,
      loadDevices,
    });

    const tree = await renderScreen();
    expect(refresh).not.toHaveBeenCalled();
    expect(loadDevices).not.toHaveBeenCalled();

    await act(async () => {
      useCloudAccountStore.setState({
        initialized: true,
        status: 'signed_in',
        account: { id: 'account-1', username: 'alice' },
        expiresAt: '2026-11-25T11:00:00.000Z',
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(loadDevices).toHaveBeenCalledTimes(1);
    expect(renderedStrings(tree)).not.toContain('正在读取设备列表…');
  });

  it('retries Cloud connection and loads the devices without leaving the screen', async () => {
    const refresh = jest.fn(async () => {
      useCloudAccountStore.setState({ status: 'signed_in' });
    });
    const loadDevices = jest.fn(async () => {
      useCloudAccountStore.setState({ devicesStatus: 'loaded' });
    });
    setCloudState({
      ...baseState,
      status: 'cloud_unavailable',
      account: { id: 'account-1', username: 'alice' },
      expiresAt: '2026-11-25T11:00:00.000Z',
      devicesStatus: 'loaded',
      refresh,
      loadDevices,
    });
    const tree = await renderScreen();
    const retry = tree.root.findAll(
      node => node.props.accessibilityLabel === '重试连接',
    )[0];
    expect(retry).toBeDefined();

    await act(async () => {
      retry?.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(loadDevices).toHaveBeenCalledTimes(1);
    expect(useCloudAccountStore.getState().status).toBe('signed_in');
  });

  it('retries an unavailable device list through a fresh session check', async () => {
    const refresh = jest.fn(async () => undefined);
    const loadDevices = jest.fn(async () => {
      useCloudAccountStore.setState({ devicesStatus: 'loaded' });
    });
    setCloudState({
      ...baseState,
      status: 'signed_in',
      account: { id: 'account-1', username: 'alice' },
      expiresAt: '2026-11-25T11:00:00.000Z',
      devicesStatus: 'unavailable',
      devicesMessage: '暂时无法读取设备列表。',
      refresh,
      loadDevices,
    });
    const tree = await renderScreen();
    const retry = tree.root.findAll(
      node => node.props.accessibilityLabel === '重试读取设备列表',
    )[0];
    expect(retry).toBeDefined();

    await act(async () => {
      retry?.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(loadDevices).toHaveBeenCalledTimes(1);
    expect(renderedStrings(tree)).not.toContain('正在读取设备列表…');
  });

  it('does not load devices if a Cloud retry remains unavailable', async () => {
    const refresh = jest.fn(async () => undefined);
    const loadDevices = jest.fn(async () => undefined);
    setCloudState({
      ...baseState,
      status: 'cloud_unavailable',
      account: { id: 'account-1', username: 'alice' },
      expiresAt: '2026-11-25T11:00:00.000Z',
      refresh,
      loadDevices,
    });
    const tree = await renderScreen();
    const retry = tree.root.findAll(
      node => node.props.accessibilityLabel === '重试连接',
    )[0];

    await act(async () => {
      retry?.props.onPress();
      await Promise.resolve();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(loadDevices).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation that revoking may remove this installation', async () => {
    const revokeDevice = jest.fn();
    const device = {
      id: 'mobile-1',
      platform: 'mobile' as const,
      clientName: 'Mira Mobile',
      clientVersion: '0.3.17',
      createdAt: '2026-10-20T08:00:00.000Z',
      lastSeenAt: '2026-10-25T09:00:00.000Z',
      revokedAt: null,
    };
    setCloudState({
      ...baseState,
      status: 'signed_in',
      account: { id: 'account-1', username: 'alice' },
      expiresAt: '2026-11-25T11:00:00.000Z',
      devices: [device],
      devicesStatus: 'loaded',
      revokeDevice,
    });
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const tree = await renderScreen();

    expect(renderedStrings(tree)).not.toContain('Mira Cloud 已确认撤销这台设备。');
    const button = tree.root.findAll(
      node =>
        typeof node.props.onPress === 'function' &&
        node.props.accessibilityLabel === '撤销设备 Mira Mobile',
    )[0];
    expect(button).toBeDefined();
    act(() => {
      button?.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, body, buttons] = alertSpy.mock.calls[0] as [
      string,
      string,
      Array<{ text: string; onPress?: () => void }>,
    ];
    expect(title).toContain('撤销');
    expect(body).toContain('如果撤销的是本机');
    expect(body).toContain('需要重新登录');
    expect(revokeDevice).not.toHaveBeenCalled();

    const confirm = buttons.find(item => item.text === '撤销设备');
    act(() => {
      confirm?.onPress?.();
    });
    expect(revokeDevice).toHaveBeenCalledWith('mobile-1');
    expect(renderedStrings(tree)).not.toContain('Mira Cloud 已确认撤销这台设备。');
  });

  it('shows a confirmed current-device revoke as reauthentication, never as a valid session', async () => {
    setCloudState({
      ...baseState,
      status: 'session_rejected',
      account: null,
      expiresAt: null,
      message:
        'Mira Cloud 已确认撤销这台设备；本机 Cloud 登录已失效，请重新登录。',
    });
    const tree = await renderScreen();
    const strings = renderedStrings(tree);

    expect(strings).toContain('Mira Cloud 登录已失效');
    expect(strings).toContain(
      'Mira Cloud 已确认撤销这台设备；本机 Cloud 登录已失效，请重新登录。',
    );
    expect(labels(tree)).toContain('重新登录 Mira Cloud');
  });
});
