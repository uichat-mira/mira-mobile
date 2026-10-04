import React from 'react';
import { Linking } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

import { AboutScreen } from './AboutScreen';
import { fetchLatestRelease } from '../update/appUpdate';

const mockFetchLatestRelease = fetchLatestRelease as jest.MockedFunction<
  typeof fetchLatestRelease
>;

// MOB-056D: the About "文档" entry must open the canonical Mira site, and the
// manual update check must keep working through the shared update-level path.

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('../update/appUpdate', () => ({
  ...jest.requireActual('../update/appUpdate'),
  fetchLatestRelease: jest.fn(),
}));

jest.mock('../components/settings/SettingsPageHeader', () => ({
  SettingsPageHeader: () => null,
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
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
    tree = renderer.create(<AboutScreen />);
  });
  await flush();
  return tree;
};

const documentationRow = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      node.props.accessibilityLabel === '文档' && typeof node.props.onPress === 'function',
  )[0];

const versionRow = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      typeof node.props.accessibilityLabel === 'string' &&
      node.props.accessibilityLabel.includes('UIChat Mira') &&
      typeof node.props.onPress === 'function',
  )[0];

describe('AboutScreen MOB-056D', () => {
  const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

  beforeEach(() => {
    openURLSpy.mockClear();
    mockFetchLatestRelease.mockReset();
    mockFetchLatestRelease.mockRejectedValue(new Error('no release in these cases'));
  });

  afterAll(() => {
    openURLSpy.mockRestore();
  });

  it('opens https://mira.tomz.io from the 文档 row', async () => {
    const tree = await renderScreen();

    await act(async () => {
      documentationRow(tree).props.onPress();
    });

    expect(openURLSpy).toHaveBeenCalledWith('https://mira.tomz.io');
  });

  it('still surfaces a patch release through the manual check', async () => {
    const { parseSemver } = jest.requireActual('../update/semver');
    mockFetchLatestRelease.mockResolvedValue({
      version: parseSemver('0.3.11'),
      displayVersion: '0.3.11-dev',
      notes: null,
      apkUrl:
        'https://assets.tomz.io/mira/mobile/dev/releases/0.3.11/uichat-mira-mobile-release.apk',
      sha256: 'a'.repeat(64),
    });

    const tree = await renderScreen();

    const dot = tree.root.findAll(
      (node) => node.props.accessibilityLabel === '有可用更新',
    );
    expect(dot.length).toBeGreaterThan(0);

    const subtitles = tree.root
      .findAll((node) => typeof node.props.children === 'string')
      .map((node) => node.props.children as string);
    expect(subtitles.some((value) => value.includes('0.3.11-dev'))).toBe(true);
  });

  it('shows no new-version state when the release is equal or older', async () => {
    const { parseSemver } = jest.requireActual('../update/semver');
    mockFetchLatestRelease.mockResolvedValue({
      version: parseSemver('0.3.8'),
      displayVersion: '0.3.8-dev',
      notes: null,
      apkUrl:
        'https://assets.tomz.io/mira/mobile/dev/releases/0.3.8/uichat-mira-mobile-release.apk',
      sha256: 'a'.repeat(64),
    });

    const tree = await renderScreen();

    expect(
      tree.root.findAll((node) => node.props.accessibilityLabel === '有可用更新'),
    ).toHaveLength(0);
    expect(versionRow(tree)).toBeDefined();
  });
});
