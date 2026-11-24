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
jest.mock('../settings/SettingsChoiceModal', () => {
  const ReactActual = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    SettingsChoiceModal: ({
      visible,
      options,
      onChange,
    }: {
      visible: boolean;
      options: Array<{ value: string; label: string }>;
      onChange: (value: string) => void;
    }) =>
      visible
        ? ReactActual.createElement(
            ReactActual.Fragment,
            null,
            options.map((option) =>
              ReactActual.createElement(
                Pressable,
                {
                  key: option.value,
                  accessibilityLabel: `choice-${option.value}`,
                  onPress: () => onChange(option.value),
                },
                ReactActual.createElement(Text, null, option.label),
              ),
            ),
          )
        : null,
  };
});
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

it('persists the selected execution strength without free-form budget controls', async () => {
  saveMock.mockClear();
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<GeneralSettingsScreen />);
    await Promise.resolve();
    await Promise.resolve();
  });

  // The removed sliders and their numeric labels must not exist.
  expect(tree.root.findAll((node) =>
    node.props.accessibilityLabel === '智能体工具轮数上限' ||
    node.props.accessibilityLabel === '智能体最长运行分钟数',
  )).toHaveLength(0);

  const strengthRow = tree.root.find((node) =>
    node.props.accessibilityLabel === '默认执行强度' &&
    typeof node.props.onPress === 'function',
  );
  await act(async () => {
    strengthRow.props.onPress();
    await Promise.resolve();
  });

  for (const value of ['plain', 'light', 'standard', 'enhanced', 'deep']) {
    expect(tree.root.findAll((node) =>
      node.props.accessibilityLabel === `choice-${value}`,
    ).length).toBeGreaterThan(0);
  }

  const deep = tree.root.find((node) =>
    node.props.accessibilityLabel === 'choice-deep' &&
    typeof node.props.onPress === 'function',
  );
  await act(async () => {
    deep.props.onPress();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(saveMock).toHaveBeenLastCalledWith(expect.objectContaining({
    agentExecutionStrength: 'deep',
  }));
  expect(saveMock).toHaveBeenLastCalledWith(
    expect.not.objectContaining({ agentBudget: expect.anything() }),
  );

  await act(async () => {
    tree.unmount();
  });
});
