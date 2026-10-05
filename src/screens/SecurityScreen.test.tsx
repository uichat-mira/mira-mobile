import React from 'react';
import { Text } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

import { SecurityScreen } from './SecurityScreen';
import { loadSecurityStatus } from '../security/securityStatus';

const mockLoadSecurityStatus = loadSecurityStatus as jest.MockedFunction<typeof loadSecurityStatus>;

jest.mock('@react-navigation/native', () => {
  const ReactModule = jest.requireActual('react') as typeof import('react');
  return {
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactModule.useEffect(() => callback(), [callback]);
    },
  };
});

jest.mock('../security/securityStatus', () => ({
  loadSecurityStatus: jest.fn(),
  formatSavedAt: jest.fn(() => null),
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
      status: { success: '#0a0', warning: '#aa0', error: '#c00' },
    },
  }),
}));

const status = {
  remoteHost: { available: false, supported: true, error: false, hostUrl: null, savedAt: null },
  desktopHost: { available: false, supported: true, error: false, hostUrl: null, username: null, savedAt: null },
  providers: { total: 0, withApiKey: 0, supported: true, error: false, keyReadErrors: 0, items: [] },
  shiyan: { available: false, supported: true, error: false, baseUrl: null, defaultBaseUrl: 'https://example.invalid' },
  hasError: false,
};

const renderScreen = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<SecurityScreen />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return tree;
};

describe('SecurityScreen MOB-071 information hierarchy', () => {
  beforeEach(() => {
    mockLoadSecurityStatus.mockReset();
    mockLoadSecurityStatus.mockResolvedValue(status);
  });

  it('keeps security status and credential sections without the redundant About section', async () => {
    const tree = await renderScreen();
    const strings = tree.root
      .findAllByType(Text)
      .map((node) =>
        Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children),
      );

    expect(strings).toContain('总览');
    expect(strings).toContain('安全凭据');
    expect(strings).not.toContain('其它');
    expect(strings).not.toContain('关于设备安全存储');

    const rowLabels = tree.root
      .findAll((node) => typeof node.props.accessibilityLabel === 'string')
      .map((node) => node.props.accessibilityLabel as string);
    expect(rowLabels).not.toContain('关于设备安全存储');
  });
});
