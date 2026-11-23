import React from 'react';
import renderer, { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { GeneralSettingsScreen } from './GeneralSettingsScreen';
import { saveGeneralSettings } from '../settings/generalSettings';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => {
  const ReactActual = require('react');
  const NativeView = require('react-native').View;
  return {
    SafeAreaView: (props: Record<string, unknown>) =>
      ReactActual.createElement(NativeView, props),
  };
});

jest.mock('@react-native-community/slider', () => {
  const ReactActual = require('react');
  const NativeView = require('react-native').View;
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) =>
      ReactActual.createElement(NativeView, props),
  };
});

jest.mock('../settings/SettingsPageHeader', () => ({
  SettingsPageHeader: () => null,
}));
jest.mock('../settings/SettingsChoiceModal', () => ({
  SettingsChoiceModal: () => null,
}));
jest.mock('../haptics/haptics', () => ({
  startContinuousVibration: jest.fn(),
  stopContinuousVibration: jest.fn(),
}));
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      bg: { canvas: '#fff', card: '#eee', elevated: '#fff' },
      border: { default: '#ccc' },
      text: { ink: '#111', muted: '#666', soft: '#999' },
      status: { error: '#c00', errorBg: '#fdd' },
      primary: '#345', onPrimary: '#fff',
    },
  }),
}));
jest.mock('../settings/generalSettings', () => {
  const original = jest.requireActual('../settings/generalSettings');
  return {
    ...original,
    loadGeneralSettings: jest.fn(async () => ({ ...original.DEFAULT_GENERAL_SETTINGS })),
    saveGeneralSettings: jest.fn(async () => undefined),
  };
});

const saveMock = jest.mocked(saveGeneralSettings);
const findSlider = (tree: ReactTestRenderer, name: string) => {
  const matches = tree.root.findAll((node) =>
    node.props.accessibilityLabel === name &&
    typeof node.props.onSlidingComplete === 'function');
  expect(matches.length).toBeGreaterThan(0);
  return matches[0];
};

it('keeps both budget values when sliders finish within one render', async () => {
  saveMock.mockClear();
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<GeneralSettingsScreen />);
    await Promise.resolve();
    await Promise.resolve();
  });
  const rounds = findSlider(tree, '智能体工具轮数上限');
  const minutes = findSlider(tree, '智能体最长运行分钟数');
  await act(async () => {
    rounds.props.onValueChange(24);
    rounds.props.onSlidingComplete(24);
    minutes.props.onValueChange(37);
    minutes.props.onSlidingComplete(37);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(saveMock).toHaveBeenLastCalledWith(expect.objectContaining({
    agentBudget: { maxToolRounds: 24, maxDurationMinutes: 37 },
  }));
  await act(async () => {
    tree.unmount();
  });
});
