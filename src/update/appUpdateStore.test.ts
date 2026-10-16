import type { AppRelease } from './appUpdate';
import { useAppUpdateStore } from './appUpdateStore';

const mockDownloadUpdate = jest.fn();
const mockInstallDownloadedUpdate = jest.fn();
const mockCancelUpdateDownload = jest.fn();
const mockOpenInstallPermissionSettings = jest.fn();
const mockCanInstallPackages = jest.fn();
const mockIsInAppUpdateSupported = jest.fn();

jest.mock('./appUpdateInstall', () => {
  const actual = jest.requireActual('./appUpdateInstall');
  return {
    ...actual,
    downloadUpdate: (...args: unknown[]) => mockDownloadUpdate(...args),
    installDownloadedUpdate: (...args: unknown[]) => mockInstallDownloadedUpdate(...args),
    cancelUpdateDownload: (...args: unknown[]) => mockCancelUpdateDownload(...args),
    openInstallPermissionSettings: (...args: unknown[]) =>
      mockOpenInstallPermissionSettings(...args),
    canInstallPackages: (...args: unknown[]) => mockCanInstallPackages(...args),
    isInAppUpdateSupported: () => mockIsInAppUpdateSupported(),
  };
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(() => resolve(), 0);
  });
};

const release: AppRelease = {
  version: { major: 0, minor: 4, patch: 0 },
  displayVersion: '0.4.0-dev',
  notes: null,
  apkUrl:
    'https://assets.tomz.io/mira/mobile/dev/releases/0.4.0/uichat-mira-mobile-release.apk',
  sha256: 'a'.repeat(64),
};

const currentFlow = () => useAppUpdateStore.getState().flow;

const progressCallbackFor = (callIndex: number) =>
  mockDownloadUpdate.mock.calls[callIndex][1] as (progress: {
    receivedBytes: number;
    totalBytes: number | null;
  }) => void;

beforeEach(() => {
  mockDownloadUpdate.mockReset();
  mockInstallDownloadedUpdate.mockReset();
  mockCancelUpdateDownload.mockReset();
  mockOpenInstallPermissionSettings.mockReset();
  mockCanInstallPackages.mockReset();
  mockIsInAppUpdateSupported.mockReset();
  mockCancelUpdateDownload.mockResolvedValue(undefined);
  mockOpenInstallPermissionSettings.mockResolvedValue(undefined);
  mockCanInstallPackages.mockResolvedValue(true);
  // Left off by default so the permission pre-flight stays out of the way of
  // the flow tests; the pre-flight has its own cases below.
  mockIsInAppUpdateSupported.mockReturnValue(false);
  useAppUpdateStore.setState({ flow: null });
});

describe('starting an in-app update', () => {
  it('moves from idle to downloading, then requests the release APK', async () => {
    const download = deferred<string>();
    mockDownloadUpdate.mockReturnValue(download.promise);

    useAppUpdateStore.getState().start(release);

    expect(currentFlow()).toMatchObject({
      status: 'downloading',
      receivedBytes: 0,
      totalBytes: null,
      errorMessage: null,
    });

    await flush();

    expect(mockDownloadUpdate).toHaveBeenCalledWith(release, expect.any(Function));
  });

  it('tears down any previous native transfer before starting a new download', async () => {
    const order: string[] = [];
    mockCancelUpdateDownload.mockImplementation(async () => {
      order.push('cancel');
    });
    mockDownloadUpdate.mockImplementation(async () => {
      order.push('download');
      return '/cache/mira-update/mira-0.4.0-dev.apk';
    });

    useAppUpdateStore.getState().start(release);
    await flush();

    // The native module refuses a concurrent download, so cancelling first is
    // what keeps a retry from failing while the old thread winds down.
    expect(order).toEqual(['cancel', 'download']);
  });

  it('ignores a second start while a download is already running', async () => {
    const download = deferred<string>();
    mockDownloadUpdate.mockReturnValue(download.promise);

    useAppUpdateStore.getState().start(release);
    useAppUpdateStore.getState().start(release);
    await flush();

    expect(mockDownloadUpdate).toHaveBeenCalledTimes(1);
  });

  it('tracks native progress into the visible bytes', async () => {
    const download = deferred<string>();
    mockDownloadUpdate.mockReturnValue(download.promise);

    useAppUpdateStore.getState().start(release);
    await flush();
    progressCallbackFor(0)({ receivedBytes: 2048, totalBytes: 8192 });

    expect(currentFlow()).toMatchObject({ receivedBytes: 2048, totalBytes: 8192 });
  });
});

describe('install consent pre-flight', () => {
  it('asks for consent instead of downloading when the platform will refuse the install', async () => {
    mockIsInAppUpdateSupported.mockReturnValue(true);
    mockCanInstallPackages.mockResolvedValue(false);

    useAppUpdateStore.getState().start(release);
    await flush();

    expect(mockDownloadUpdate).not.toHaveBeenCalled();
    expect(currentFlow()).toMatchObject({ status: 'permission-required' });
    expect(currentFlow()?.errorMessage).toContain('安装未知应用');
  });

  it('downloads normally once consent is present', async () => {
    mockIsInAppUpdateSupported.mockReturnValue(true);
    mockCanInstallPackages.mockResolvedValue(true);
    const download = deferred<string>();
    mockDownloadUpdate.mockReturnValue(download.promise);

    useAppUpdateStore.getState().start(release);
    await flush();

    expect(mockDownloadUpdate).toHaveBeenCalledTimes(1);
    expect(currentFlow()).toMatchObject({ status: 'downloading' });
  });
});

describe('completing an in-app update', () => {
  it('installs the verified file and then reports the hand-off', async () => {
    const download = deferred<string>();
    mockDownloadUpdate.mockReturnValue(download.promise);
    mockInstallDownloadedUpdate.mockResolvedValue(undefined);

    useAppUpdateStore.getState().start(release);
    await flush();
    download.resolve('/cache/mira-update/mira-0.4.0-dev.apk');
    await flush();

    expect(mockInstallDownloadedUpdate).toHaveBeenCalledWith(
      '/cache/mira-update/mira-0.4.0-dev.apk',
      release.sha256,
    );
    expect(currentFlow()).toMatchObject({ status: 'handed-off', errorMessage: null });
  });

  it('asks for install consent when the installer refuses at the end', async () => {
    const download = deferred<string>();
    mockDownloadUpdate.mockReturnValue(download.promise);
    mockInstallDownloadedUpdate.mockRejectedValue({
      code: 'UPDATE_PERMISSION_REQUIRED',
      message: 'Installing unknown apps is not allowed for Mira',
    });

    useAppUpdateStore.getState().start(release);
    await flush();
    download.resolve('/cache/mira-update/mira-0.4.0-dev.apk');
    await flush();

    expect(currentFlow()).toMatchObject({ status: 'permission-required' });
    expect(currentFlow()?.errorMessage).toContain('安装未知应用');
  });

  it('surfaces a verification failure with an actionable message', async () => {
    const download = deferred<string>();
    mockDownloadUpdate.mockReturnValue(download.promise);

    useAppUpdateStore.getState().start(release);
    await flush();
    download.reject({ code: 'UPDATE_DIGEST_MISMATCH', message: 'digest mismatch' });
    await flush();

    expect(currentFlow()).toMatchObject({ status: 'failed' });
    expect(currentFlow()?.errorMessage).toContain('校验');
    expect(mockInstallDownloadedUpdate).not.toHaveBeenCalled();
  });
});

describe('leaving the update flow', () => {
  it('cancels the transfer and stops tracking the abandoned run', async () => {
    const download = deferred<string>();
    mockDownloadUpdate.mockReturnValue(download.promise);

    useAppUpdateStore.getState().start(release);
    await flush();
    const cancelsBefore = mockCancelUpdateDownload.mock.calls.length;

    useAppUpdateStore.getState().cancel();

    expect(currentFlow()).toBeNull();
    expect(mockCancelUpdateDownload.mock.calls.length).toBe(cancelsBefore + 1);

    download.resolve('/cache/mira-update/mira-0.4.0-dev.apk');
    await flush();

    expect(currentFlow()).toBeNull();
    expect(mockInstallDownloadedUpdate).not.toHaveBeenCalled();
  });

  it('drops late progress from a dismissed run', async () => {
    const download = deferred<string>();
    mockDownloadUpdate.mockReturnValue(download.promise);

    useAppUpdateStore.getState().start(release);
    await flush();
    const onProgress = progressCallbackFor(0);
    useAppUpdateStore.getState().dismiss();
    onProgress({ receivedBytes: 4096, totalBytes: 8192 });

    expect(currentFlow()).toBeNull();
  });

  it('restarts the same release after a failure', async () => {
    const first = deferred<string>();
    mockDownloadUpdate.mockReturnValueOnce(first.promise);
    useAppUpdateStore.getState().start(release);
    await flush();
    first.reject({ code: 'UPDATE_DOWNLOAD_HTTP', message: 'HTTP 500' });
    await flush();
    expect(currentFlow()).toMatchObject({ status: 'failed' });

    const order: string[] = [];
    mockCancelUpdateDownload.mockImplementation(async () => {
      order.push('cancel');
    });
    const second = deferred<string>();
    mockDownloadUpdate.mockImplementationOnce(async () => {
      order.push('download');
      return second.promise;
    });

    useAppUpdateStore.getState().retry();
    await flush();

    expect(order).toEqual(['cancel', 'download']);
    expect(currentFlow()).toMatchObject({ status: 'downloading', errorMessage: null });
  });
});

describe('opening the install permission page', () => {
  it('requests the platform settings page', () => {
    useAppUpdateStore.getState().openPermissionSettings();

    expect(mockOpenInstallPermissionSettings).toHaveBeenCalledTimes(1);
  });
});
