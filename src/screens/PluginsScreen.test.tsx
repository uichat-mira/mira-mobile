import React from 'react';
import { AppState, Text } from 'react-native';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { PluginsScreen, pluginInitial } from './PluginsScreen';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import { accountMcpServiceDirectory, type AuthorizedApplicationListItem } from '../mcp/accountServiceRegistry';

const mockNavigate = jest.fn();
let mockFocused = true;
jest.mock('@react-navigation/native', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  return {
    useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
    useFocusEffect: (callback: () => void | (() => void)) =>
      react.useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]),
  };
});
jest.mock('../settings/SettingsPageHeader', () => ({ SettingsPageHeader: () => null }));
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: {
    bg: { canvas: '#fff', card: '#eee', soft: '#ddd' },
    text: { ink: '#111', muted: '#555', soft: '#777' },
    border: { soft: '#ddd' }, primary: '#c64',
  } }),
}));

const item = (appId: string, name: string): AuthorizedApplicationListItem => ({
  appId, name,
});
const a = item('app-fixture-one', '狐邮 Who You');
const b = item('app-fixture-two', 'Another Mail Service');
let tree: ReactTestRenderer;
let list: jest.SpyInstance;
const strings = () => tree.root.findAllByType(Text).map(node => String(node.props.children));
const render = async () => {
  await act(async () => { tree = renderer.create(<PluginsScreen />); });
};
const signedIn = () => useCloudAccountStore.setState({
  status: 'signed_in', account: { id: 'account-a', username: 'alice' }, expiresAt: '2099-01-01T00:00:00Z',
});
const focus = async (value: boolean) => {
  mockFocused = value;
  await act(async () => { tree.update(<PluginsScreen />); });
};
beforeEach(() => {
  mockFocused = true;
  mockNavigate.mockReset();
  Object.defineProperty(AppState, 'currentState', { configurable: true, writable: true, value: 'active' });
  useCloudAccountStore.setState({ status: 'signed_out', account: null, expiresAt: null });
  list = jest.spyOn(accountMcpServiceDirectory, 'listAuthorizedApplications').mockResolvedValue([]);
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.restoreAllMocks();
});

it('keeps the real built-in plugin route without fetching when logged out', async () => {
  await render();
  expect(strings()).toContain('拾言');
  expect(strings()).not.toContain(a.name);
  expect(list).not.toHaveBeenCalled();
  const row = tree.root.findAll(node => node.props.accessibilityLabel === '拾言' && typeof node.props.onPress === 'function')[0];
  act(() => row.props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith('ShiyanHome');
});

it('shows only local plugins for an authorized empty catalog', async () => {
  signedIn();
  await render();
  expect(list).toHaveBeenCalledWith({ accountId: 'account-a', force: true });
  expect(strings()).toContain('拾言');
  expect(strings()).not.toContain(a.name);
  expect(strings()).not.toContain('云端插件暂时无法更新');
});

it('projects both instances and removes a revoked application on focus refresh', async () => {
  signedIn();
  list.mockResolvedValueOnce([a, b]).mockResolvedValueOnce([b]);
  await render();
  expect(strings()).toEqual(expect.arrayContaining([a.name, b.name, '狐', 'A']));
  expect(tree.root.findAll(node => node.props.accessibilityLabel === a.name && typeof node.props.onPress === 'function')).toHaveLength(0);
  await focus(false);
  await focus(true);
  expect(strings()).not.toContain(a.name);
  expect(strings()).toContain(b.name);
  expect(list).toHaveBeenCalledTimes(2);
});

it('distinguishes failure from empty and retries without hiding the local plugin', async () => {
  signedIn();
  list.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce([a]);
  await render();
  expect(strings()).toContain('拾言');
  expect(strings()).toContain('云端插件暂时无法更新');
  const retry = tree.root.findAll(node => node.props.accessibilityLabel === '重试更新云端插件' && typeof node.props.onPress === 'function')[0];
  await act(async () => retry.props.onPress());
  expect(strings()).toContain(a.name);
  expect(strings()).not.toContain('云端插件暂时无法更新');
});

it('refreshes a focused screen after background and discards the prior list on logout', async () => {
  signedIn();
  let listener: ((state: 'active' | 'background') => void) | undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, callback) => {
    listener = callback;
    return { remove: jest.fn() };
  });
  list.mockResolvedValueOnce([]).mockResolvedValueOnce([a]);
  await render();
  await act(async () => { listener?.('background'); listener?.('active'); });
  expect(strings()).toContain(a.name);
  await act(async () => useCloudAccountStore.setState({ status: 'signed_out', account: null }));
  expect(strings()).not.toContain(a.name);
});

it('never displays a delayed result from a previous account', async () => {
  signedIn();
  let resolveFirst!: (items: readonly AuthorizedApplicationListItem[]) => void;
  list.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
    .mockResolvedValueOnce([b]);
  await render();
  await act(async () => useCloudAccountStore.setState({
    account: { id: 'account-b', username: 'bob' },
  }));
  await act(async () => resolveFirst([a]));
  expect(strings()).toContain(b.name);
  expect(strings()).not.toContain(a.name);
});

it('uses stable visible initials, including Unicode and missing names', () => {
  expect(pluginInitial('狐邮 Who You')).toBe('狐');
  expect(pluginInitial('GitHub')).toBe('G');
  expect(pluginInitial('  Alpha Vantage')).toBe('A');
  expect(pluginInitial('')).toBe('?');
  expect(pluginInitial('🚀 Launch')).toBe('🚀');
});
