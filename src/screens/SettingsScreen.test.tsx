import React from 'react';
import { Text } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

import { SettingsScreen } from './SettingsScreen';
import { PUBLIC_FEEDBACK_EMAIL } from '../data/feedbackContact';

// MOB-056D: the Settings information architecture is a product contract, so this
// asserts on the rendered tree (group order / removed row), not on source text.

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), reset: jest.fn() }),
}));

jest.mock('../provider/providerConfigStore', () => ({
  ProviderConfigStore: class {
    load() {
      return Promise.resolve([]);
    }
  },
}));

jest.mock('../store/hostStore', () => ({
  useHostStore: () => ({ config: null, connectionStatus: 'disconnected' }),
}));

jest.mock('../store/tailscaleConnectivityStore', () => ({
  useTailscaleConnectivityStore: (selector: (state: { state: string }) => unknown) =>
    selector({ state: 'idle' }),
}));

jest.mock('../api/miraHostClient', () => ({
  miraHostClient: { disconnect: jest.fn(async () => undefined) },
}));

jest.mock('../settings/SettingsChoiceModal', () => ({
  SettingsChoiceModal: () => null,
}));

jest.mock('../theme/palette', () => ({
  themePresets: {
    default: { label: '默认', swatch: '#000' },
    'knowledge-blue': { label: '知识蓝', swatch: '#00f' },
    'archive-green': { label: '档案绿', swatch: '#0f0' },
    'slate-ocean': { label: '石板海', swatch: '#088' },
  },
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'light',
    mode: 'system',
    accentColor: 'default',
    persistenceError: false,
    setMode: jest.fn(),
    setAccentColor: jest.fn(),
    colors: {
      bg: { canvas: '#fff', card: '#fff', soft: '#eee' },
      border: { default: '#ddd' },
      text: { ink: '#111', soft: '#777', muted: '#777' },
      status: { error: '#c00' },
    },
  }),
}));

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderScreen = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<SettingsScreen />);
  });
  await flush();
  return tree;
};

// Section headers and row titles share the same Text nodes; capture every
// rendered string in depth-first order so relative ordering is observable.
const renderedStrings = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAllByType(Text)
    .map((node) =>
      Array.isArray(node.props.children)
        ? node.props.children.join('')
        : String(node.props.children),
    );

const rowTitles = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAll(
      (node) =>
        typeof node.props.onPress === 'function' &&
        typeof node.props.accessibilityLabel === 'string',
    )
    .map((node) => node.props.accessibilityLabel as string);

describe('SettingsScreen MOB-056D information architecture', () => {
  it('renders the 连接 group as the top-most section', async () => {
    const tree = await renderScreen();
    const strings = renderedStrings(tree);

    const connectionIndex = strings.indexOf('连接');
    expect(connectionIndex).toBeGreaterThan(-1);
    for (const otherSection of ['我的 Mira', '外观', '通用']) {
      const index = strings.indexOf(otherSection);
      expect(index).toBeGreaterThan(connectionIndex);
    }
  });

  it('no longer renders the 账户 → 电子邮件 entry', async () => {
    const tree = await renderScreen();
    const strings = renderedStrings(tree);

    expect(strings).not.toContain('账户');
    expect(strings).not.toContain('电子邮件');
    expect(rowTitles(tree)).not.toContain('电子邮件');
    expect(strings.some((value) => value.includes(PUBLIC_FEEDBACK_EMAIL))).toBe(false);
  });

  it('keeps the shared feedback consumer intact elsewhere in Settings', async () => {
    const tree = await renderScreen();
    const strings = renderedStrings(tree);

    // Removing the entry must not remove Report Error, which also uses the
    // shared public feedback address.
    expect(strings).toContain('报告错误');
    expect(rowTitles(tree)).toContain('报告错误');
  });

  it('keeps the 连接 group members at the top', async () => {
    const tree = await renderScreen();
    const titles = rowTitles(tree);

    expect(titles.indexOf('本地连接')).toBeGreaterThan(-1);
    expect(titles.indexOf('远程连接')).toBeGreaterThan(titles.indexOf('本地连接'));
    expect(titles.indexOf('个性化')).toBeGreaterThan(titles.indexOf('远程连接'));
  });
});
