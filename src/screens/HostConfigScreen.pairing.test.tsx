import React from 'react';
import { Text } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

import { HostConfigScreen } from './HostConfigScreen';
import { useDesktopConnectionStore } from '../connectivity/desktopConnectionAuthority';
import type { RemoteJsonRequest } from '../api/remoteHttp';
import { RemoteHostError } from '../api/remoteHttp';
import type { RootStackParamList } from '../types/navigation';

type TransportSpies = {
  direct: jest.Mock;
};

const mockRoute: { params: RootStackParamList['HostConfig'] } = {
  params: undefined,
};

const mockNavigation = {
  reset: jest.fn(),
  goBack: jest.fn(),
  navigate: jest.fn(),
  canGoBack: () => false,
};

const mockHostState = {
  config: null,
  setConfig: jest.fn(),
  clearConfig: jest.fn(),
  setConnectionStatus: jest.fn(),
};

const mockTailscaleState = {
  hostUrl: '',
  state: 'idle' as const,
  probe: jest.fn(async () => null),
  setHostUrl: jest.fn(),
  reset: jest.fn(),
};

const mockTailscaleStore = Object.assign(
  (selector: (state: typeof mockTailscaleState) => unknown) =>
    selector(mockTailscaleState),
  { getState: () => mockTailscaleState },
);

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: mockRoute.params }),
}));

jest.mock('../store/hostStore', () => ({
  useHostStore: () => mockHostState,
}));

jest.mock('../store/tailscaleConnectivityStore', () => {
  const useStore = (selector: (state: unknown) => unknown) =>
    (mockTailscaleStore as unknown as (
      selector: (state: unknown) => unknown,
    ) => unknown)(selector);
  return {
    useTailscaleConnectivityStore: Object.assign(useStore, {
      getState: () => mockTailscaleStore.getState(),
    }),
  };
});

jest.mock('../push/pushBindingService', () => ({
  pushBindingService: {
    revokeCurrentBinding: jest.fn(async () => undefined),
  },
}));

jest.mock('../pairing/PairingScannerModal', () => ({
  PairingScannerModal: () => null,
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      bg: {
        canvas: '#fff',
        card: '#fff',
        soft: '#eee',
        input: '#fff',
        elevated: '#fff',
      },
      border: { soft: '#eee', default: '#ddd' },
      text: {
        ink: '#111',
        base: '#222',
        soft: '#777',
        muted: '#777',
        placeholder: '#aaa',
      },
      primary: '#00f',
      primaryActive: '#009',
      primaryDisabled: '#aac',
      onPrimary: '#fff',
      overlay: 'rgba(0,0,0,0.4)',
      status: {
        error: '#c00',
        errorBg: '#fee',
        success: '#080',
      },
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
    children ?? null,
}));

jest.mock('lucide-react-native', () => ({
  CheckCircle2: () => null,
  ChevronLeft: () => null,
  KeyRound: () => null,
  ScanLine: () => null,
  ShieldCheck: () => null,
}));

jest.mock('../api/remoteMiraHost', () => {
  const actual = jest.requireActual(
    '../api/remoteMiraHost',
  ) as typeof import('../api/remoteMiraHost');
  const { MemoryDeviceCredentialStore } = jest.requireActual(
    '../security/deviceCredentialStore',
  ) as typeof import('../security/deviceCredentialStore');
  const direct = jest.fn();
  const client = new actual.RemoteMiraHostClient(
    new MemoryDeviceCredentialStore(),
    direct as never,
  );
  return {
    ...actual,
    remoteMiraHostClient: client,
    __pairingTransportSpies: { direct },
  };
});

const spies = (
  jest.requireMock('../api/remoteMiraHost') as {
    __pairingTransportSpies: TransportSpies;
  }
).__pairingTransportSpies;

const claimResponse = {
  claimId: 'claim-1',
  pollToken: 'poll-token',
  status: 'claimed' as const,
  expiresAt: '2026-11-23T00:10:00.000Z',
};

const successfulDirectTransport = async <T,>(
  request: RemoteJsonRequest<T>,
): Promise<T> => {
  if (request.path === '/health') {
    return request.parse({ status: 'ok' });
  }
  if (request.path === '/app/meta') {
    return request.parse({ name: 'Mira Host', displayName: 'Mira Desktop', version: '0.4.0' });
  }
  if (request.path === '/remote/pairing/claim') {
    return request.parse(claimResponse);
  }
  if (request.path.endsWith('/poll')) {
    return request.parse({
      status: 'pending',
      expiresAt: claimResponse.expiresAt,
      deviceId: null,
      scopes: [],
    });
  }
  throw new Error(`Unexpected Direct request: ${request.path}`);
};

const flush = async (rounds = 8): Promise<void> => {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) {
      await Promise.resolve();
    }
  });
};

const renderScreen = async (): Promise<ReactTestRenderer> => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<HostConfigScreen />);
  });
  await flush();
  return tree;
};

const findPressable = (
  tree: ReactTestRenderer,
  accessibilityLabel: string,
) =>
  tree.root.findAll(
    node =>
      node.props.accessibilityLabel === accessibilityLabel &&
      typeof node.props.onPress === 'function',
  )[0];

const renderedText = (tree: ReactTestRenderer): string =>
  tree.root
    .findAllByType(Text)
    .flatMap(node =>
      Array.isArray(node.props.children)
        ? node.props.children
        : [node.props.children],
    )
    .filter((value): value is string => typeof value === 'string')
    .join('\n');

const relayOnlyParams = {
  version: '1',
  challenge: 'challenge-1',
  code: 'ABCD2345',
  relay: 'https://relay.tomz.io',
  relayId: 'relay_1234567890abcdef',
  relayToken: 't'.repeat(43),
};

const directParams = {
  version: '1',
  host: 'https://desktop.example.ts.net',
  challenge: 'challenge-1',
  code: 'ABCD2345',
};

describe('HostConfigScreen Tailscale Direct-only pairing entry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRoute.params = undefined;
    spies.direct.mockImplementation(successfulDirectTransport);
  });

  it('claims a deep link with historical Relay fields only over Direct', async () => {
    mockRoute.params = {
      ...relayOnlyParams,
      ...directParams,
    };
    const tree = await renderScreen();

    const submit = findPressable(tree, '提交配对申请');
    expect(submit).toBeDefined();
    await act(async () => {
      submit.props.onPress();
    });
    await flush();

    const directPaths = spies.direct.mock.calls.map(call => call[0].path);
    expect(directPaths.slice(0, 3)).toEqual([
      '/health',
      '/app/meta',
      '/remote/pairing/claim',
    ]);
    expect(
      directPaths.filter(path => path === '/remote/pairing/claim'),
    ).toHaveLength(1);
    expect(directPaths).toContain(
      '/remote/pairing/claims/claim-1/poll',
    );
    expect(spies.direct.mock.calls[2][0].body).toMatchObject({
      transport: 'direct',
    });

    await act(async () => {
      tree.unmount();
    });
  });

  it('rejects a pasted Relay-only link before any claim side effect', async () => {
    const tree = await renderScreen();

    const input = tree.root.findAll(
      node =>
        node.props.accessibilityLabel === 'Mira 配对链接' &&
        typeof node.props.onChangeText === 'function',
    )[0];
    expect(input).toBeDefined();
    await act(async () => {
      input.props.onChangeText(
        `mira://pair?${new URLSearchParams(relayOnlyParams).toString()}`,
      );
    });

    const continueButton = findPressable(tree, '继续');
    expect(continueButton).toBeDefined();
    await act(async () => {
      continueButton.props.onPress();
    });
    await flush();

    expect(renderedText(tree)).toContain('仅支持 Tailscale 直连');
    expect(spies.direct).not.toHaveBeenCalled();

    await act(async () => {
      tree.unmount();
    });
  });

  it('shows a Direct reachability failure without submitting a claim', async () => {
    mockRoute.params = directParams;
    spies.direct.mockImplementation(async request => {
      if (request.path === '/health') {
        throw new RemoteHostError('NETWORK_ERROR', 'tailnet unavailable');
      }
      return successfulDirectTransport(request);
    });
    const tree = await renderScreen();

    const submit = findPressable(tree, '提交配对申请');
    await act(async () => {
      submit.props.onPress();
    });
    await flush();

    expect(renderedText(tree)).toContain(
      '无法通过 Tailscale 直连 Mira Desktop',
    );
    expect(spies.direct.mock.calls.map(call => call[0].path)).toEqual([
      '/health',
    ]);

    await act(async () => {
      tree.unmount();
    });
  });

  it('preserves an uncertain Direct claim without offering a transport retry', async () => {
    mockRoute.params = directParams;
    spies.direct.mockImplementation(async request => {
      if (request.path === '/health') {
        return request.parse({ status: 'ok' });
      }
      if (request.path === '/app/meta') {
        return request.parse({ name: 'Mira Host', displayName: 'Mira Desktop', version: '0.4.0' });
      }
      throw new RemoteHostError('NETWORK_ERROR', 'response lost');
    });
    const tree = await renderScreen();

    const submit = findPressable(tree, '提交配对申请');
    await act(async () => {
      submit.props.onPress();
    });
    await flush();

    const text = renderedText(tree);
    expect(text).toContain('状态不确定');
    expect(text).toContain('不要通过另一条通道重新提交');
    expect(findPressable(tree, '重试配对')).toBeUndefined();
    expect(spies.direct.mock.calls.map(call => call[0].path)).toEqual([
      '/health',
      '/app/meta',
      '/remote/pairing/claim',
    ]);

    await act(async () => {
      tree.unmount();
    });
  });

  it('rejects a deep link with an invalid Direct Host before any claim', async () => {
    mockRoute.params = {
      ...directParams,
      host: 'not-a-host',
    };
    const tree = await renderScreen();

    expect(renderedText(tree)).toContain('配对链接中的 Mira Host 地址无效');
    expect(spies.direct).not.toHaveBeenCalled();

    await act(async () => {
      tree.unmount();
    });
  });

  it('blocks pairing while Cloud is active without consuming a claim', async () => {
    useDesktopConnectionStore.setState({ mode: 'cloud', hydrated: true });
    mockRoute.params = directParams;
    let tree: ReactTestRenderer | undefined;
    try {
      tree = await renderScreen();

      expect(renderedText(tree)).toContain('当前正在使用 Mira Cloud 桌面连接');
      expect(
        findPressable(tree, '提交配对申请'),
      ).toBeUndefined();
      expect(spies.direct).not.toHaveBeenCalled();
    } finally {
      if (tree) {
        await act(async () => {
          tree?.unmount();
        });
      }
      useDesktopConnectionStore.setState({ mode: 'none', hydrated: true });
    }
  });
});
