import React from 'react';
import { Text } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

import { CloudAccountScreen } from './CloudAccountScreen';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: () => undefined,
}));

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
    setCloudState({
      ...baseState,
      status: 'signed_out',
    });
  });

  afterEach(() => {
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
});
