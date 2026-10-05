import React from 'react';
import { Text } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

// MOB-049 blocker: a corrupted v2 payload must put the screen into a
// load-failed / locked state instead of silently showing defaults, so the user
// cannot overwrite the original persisted data with a single save.

const mockLoadPersonalizationSettings = jest.fn();

jest.mock('../settings/personalizationSettings', () => {
  const actual = jest.requireActual('../settings/personalizationSettings');
  return {
    ...actual,
    loadPersonalizationSettings: (...args: unknown[]) =>
      mockLoadPersonalizationSettings(...args),
  };
});

import { PersonalizationScreen } from './PersonalizationScreen';
import { DEFAULT_PERSONALIZATION_SETTINGS } from '../settings/personalizationSettings';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), reset: jest.fn() }),
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'light',
    mode: 'system',
    accentColor: 'default',
    colors: {
      bg: { canvas: '#fff', card: '#fff', soft: '#eee', elevated: '#fff' },
      border: { default: '#ddd' },
      text: { ink: '#111', soft: '#777', muted: '#777', placeholder: '#999' },
      status: { error: '#c00', errorBg: '#fee' },
      primary: '#08f',
    },
  }),
}));

jest.mock('../settings/SettingsChoiceModal', () => ({
  SettingsChoiceModal: () => null,
}));

jest.mock('../settings/SettingsInputModal', () => ({
  SettingsInputModal: () => null,
}));

jest.mock('../settings/SettingsPageHeader', () => ({
  SettingsPageHeader: () => null,
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
    tree = renderer.create(<PersonalizationScreen />);
  });
  await flush();
  return tree;
};

const renderedStrings = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAllByType(Text)
    .map((node) =>
      Array.isArray(node.props.children)
        ? node.props.children.join('')
        : String(node.props.children),
    );

describe('PersonalizationScreen corrupted-payload handling', () => {
  afterEach(() => {
    mockLoadPersonalizationSettings.mockReset();
  });

  it('enters the load-failed state when loading a corrupted payload throws', async () => {
    mockLoadPersonalizationSettings.mockRejectedValue(
      Object.assign(new Error('Stored personalization settings are not valid JSON'), {
        code: 'PERSONALIZATION_LOAD_FAILED',
      }),
    );

    const tree = await renderScreen();
    const strings = renderedStrings(tree);

    expect(strings.some((value) => value.includes('个性化设置读取失败'))).toBe(true);
    expect(strings).toContain('重试');
  });

  it('locks the controls in the load-failed state so a save cannot overwrite the payload', async () => {
    mockLoadPersonalizationSettings.mockRejectedValue(
      new Error('Stored personalization settings are not valid JSON'),
    );

    const tree = await renderScreen();
    const toneButton = tree.root.find(
      (node) => node.props.accessibilityLabel === '基本风格和语调',
    );
    const addTraitButton = tree.root.find(
      (node) => node.props.accessibilityLabel === '添加额外特征',
    );

    expect(toneButton.props.accessibilityState).toMatchObject({ disabled: true });
    expect(addTraitButton.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('renders normally when loading succeeds', async () => {
    mockLoadPersonalizationSettings.mockResolvedValue(DEFAULT_PERSONALIZATION_SETTINGS);

    const tree = await renderScreen();
    const strings = renderedStrings(tree);

    expect(strings.some((value) => value.includes('个性化设置读取失败'))).toBe(false);
    expect(strings).toContain('基本风格和语调');
    expect(strings).toContain('额外特征');
    expect(strings.some((value) => value.includes('只在其上增量调整'))).toBe(true);
    expect(strings).not.toContain('提高亲和度');
    expect(strings).not.toContain('快速回答');
  });
});
