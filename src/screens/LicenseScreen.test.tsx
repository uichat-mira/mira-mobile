import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

import { LicenseScreen } from './LicenseScreen';

jest.mock('../settings/SettingsPageHeader', () => ({
  SettingsPageHeader: () => null,
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      bg: { canvas: '#fff', card: '#faf9f5', soft: '#eee' },
      border: { default: '#ddd' },
      text: { ink: '#111', base: '#333', muted: '#777' },
      primary: '#c96442',
    },
  }),
}));

describe('LicenseScreen MOB-071 flattened presentation', () => {
  it('uses typography and a divider instead of card or badge surfaces', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<LicenseScreen />);
    });
    const strings = tree.root
      .findAllByType(Text)
      .map((node) =>
        Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children),
      );

    expect(strings).toContain('UIChat Mira');
    expect(strings.some((value) => value.startsWith('版本 '))).toBe(true);
    expect(strings).toContain('UIChat');
    expect(strings).toContain('MIT License');

    const backgrounds = tree.root.findAllByType(View).map((node) => {
      const flattened = StyleSheet.flatten(node.props.style);
      return flattened?.backgroundColor;
    });

    expect(backgrounds).not.toContain('#faf9f5');
    expect(backgrounds).not.toContain('#eee');
    expect(backgrounds).toContain('#ddd');
  });
});
