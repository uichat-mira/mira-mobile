import React from 'react';
import { Alert, Text } from 'react-native';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { activeCloudDevices, CloudDevicesScreen } from './CloudDevicesScreen';
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

const active = {
  id: 'mobile-1',
  platform: 'mobile' as const,
  clientName: 'Mira Mobile',
  clientVersion: '0.3.31',
  createdAt: '2026-10-20T08:00:00.000Z',
  lastSeenAt: '2026-10-25T09:00:00.000Z',
  revokedAt: null,
};
const revoked = {
  id: 'desktop-2',
  platform: 'desktop' as const,
  clientName: '已撤销的 Mac',
  clientVersion: '0.3.30',
  createdAt: '2026-10-18T08:00:00.000Z',
  lastSeenAt: '2026-10-24T09:00:00.000Z',
  revokedAt: '2026-10-25T10:00:00.000Z',
};
const base = {
  account: { id: 'a', username: 'alice' },
  status: 'signed_in' as const,
  expiresAt: '2026-11-25T11:00:00.000Z',
  message: null,
  busy: false,
  initialized: true,
  devices: [active, revoked],
  devicesStatus: 'loaded' as const,
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
    tree = renderer.create(<CloudDevicesScreen />);
    current = tree;
  });
  return tree;
};

beforeEach(() => {
  mockNavigate.mockReset();
  mockFocusEnabled = false;
  setState(base);
});
afterEach(() => {
  jest.restoreAllMocks();
  act(() => {
    current?.unmount();
    current = null;
  });
});

test('filters revoked records without removing server-owned state or inventing current device', async () => {
  const tree = await render();
  expect(activeCloudDevices([active, revoked])).toEqual([active]);
  expect(useCloudAccountStore.getState().devices).toEqual([active, revoked]);
  const all = textOf(tree).join(' ');
  expect(all).toContain('Mira Mobile');
  expect(all).toContain('0.3.31');
  expect(all).not.toContain('已撤销的 Mac');
  expect(all).not.toContain('已撤销设备历史');
  expect(all).not.toContain('当前设备');
  expect(all).not.toContain('iOS');
  expect(labels(tree)).toContain('撤销设备 Mira Mobile');
  expect(labels(tree)).not.toContain('撤销设备 已撤销的 Mac');
});

test('revoke requires confirmation, preserves ownership and does not claim success prematurely', async () => {
  const revokeDevice = jest.fn(async () => undefined);
  setState({ ...base, revokeDevice });
  const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const tree = await render();
  act(() =>
    tree.root
      .findByProps({ accessibilityLabel: '撤销设备 Mira Mobile' })
      .props.onPress(),
  );
  expect(revokeDevice).not.toHaveBeenCalled();
  expect(spy.mock.calls[0]?.[0]).toContain('撤销');
  expect(spy.mock.calls[0]?.[1]).toContain('如果撤销的是本机');
  const button = spy.mock.calls[0]?.[2]?.find(x => x.text === '撤销设备');
  await act(async () => {
    button?.onPress?.();
    await Promise.resolve();
  });
  expect(revokeDevice).toHaveBeenCalledWith('mobile-1');
  expect(textOf(tree).join(' ')).not.toContain('已确认撤销');
});

test('outage preserves cached devices but disables revocation', async () => {
  setState({ ...base, status: 'cloud_unavailable' });
  const tree = await render();
  expect(textOf(tree).join(' ')).toContain('设备信息可能不是最新的');
  expect(textOf(tree).join(' ')).toContain('Mira Mobile');
  expect(
    tree.root.findByProps({ accessibilityLabel: '撤销设备 Mira Mobile' }).props
      .disabled,
  ).toBe(true);
});

test('retries a failed device list through refreshed Cloud authority', async () => {
  const refresh = jest.fn(async () => undefined);
  const loadDevices = jest.fn(async () => {
    useCloudAccountStore.setState({ devicesStatus: 'loaded' });
  });
  setState({
    ...base,
    devicesStatus: 'unavailable',
    devicesMessage: '无法读取设备列表',
    refresh,
    loadDevices,
  });
  const tree = await render();
  expect(textOf(tree)).toContain('无法读取设备列表');
  await act(async () => {
    tree.root
      .findByProps({ accessibilityLabel: '重试读取设备列表' })
      .props.onPress();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(loadDevices).toHaveBeenCalledTimes(1);
});

test('shows empty state when only revoked history remains', async () => {
  setState({ ...base, devices: [revoked] });
  const tree = await render();
  expect(textOf(tree)).toContain('暂无已授权设备');
  expect(textOf(tree).join(' ')).not.toContain('已撤销的 Mac');
  expect(labels(tree)).not.toContain('撤销设备 已撤销的 Mac');
});

test('rejected Cloud account blocks device list and routes back to login', async () => {
  setState({ ...base, status: 'session_rejected', account: null, devices: [] });
  const tree = await render();
  expect(textOf(tree).join(' ')).toContain('登录已失效');
  expect(labels(tree)).not.toContain('撤销设备 Mira Mobile');
  act(() =>
    tree.root.findByProps({ accessibilityLabel: '返回云账户' }).props.onPress(),
  );
  expect(mockNavigate).toHaveBeenCalledWith('CloudAccount');
});

test('focus fetches devices only for a valid Cloud session', async () => {
  const loadDevices = jest.fn(async () => undefined);
  mockFocusEnabled = true;
  setState({ ...base, loadDevices });
  await render();
  expect(loadDevices).toHaveBeenCalledTimes(1);
});
