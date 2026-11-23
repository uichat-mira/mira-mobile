import React from 'react';
import { Alert } from 'react-native';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { LocalProviderListScreen } from './LocalProviderListScreen';

const mockNavigate = jest.fn();
const mockReset = jest.fn();
const mockLoadConfigs = jest.fn();
const mockLoadKey = jest.fn();
const mockCreateLocalSession = jest.fn();
let mockRouteMode: 'create' | undefined;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, reset: mockReset, goBack: jest.fn() }),
  useRoute: () => ({ params: mockRouteMode ? { mode: mockRouteMode } : undefined }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const react = jest.requireActual<typeof import('react')>('react');
    react.useEffect(callback, [callback]);
  },
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('lucide-react-native', () => ({
  ChevronLeft: () => null, ChevronRight: () => null, KeyRound: () => null,
  Plus: () => null, Server: () => null,
}));
jest.mock('../provider/providerConfigStore', () => ({
  ProviderConfigStore: class { load() { return mockLoadConfigs(); } },
}));
jest.mock('../security/providerCredentialStore', () => ({
  providerCredentialStore: {
    isAvailable: () => true,
    load: (...args: unknown[]) => mockLoadKey(...args),
  },
}));
jest.mock('../runtime/runtimeRegistry', () => ({
  runtimeRegistry: {
    createLocalSession: (...args: unknown[]) => mockCreateLocalSession(...args),
  },
}));
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      primary: '#b65e36', onPrimary: '#fff',
      bg: { canvas: '#faf8f5', card: '#fff', soft: '#eee' },
      text: { ink: '#111', base: '#333', soft: '#777' },
      border: { default: '#ddd' },
      status: { success: '#385' },
    },
  }),
}));

const config = {
  id: 'provider-1', name: '工作服务', model: 'model-x',
  baseUrl: 'https://api.example.com/v1', protocol: 'openai-chat-completions',
};
const renderScreen = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = renderer.create(<LocalProviderListScreen />); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return tree;
};

beforeEach(() => {
  mockRouteMode = undefined;
  mockNavigate.mockReset();
  mockReset.mockReset();
  mockLoadConfigs.mockReset().mockResolvedValue([config]);
  mockLoadKey.mockReset().mockResolvedValue('secret-test-value');
  mockCreateLocalSession.mockReset().mockResolvedValue({ id: 'local-chat-1', title: '新对话' });
});

afterEach(() => { jest.restoreAllMocks(); });

test('manage mode edits saved service and never starts a chat', async () => {
  const tree = await renderScreen();
  const card = tree.root.findByProps({ accessibilityLabel: '编辑 工作服务' });
  await act(async () => { card.props.onPress(); });
  expect(mockNavigate).toHaveBeenCalledWith('LocalProviderEdit', { providerId: 'provider-1' });
  expect(mockCreateLocalSession).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).not.toContain('secret-test-value');
  await act(async () => { tree.unmount(); });
});

test('chat mode creates a local conversation with the selected persisted service', async () => {
  mockRouteMode = 'create';
  const tree = await renderScreen();
  const card = tree.root.findByProps({ accessibilityLabel: '使用 工作服务' });
  await act(async () => { await card.props.onPress(); });
  expect(mockCreateLocalSession).toHaveBeenCalledWith(undefined, 'provider-1');
  expect(mockReset).toHaveBeenCalledWith(expect.objectContaining({
    index: 1,
    routes: [
      { name: 'SessionList' },
      {
        name: 'Chat',
        params: expect.objectContaining({ sessionId: 'local-chat-1', source: 'local-provider' }),
      },
    ],
  }));
  await act(async () => { tree.unmount(); });
});

test('missing credential cannot silently create a useless chat and offers editing', async () => {
  mockRouteMode = 'create';
  mockLoadKey.mockResolvedValue(null);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const tree = await renderScreen();
  const card = tree.root.findByProps({ accessibilityLabel: '使用 工作服务' });
  await act(async () => { await card.props.onPress(); });
  expect(mockCreateLocalSession).not.toHaveBeenCalled();
  const options = alert.mock.calls[0]?.[2];
  const edit = options?.find(option => option.text === '编辑配置');
  expect(edit).toBeDefined();
  await act(async () => { edit?.onPress?.(); });
  expect(mockNavigate).toHaveBeenCalledWith('LocalProviderEdit', { providerId: 'provider-1' });
  await act(async () => { tree.unmount(); });
});
