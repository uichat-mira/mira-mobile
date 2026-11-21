import React from 'react';
import { Alert, Text } from 'react-native';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { CloudSecurityScreen } from './CloudSecurityScreen';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';

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
  account: { id: 'a', username: 'alice' },
  status: 'signed_in' as const,
  expiresAt: '2026-11-25T11:00:00.000Z',
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
const texts = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map(x =>
      Array.isArray(x.props.children)
        ? x.props.children.join('')
        : String(x.props.children),
    );
let current: ReactTestRenderer | null = null;
const render = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<CloudSecurityScreen />);
    current = tree;
  });
  return tree;
};
beforeEach(() => setState(base));
afterEach(() => {
  jest.restoreAllMocks();
  act(() => {
    current?.unmount();
    current = null;
  });
});

test('signed-in security page displays session truth and isolation', async () => {
  const tree = await render();
  const s = texts(tree).join(' ');
  expect(s).toContain('已登录 Mira Cloud');
  expect(s).toContain('alice');
  expect(s).toContain('会话有效期至 2026-11-25');
  expect(s).toContain('退出不会影响这台设备上的模型配置');
});

test('Cloud unavailable keeps cached account but exposes actionable retry', async () => {
  const refresh = jest.fn(async () => undefined);
  setState({ ...base, status: 'cloud_unavailable', refresh });
  const tree = await render();
  expect(texts(tree)).toContain('云服务暂时不可用');
  await act(async () => {
    tree.root.findByProps({ accessibilityLabel: '重试连接' }).props.onPress();
    await Promise.resolve();
  });
  expect(refresh).toHaveBeenCalledTimes(1);
});

test('security logout requires explicit confirmation and uses existing Cloud action', async () => {
  const signOut = jest.fn(async () => undefined);
  setState({ ...base, signOut });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const tree = await render();
  act(() =>
    tree.root.findByProps({ accessibilityLabel: '退出登录' }).props.onPress(),
  );
  expect(signOut).not.toHaveBeenCalled();
  expect(alert.mock.calls[0]?.[1]).toContain('本地模型凭据');
  const confirm = alert.mock.calls[0]?.[2]?.find(x => x.text === '退出登录');
  await act(async () => {
    confirm?.onPress?.();
    await Promise.resolve();
  });
  expect(signOut).toHaveBeenCalledTimes(1);
});
