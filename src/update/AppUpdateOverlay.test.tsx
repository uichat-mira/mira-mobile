import React from 'react';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';
import type { AppRelease } from './appUpdate';
import {
  AppUpdateOverlay,
  formatBytes,
  updateProgressRatio,
} from './AppUpdateOverlay';
import { useAppUpdateStore, type AppUpdateFlow } from './appUpdateStore';

const mockCancelUpdateDownload = jest.fn();

jest.mock('./appUpdateInstall', () => ({
  downloadUpdate: jest.fn(),
  installDownloadedUpdate: jest.fn(),
  cancelUpdateDownload: (...args: unknown[]) => mockCancelUpdateDownload(...args),
  openInstallPermissionSettings: jest.fn(),
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      bg: { canvas: '#fff', card: '#fff', soft: '#eee' },
      border: { default: '#ddd' },
      text: { ink: '#111', muted: '#777', soft: '#777' },
      primary: '#c96442',
      primaryDisabled: '#eee',
      onPrimary: '#fff',
      status: { success: '#0a0', warning: '#aa0', error: '#c00', errorBg: '#fee' },
    },
  }),
}));

const release: AppRelease = {
  version: { major: 0, minor: 4, patch: 0 },
  displayVersion: '0.4.0-dev',
  notes: null,
  apkUrl:
    'https://assets.tomz.io/mira/mobile/dev/releases/0.4.0/uichat-mira-mobile-release.apk',
  sha256: 'a'.repeat(64),
};

const flowWith = (overrides: Partial<AppUpdateFlow>): AppUpdateFlow => ({
  release,
  status: 'downloading',
  receivedBytes: 0,
  totalBytes: null,
  errorMessage: null,
  ...overrides,
});

// The store is a module singleton, so it is seeded through `act` to keep the
// subscribed tree's re-render inside React's test scheduler.
const setFlow = (flow: AppUpdateFlow | null): void => {
  act(() => {
    useAppUpdateStore.setState({ flow });
  });
};

let mounted: ReactTestRenderer[] = [];

const renderOverlay = (): ReactTestRenderer => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(<AppUpdateOverlay />);
  });
  mounted.push(tree);
  return tree;
};

const nodeWithTestId = (tree: ReactTestRenderer, testID: string) =>
  tree.root.findAll((node) => node.props.testID === testID)[0];

const textsOf = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAll((node) => typeof node.props.children === 'string')
    .map((node) => node.props.children as string);

beforeEach(() => {
  mockCancelUpdateDownload.mockReset();
  mockCancelUpdateDownload.mockResolvedValue(undefined);
  act(() => {
    useAppUpdateStore.setState({ flow: null });
  });
});

// The store is a module singleton: an unmounted tree keeps its subscription and
// would warn on the next `setState`, so every renderer is torn down explicitly.
afterEach(() => {
  act(() => {
    mounted.forEach((tree) => tree.unmount());
  });
  mounted = [];
});

describe('formatBytes', () => {
  it('scales to a readable unit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(40 * 1024 * 1024)).toBe('40 MB');
  });
});

describe('updateProgressRatio', () => {
  it('is indeterminate when the server did not report a total', () => {
    expect(updateProgressRatio(flowWith({ receivedBytes: 100 }))).toBeNull();
  });

  it('never exceeds a full bar', () => {
    expect(
      updateProgressRatio(flowWith({ receivedBytes: 300, totalBytes: 200 })),
    ).toBe(1);
    expect(
      updateProgressRatio(flowWith({ receivedBytes: 50, totalBytes: 200 })),
    ).toBe(0.25);
  });
});

describe('AppUpdateOverlay', () => {
  it('renders nothing while no update flow is active', () => {
    expect(renderOverlay().toJSON()).toBeNull();
  });

  it('shows the download progress the store reports', () => {
    setFlow(flowWith({ receivedBytes: 512, totalBytes: 2048 }));

    const texts = textsOf(renderOverlay());

    expect(texts).toContain('正在下载更新');
    expect(
      texts.some((value) => value.includes('512 B') && value.includes('2.0 KB')),
    ).toBe(true);
  });

  it('cancels the running download when the backdrop is tapped', () => {
    setFlow(flowWith({ status: 'downloading' }));
    const tree = renderOverlay();

    act(() => {
      nodeWithTestId(tree, 'app-update-backdrop').props.onPress();
    });

    expect(mockCancelUpdateDownload).toHaveBeenCalledTimes(1);
    expect(useAppUpdateStore.getState().flow).toBeNull();
  });

  it('dismisses a terminal flow without cancelling a transfer that is not running', () => {
    setFlow(flowWith({ status: 'failed', errorMessage: '更新失败，请稍后重试。' }));
    const tree = renderOverlay();

    act(() => {
      nodeWithTestId(tree, 'app-update-backdrop').props.onPress();
    });

    expect(mockCancelUpdateDownload).not.toHaveBeenCalled();
    expect(useAppUpdateStore.getState().flow).toBeNull();
  });

  it('keeps taps on the sheet from reaching the backdrop', () => {
    setFlow(flowWith({ status: 'downloading' }));
    const tree = renderOverlay();

    expect(
      nodeWithTestId(tree, 'app-update-sheet').props.onStartShouldSetResponder(),
    ).toBe(true);
    expect(useAppUpdateStore.getState().flow).not.toBeNull();
  });

  it('explains a permission stop with an actionable label', () => {
    setFlow(
      flowWith({
        status: 'permission-required',
        errorMessage: '需要允许 Mira「安装未知应用」才能完成更新。',
      }),
    );

    const texts = textsOf(renderOverlay());

    expect(texts).toContain('需要安装权限');
    expect(texts).toContain('前往设置');
  });
});
