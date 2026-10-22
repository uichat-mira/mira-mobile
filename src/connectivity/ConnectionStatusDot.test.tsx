import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

import { ConnectionStatusDot, type ConnectionVisualStatus } from './ConnectionStatusDot';

// The dot is the single place that turns a connection state into a color, so
// this test pins the product contract: green means "actually connected".
const GREEN = '#00ff00';
const AMBER = '#ffaa00';
const RED = '#ff0000';
const NEUTRAL = '#999999';

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      status: { success: '#00ff00', warning: '#ffaa00', error: '#ff0000' },
      text: { soft: '#999999' },
    },
  }),
}));

const backgroundColorFor = (status: ConnectionVisualStatus): string => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(<ConnectionStatusDot status={status} />);
  });
  const dot = tree.root.findByType(View);
  return String(StyleSheet.flatten(dot.props.style).backgroundColor);
};

describe('ConnectionStatusDot', () => {
  it('uses the success color only for a real connection', () => {
    expect(backgroundColorFor('connected')).toBe(GREEN);
  });

  it.each(['connecting', 'disconnected'] as const)(
    'does not use the success color for the not-connected "%s" state',
    (status) => {
      const color = backgroundColorFor(status);
      expect(color).not.toBe(GREEN);
      expect(color).toBe(AMBER);
    },
  );

  it('uses the error color for a failed connection', () => {
    expect(backgroundColorFor('error')).toBe(RED);
  });

  it('uses a neutral color when nothing is configured', () => {
    expect(backgroundColorFor('not-configured')).toBe(NEUTRAL);
  });
});
