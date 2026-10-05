import React from 'react';
import { Text, TextInput } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

import { SettingsInputModal } from './SettingsInputModal';

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      overlay: 'rgba(0,0,0,0.4)',
      bg: { elevated: '#fff', card: '#fafafa' },
      border: { default: '#ddd' },
      text: { ink: '#111', muted: '#777', placeholder: '#999' },
      status: { error: '#c00' },
      primary: '#08f',
      primaryDisabled: '#ccc',
      onPrimary: '#fff',
    },
  }),
}));

const renderedStrings = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAllByType(Text)
    .map((node) =>
      Array.isArray(node.props.children)
        ? node.props.children.join('')
        : String(node.props.children),
    );

describe('SettingsInputModal validation', () => {
  it('keeps a rejected value open and renders the validation reason', () => {
    const onSubmit = jest.fn();
    const onClose = jest.fn();
    let tree!: ReactTestRenderer;

    act(() => {
      tree = renderer.create(
        <SettingsInputModal
          visible
          title="添加额外特征"
          confirmLabel="添加"
          validate={(value) =>
            value === '亲和友善'
              ? '“亲和友善”属于基础风格，请在“基本风格和语调”中选择。'
              : null
          }
          onSubmit={onSubmit}
          onClose={onClose}
        />,
      );
    });

    const input = tree.root.findByType(TextInput);
    act(() => {
      input.props.onChangeText('亲和友善');
    });

    const confirm = tree.root.find(
      (node) => node.props.accessibilityLabel === '添加',
    );

    act(() => {
      confirm.props.onPress();
    });

    expect(renderedStrings(tree)).toContain(
      '“亲和友善”属于基础风格，请在“基本风格和语调”中选择。',
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
