import React from 'react';
import { Alert } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

import { SettingsScreen } from './SettingsScreen';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import { cloudAuthService } from '../cloud/cloudAuthService';
import { cloudRelayEntry } from '../cloud/cloudRelayEntry';
import {
  installDesktopConnectionLifecycle,
  useDesktopConnectionStore,
} from '../connectivity/desktopConnectionAuthority';
import { remoteMiraHostClient } from '../api/remoteMiraHost';
import { useHostStore } from '../store/hostStore';
import { useTailscaleConnectivityStore } from '../store/tailscaleConnectivityStore';

jest.mock('@react-navigation/native', () => {
  const navigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
    reset: jest.fn(),
  };
  return {
    __navigation: navigation,
    useNavigation: () => navigation,
    useFocusEffect: (callback: () => void | (() => void)) => {
      const react = jest.requireActual<typeof import('react')>('react');
      react.useEffect(callback, [callback]);
    },
  };
});

jest.mock('../provider/providerConfigStore', () => ({
  ProviderConfigStore: class {
    load() {
      return Promise.resolve([]);
    }
  },
}));

jest.mock('../storage/localKeyValueStore', () => {
  const actual = jest.requireActual('../storage/localKeyValueStore');
  return {
    ...actual,
    localKeyValueStore: new actual.MemoryLocalKeyValueStore(),
  };
});

jest.mock('../cloud/cloudAuthService', () => {
  class CloudAuthServiceError extends Error {
    kind: string;

    constructor(kind: string, message: string) {
      super(message);
      this.kind = kind;
    }
  }
  return {
    CloudAuthServiceError,
    cloudAuthService: {
      restoreSession: jest.fn(),
      beginSignIn: jest.fn(),
      cancelPendingSignIn: jest.fn(),
      completeSignIn: jest.fn(),
      logout: jest.fn(),
      listDevices: jest.fn(),
      revokeDevice: jest.fn(),
    },
  };
});

jest.mock('../settings/SettingsChoiceModal', () => ({
  SettingsChoiceModal: () => null,
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
      status: { error: '#c00', success: '#080', warning: '#b80' },
    },
  }),
}));

const navigation = (
  jest.requireMock('@react-navigation/native') as {
    __navigation: {
      navigate: jest.Mock;
      goBack: jest.Mock;
      reset: jest.Mock;
    };
  }
).__navigation;

const signedInAccount = { id: 'account-a', username: 'alice' };
const renderedTrees: ReactTestRenderer[] = [];

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
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
  renderedTrees.push(tree);
  return tree;
};

const setCloudState = (
  status: 'signed_in' | 'cloud_unavailable' | 'signed_out' | 'authorizing',
  signedIn: boolean,
) =>
  useCloudAccountStore.setState({
    status,
    account: signedIn ? signedInAccount : null,
    expiresAt: signedIn ? '2026-11-25T11:00:00.000Z' : null,
    message: null,
    busy: false,
    initialized: true,
    devices: [],
    currentDeviceId: null,
    devicesStatus: 'idle',
    devicesMessage: null,
    revokingDeviceId: null,
  });

const setDesktopMode = (mode: 'none' | 'direct' | 'cloud') =>
  useDesktopConnectionStore.setState({
    mode,
    generation: 0,
    hydrated: true,
    transitioning: false,
    cloudConnectionStatus: 'disconnected',
    message: null,
  });

const findLogoutRow = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      (node.props.accessibilityLabel === '退出登录（Tailscale）' ||
        node.props.accessibilityLabel === '退出登录（Mira ID）') &&
      typeof node.props.onPress === 'function',
  );

const latestAlert = () => {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  return calls[calls.length - 1] as [
    string,
    string,
    Array<{ text: string; style?: string; onPress?: () => void }>,
  ];
};

const confirmAlert = async () => {
  const buttons = latestAlert()[2];
  const exit = buttons.find((button) => button.text === '退出');
  await act(async () => {
    exit?.onPress?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeAll(() => {
  installDesktopConnectionLifecycle();
});

beforeEach(() => {
  jest.clearAllMocks();
  (cloudAuthService.logout as jest.Mock).mockResolvedValue({
    remote: 'revoked',
    cleared: true,
    message: null,
  });
  setCloudState('signed_out', false);
  setDesktopMode('none');
  useHostStore.setState({
    config: { hostUrl: 'https://desktop.example.ts.net', token: '' },
    connectionStatus: 'disconnected',
  });
  useTailscaleConnectivityStore.setState({
    hostUrl: '',
    state: 'idle',
    result: null,
    probeReason: null,
  });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(remoteMiraHostClient, 'disconnect').mockResolvedValue(undefined);
  jest.spyOn(cloudRelayEntry, 'reset');
});

afterEach(async () => {
  await act(async () => {
    for (const tree of renderedTrees.splice(0)) {
      tree.unmount();
    }
  });
  jest.restoreAllMocks();
});

describe('SettingsScreen contextual logout', () => {
  it.each([
    ['Tailscale active with Mira ID', 'direct', 'signed_in', true, '退出登录（Tailscale）'],
    ['Tailscale active without Mira ID', 'direct', 'signed_out', false, '退出登录（Tailscale）'],
    ['Mira ID signed in without a transport', 'none', 'signed_in', true, '退出登录（Mira ID）'],
    ['Mira ID offline identity', 'none', 'cloud_unavailable', true, '退出登录（Mira ID）'],
    ['Cloud Relay active', 'cloud', 'signed_in', true, '退出登录（Mira ID）'],
    ['No active transport and no identity', 'none', 'signed_out', false, null],
  ] as const)(
    'renders the correctly scoped exit action for %s',
    async (_label, desktopMode, cloudStatus, signedIn, expected) => {
      setDesktopMode(desktopMode);
      setCloudState(cloudStatus, signedIn);

      const tree = await renderScreen();
      const rows = findLogoutRow(tree);

      if (expected === null) {
        expect(rows).toHaveLength(0);
      } else {
        expect(rows).toHaveLength(1);
        expect(rows[0].props.accessibilityLabel).toBe(expected);
      }
    },
  );

  it('keeps Mira ID signed in when logging out of an active Tailscale connection', async () => {
    setDesktopMode('direct');
    setCloudState('signed_in', true);
    useHostStore.setState({
      config: { hostUrl: 'https://desktop.example.ts.net', token: '' },
      connectionStatus: 'connected',
    });
    useTailscaleConnectivityStore.setState({
      hostUrl: 'https://desktop.example.ts.net',
      state: 'ready',
      result: null,
      probeReason: 'startup',
    });

    const tree = await renderScreen();
    (cloudRelayEntry.reset as jest.Mock).mockClear();
    await act(async () => {
      findLogoutRow(tree)[0].props.onPress();
    });

    const [title, message, buttons] = latestAlert();
    expect(title).toBe('退出登录（Tailscale）？');
    expect(message).toBe('将断开 Tailscale，Mira ID 保持登录。');
    expect(buttons.map((button) => button.text)).toEqual(['取消', '退出']);

    await confirmAlert();

    expect(useDesktopConnectionStore.getState().mode).toBe('none');
    expect(useCloudAccountStore.getState()).toMatchObject({
      status: 'signed_in',
      account: signedInAccount,
    });
    expect(cloudAuthService.logout).not.toHaveBeenCalled();
    expect(cloudRelayEntry.reset).not.toHaveBeenCalled();
    expect(remoteMiraHostClient.disconnect).not.toHaveBeenCalled();
    expect(useTailscaleConnectivityStore.getState().state).toBe('idle');
    expect(useHostStore.getState().connectionStatus).toBe('disconnected');
    expect(navigation.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'HostConfig' }],
    });
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('cancelling the confirmation leaves every connection and identity state untouched', async () => {
    setDesktopMode('direct');
    setCloudState('signed_in', true);

    const tree = await renderScreen();
    await act(async () => {
      findLogoutRow(tree)[0].props.onPress();
    });

    const cancel = latestAlert()[2].find((button) => button.text === '取消');
    expect(cancel?.style).toBe('cancel');
    expect(cancel?.onPress).toBeUndefined();

    expect(useDesktopConnectionStore.getState().mode).toBe('direct');
    expect(useCloudAccountStore.getState().status).toBe('signed_in');
    expect(navigation.reset).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('signs out the offline Mira ID identity but keeps the Direct pairing authorization', async () => {
    setDesktopMode('none');
    setCloudState('cloud_unavailable', true);

    const tree = await renderScreen();
    await act(async () => {
      findLogoutRow(tree)[0].props.onPress();
    });

    const [title, message] = latestAlert();
    expect(title).toBe('退出登录（Mira ID）？');
    expect(message).toBe('退出后云端功能不可用。');

    await confirmAlert();

    expect(cloudAuthService.logout).toHaveBeenCalledTimes(1);
    expect(cloudRelayEntry.reset).toHaveBeenCalled();
    expect(useCloudAccountStore.getState()).toMatchObject({
      status: 'signed_out',
      account: null,
    });
    expect(useDesktopConnectionStore.getState().mode).toBe('none');
    expect(remoteMiraHostClient.disconnect).not.toHaveBeenCalled();
    expect(navigation.navigate).toHaveBeenCalledWith('CloudAccount');
    expect(navigation.reset).not.toHaveBeenCalled();
  });

  it('deactivates an active Cloud Relay on Mira ID logout without activating Direct', async () => {
    setDesktopMode('cloud');
    setCloudState('signed_in', true);

    const tree = await renderScreen();
    await act(async () => {
      findLogoutRow(tree)[0].props.onPress();
    });
    await confirmAlert();

    expect(useCloudAccountStore.getState().status).toBe('signed_out');
    expect(useDesktopConnectionStore.getState().mode).toBe('none');
    expect(remoteMiraHostClient.disconnect).not.toHaveBeenCalled();
    expect(navigation.navigate).toHaveBeenCalledWith('CloudAccount');
  });

  it('runs only one logout when the confirmation is pressed twice', async () => {
    setDesktopMode('none');
    setCloudState('signed_in', true);

    const tree = await renderScreen();
    await act(async () => {
      findLogoutRow(tree)[0].props.onPress();
    });

    const exit = latestAlert()[2].find((button) => button.text === '退出');
    await act(async () => {
      exit?.onPress?.();
      exit?.onPress?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cloudAuthService.logout).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledTimes(1);
  });

  it('rejects a Tailscale confirmation after the active mode changed', async () => {
    setDesktopMode('direct');
    setCloudState('signed_in', true);

    const tree = await renderScreen();
    await act(async () => {
      findLogoutRow(tree)[0].props.onPress();
    });

    await act(async () => {
      setDesktopMode('cloud');
    });
    await confirmAlert();

    expect(useDesktopConnectionStore.getState().mode).toBe('cloud');
    expect(navigation.reset).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(cloudAuthService.logout).not.toHaveBeenCalled();
    expect(latestAlert()[0]).toBe('状态已变化');
  });

  it('rejects a Mira ID confirmation after the account changed', async () => {
    setDesktopMode('none');
    setCloudState('signed_in', true);

    const tree = await renderScreen();
    await act(async () => {
      findLogoutRow(tree)[0].props.onPress();
    });

    await act(async () => {
      setCloudState('signed_in', false);
      useCloudAccountStore.setState({
        account: { id: 'account-b', username: 'bob' },
      });
    });
    await confirmAlert();

    expect(cloudAuthService.logout).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(useCloudAccountStore.getState().account).toMatchObject({
      id: 'account-b',
    });
    expect(latestAlert()[0]).toBe('状态已变化');
  });

  it('does not navigate or pretend success when Mira ID logout fails', async () => {
    setDesktopMode('none');
    setCloudState('signed_in', true);
    (cloudAuthService.logout as jest.Mock).mockResolvedValueOnce({
      remote: 'failed',
      cleared: false,
      message: '暂时无法连接 Mira Cloud，登录状态仍保留。',
    });

    const tree = await renderScreen();
    await act(async () => {
      findLogoutRow(tree)[0].props.onPress();
    });
    await confirmAlert();

    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(useCloudAccountStore.getState().status).toBe('signed_in');
    expect(latestAlert()).toEqual([
      '退出失败',
      '暂时无法连接 Mira Cloud，登录状态仍保留。',
    ]);
  });

  it('does not navigate when the Tailscale transport could not be released', async () => {
    setDesktopMode('direct');
    setCloudState('signed_out', false);
    const originalDisconnect = useDesktopConnectionStore.getState().disconnect;
    const noopDisconnect = jest.fn(async () => undefined);
    useDesktopConnectionStore.setState({ disconnect: noopDisconnect });

    try {
      const tree = await renderScreen();
      await act(async () => {
        findLogoutRow(tree)[0].props.onPress();
      });
      await confirmAlert();

      expect(noopDisconnect).toHaveBeenCalledTimes(1);
      expect(useDesktopConnectionStore.getState().mode).toBe('direct');
      expect(navigation.reset).not.toHaveBeenCalled();
      expect(latestAlert()).toEqual([
        '退出失败',
        '未能释放 Tailscale 直连，请稍后重试。',
      ]);
    } finally {
      await act(async () => {
        useDesktopConnectionStore.setState({ disconnect: originalDisconnect });
      });
    }
  });
});
