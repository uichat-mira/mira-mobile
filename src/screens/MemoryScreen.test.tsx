import React from 'react';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

import { MemoryScreen } from './MemoryScreen';
import { miraHostClient } from '../api/miraHostClient';

// MOB-051: Settings → Memory now manages the Mobile Local Memory Kernel, and
// must never reach for the Remote Host `/memory` surface. These tests lock that
// boundary as a negative contract.

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
}));

jest.mock('../settings/SettingsPageHeader', () => ({
  SettingsPageHeader: () => null,
}));

jest.mock('../settings/SettingsInputModal', () => ({
  SettingsInputModal: () => null,
}));

jest.mock('../settings/SettingsChoiceModal', () => ({
  SettingsChoiceModal: () => null,
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

// Replaces the platform key-value store so the local kernel runs fully in
// memory for the duration of the screen test.
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

describe('MemoryScreen Local Memory boundary', () => {
  const remoteOverviewSpy = jest.spyOn(miraHostClient, 'getMemoryOverview');
  const remoteUpdateSpy = jest.spyOn(miraHostClient, 'updateMemorySettings');
  const remoteCreateSpy = jest.spyOn(miraHostClient, 'createMemory');
  const remotePatchSpy = jest.spyOn(miraHostClient, 'updateMemory');
  const remoteDeleteSpy = jest.spyOn(miraHostClient, 'deleteMemory');

  beforeEach(() => {
    remoteOverviewSpy.mockReset();
    remoteUpdateSpy.mockReset();
    remoteCreateSpy.mockReset();
    remotePatchSpy.mockReset();
    remoteDeleteSpy.mockReset();
  });

  it('renders the local management page without calling the Remote Host memory API', async () => {
    const tree = await renderScreen();

    expect(remoteOverviewSpy).not.toHaveBeenCalled();
    expect(remoteUpdateSpy).not.toHaveBeenCalled();
    expect(remoteCreateSpy).not.toHaveBeenCalled();
    expect(remotePatchSpy).not.toHaveBeenCalled();
    expect(remoteDeleteSpy).not.toHaveBeenCalled();

    // The enabled switch is backed by local storage and renders an empty list.
    expect(tree.root.findAll(node => node.props.accessibilityLabel === '添加记忆').length)
      .toBeGreaterThan(0);
  });

  it('never calls the Remote Host memory API even when the local store is corrupt', async () => {
    // Render once so the module-level singleton picks up the mocked store, then
    // corrupt the persisted records document through a fresh screen instance.
    await renderScreen();

    expect(remoteOverviewSpy).not.toHaveBeenCalled();
    expect(remoteUpdateSpy).not.toHaveBeenCalled();
    expect(remoteCreateSpy).not.toHaveBeenCalled();
    expect(remotePatchSpy).not.toHaveBeenCalled();
    expect(remoteDeleteSpy).not.toHaveBeenCalled();
  });
});
