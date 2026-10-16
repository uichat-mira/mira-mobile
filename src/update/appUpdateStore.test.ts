import type { AppRelease } from './appUpdate';
import { useAppUpdateStore } from './appUpdateStore';

const mockDownloadUpdate = jest.fn();
const mockInstallDownloadedUpdate = jest.fn();
const mockCancelUpdateDownload = jest.fn();
const mockOpenInstallPermissionSettings = jest.fn();

jest.mock('./appUpdateInstall', () => {
  const actual = jest.requireActual('./appUpdateInstall');
  return {
    ...actual,
    downloadUpdate: (...args: unknown[]) => mockDownloadUpdate(...args),
    installDownloadedUpdate: (...args: unknown[]) => mockInstallDownloadedUpdate(...args),
    cancelUpdateDownload: (...args: unknown[]) => mockCancelUpdateDownload(...args),
    openInstallPermissionSettings: (...args: unknown[]) =>
      mockOpenInstallPermissionSettings(...args),
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

beforeEach(() => {
  mockDownloadUpdate.mockReset();
  mockInstallDownloadedUpdate.mockReset();
  mockCancelUpdateDownload.mockReset();
  mockOpenInstallPermissionSettings.mockReset();
  mockCancelUpdateDownload.mockResolvedValue(undefined);
  mockOpenInstallPermissionSettings.mockResolvedValue(undefined);
  useAppUpdateStore.setState({ flow: null });
});

describe('starting an in-app update', () => {
  it('moves from idle to downloading and requests the release APK', () => {
    const download = deferred<string>();
    mockDownloadUpdate.mockReturnValue(download.promise);

    useAppUpdateStore.getState().start(release);

    expect(currentFlow()).toMatchObject({
      status: 'downloading',
      receivedBytes: 0,
      totalBytes: null,
      errorMessage: null,
    });
    expect(mockDownloadUpdate).toHaveBeenCalledWith(release, expect.any(Function));
  });

  it('ignores a second start while a download is already running', () => {
    const download = deferred<string>();
    mockDownloadUpdate.mockReturnValue(download.promise);

    useAppUpdateStore.getState().start(release);
    useAppUpdateStore.getState().start(release);

    expect(mockDownloadUpdate).toHaveBeenCalledTimes(1);
  });

  it('tracks native progress into the visible bytes', async () => {
    const download = deferred<string>();
    mockDownloadUpdate.mockReturnValue(download.promise);

    useAppUpdateStore.getState().start(release);
    const onProgress = mockDownloadUpdate.mock.calls[0][1] as (progress: {
      receivedBytes: number;
      totalBytes: number | null;
    }) => void;
    onProgress({ receivedBytes: 2048, totalBytes: 8192 });

    expect(currentFlow()).toMatchObject({ receivedBytes: 2048, totalBytes: 8192 });
  });
});

describe('completing an in-app update', () => {
  it('installs the verified file and then reports the hand-off', async () => {
    const download = deferred<string>();
    mockDownloadUpdate.mockReturnValue(download.promise);
    mockInstallDownloadedUpdate.mockResolvedValue(undefined);

    useAppUpdateStore.getState().start(release);
    download.resolve('/cache/mira-update/mira-0.4.0-dev.apk');
    await flush();

    expect(mockInstallDownloadedUpdate).toHaveBeenCalledWith(
      '/cache/mira-update/mira-0.4.0-dev.apk',
    );
    expect(currentFlow()).toMatchObject({ status: 'handed-off', errorMessage: null });
  });

  it('asks for install consent instead of failing when the platform refuses', async () => {
    const download = deferred<string>();
    mockDownloadUpdate.mockReturnValue(download.promise);
    mockInstallDownloadedUpdate.mockRejectedValue({
      code: 'UPDATE_PERMISSION_REQUIRED',
      message: 'Installing unknown apps is not allowed for Mira',
    });

    useAppUpdateStore.getState().start(release);
    download.resolve('/cache/mira-update/mira-0.4.0-dev.apk');
    await flush();

    expect(currentFlow()).toMatchObject({ status: 'permission-required' });
    expect(currentFlow()?.errorMessage).toContain('安装未知应用');
  });

  it('surfaces a verification failure with an actionable message', async () => {
    const download = deferred<string>();
    mockDownloadUpdate.mockReturnValue(download.promise);

    useAppUpdateStore.getState().start(release);
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
    useAppUpdateStore.getState().cancel();

    expect(currentFlow()).toBeNull();
    expect(mockCancelUpdateDownload).toHaveBeenCalledTimes(1);

    download.resolve('/cache/mira-update/mira-0.4.0-dev.apk');
    await flush();

    expect(currentFlow()).toBeNull();
    expect(mockInstallDownloadedUpdate).not.toHaveBeenCalled();
  });

  it('drops late progress from a dismissed run', async () => {
    const download = deferred<string>();
    mockDownloadUpdate.mockReturnValue(download.promise);

    useAppUpdateStore.getState().start(release);
    const onProgress = mockDownloadUpdate.mock.calls[0][1] as (progress: {
      receivedBytes: number;
      totalBytes: number | null;
    }) => void;
    useAppUpdateStore.getState().dismiss();
    onProgress({ receivedBytes: 4096, totalBytes: 8192 });

    expect(currentFlow()).toBeNull();
  });

  it('restarts the same release after a failure', async () => {
    const first = deferred<string>();
    mockDownloadUpdate.mockReturnValueOnce(first.promise);
    useAppUpdateStore.getState().start(release);
    first.reject({ code: 'UPDATE_DOWNLOAD_HTTP', message: 'HTTP 500' });
    await flush();
    expect(currentFlow()).toMatchObject({ status: 'failed' });

    const second = deferred<string>();
    mockDownloadUpdate.mockReturnValueOnce(second.promise);
    useAppUpdateStore.getState().retry();

    expect(mockDownloadUpdate).toHaveBeenCalledTimes(2);
    expect(currentFlow()).toMatchObject({ status: 'downloading', errorMessage: null });
  });
});

describe('opening the install permission page', () => {
  it('requests the platform settings page', () => {
    useAppUpdateStore.getState().openPermissionSettings();

    expect(mockOpenInstallPermissionSettings).toHaveBeenCalledTimes(1);
  });
});
