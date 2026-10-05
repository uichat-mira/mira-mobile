import React from 'react';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

// This integration-style renderer test mounts the real settings modals; allow
// extra headroom on cold CI workers.
jest.setTimeout(15000);

import { MemoryScreen } from './MemoryScreen';
import { SettingsInputModal } from '../settings/SettingsInputModal';

// MOB-051 review follow-up: the create flow must let the user pick any of the
// four MemoryKind values. Previously the kind picker had no entry point, so
// every manual memory was silently created as `preference`.
//
// This file intentionally does NOT mock the settings modals, so the real
// footer entry and choice options are exercised.

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
}));

jest.mock('../settings/SettingsPageHeader', () => ({
  SettingsPageHeader: () => null,
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      bg: { canvas: '#fff', card: '#fff', elevated: '#fff', soft: '#eee' },
      border: { default: '#ddd' },
      text: { ink: '#111', soft: '#777', muted: '#777', placeholder: '#aaa' },
      status: { error: '#c00', errorBg: '#fee' },
      primary: '#00f',
      primaryDisabled: '#99f',
      onPrimary: '#fff',
      overlay: 'rgba(0,0,0,0.4)',
    },
  }),
}));

jest.mock('../storage/localKeyValueStore', () => {
  const values = new Map<string, string>();
  return {
    localKeyValueStore: {
      isAvailable: () => true,
      get: async (key: string) => values.get(key) ?? null,
      set: async (key: string, value: string) => {
        values.set(key, value);
      },
      remove: async (key: string) => {
        values.delete(key);
      },
    },
  };
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderScreen = async (): Promise<ReactTestRenderer> => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<MemoryScreen />);
  });
  await flush();
  return tree;
};

// Joins every rendered string so interpolated Text children (e.g.
// `{kind} · {origin}`) can be asserted as one readable string. Works off the
// serialized JSON tree, where children are plain strings/objects.
const collectSubtreeText = (tree: ReactTestRenderer): string => {
  const walk = (node: unknown): string => {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (typeof node === 'string') return node;
    if (typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(walk).join('');
    const record = node as { children?: unknown };
    return record.children === undefined ? '' : walk(record.children);
  };
  return walk(tree.toJSON());
};

const findByLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );

const press = async (node: ReactTestInstance) => {
  await act(async () => {
    node.props.onPress();
  });
  await flush();
};

const findKindOption = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    node =>
      node.props.accessibilityRole === 'radio' &&
      React.Children.toArray(node.props.children).some(
        child =>
          React.isValidElement(child) &&
          (child.props as { children?: unknown }).children === label,
      ),
  );

describe('MemoryScreen manual create kind selection', () => {
  it('exposes a type entry in the create flow and offers all four kinds', async () => {
    const tree = await renderScreen();

    // Open the create dialog.
    const addEntry = findByLabel(tree, '添加记忆');
    expect(addEntry.length).toBeGreaterThan(0);
    await press(addEntry[0]);

    // The create dialog now carries a type row; previously there was no entry
    // point at all, so the picker could never open.
    const kindEntry = findByLabel(tree, '选择记忆类型');
    expect(kindEntry.length).toBeGreaterThan(0);

    // Opening it exposes all four MemoryKind options.
    await press(kindEntry[0]);
    for (const label of ['偏好', '长期事实', '决定', '约束']) {
      expect(findKindOption(tree, label).length).toBeGreaterThan(0);
    }

    // The create dialog stays mounted, so the picker is a separate layer.
    expect(
      tree.root
        .findAllByType(SettingsInputModal)
        .some(node => node.props.title === '添加记忆'),
    ).toBe(true);
  });

  it('submits the selected kind instead of always preference', async () => {
    const tree = await renderScreen();

    await press(findByLabel(tree, '添加记忆')[0]);
    await press(findByLabel(tree, '选择记忆类型')[0]);

    // Choose the "约束" (constraint) option through the choice modal.
    const constraintOption = findKindOption(tree, '约束');
    expect(constraintOption.length).toBeGreaterThan(0);
    await press(constraintOption[0]);

    // Submit content through the create modal. Two SettingsInputModal
    // instances exist (create + edit sheet), so select the create one by title.
    const inputModal = tree.root
      .findAllByType(SettingsInputModal)
      .find(node => node.props.title === '添加记忆');
    expect(inputModal).toBeDefined();
    await act(async () => {
      inputModal!.props.onSubmit('技术约束必须保持稳定。');
    });
    await flush();

    // The created record renders as a constraint, proving the UI no longer
    // hard-codes preference for manual creation.
    const allText = collectSubtreeText(tree);
    expect(allText).toContain('约束 · 手动添加');
    expect(allText).toContain('技术约束必须保持稳定。');
  });
});
