import { NativeModules, Platform } from 'react-native';
import type { AppRelease } from './appUpdate';
import {
  AppUpdateInstallError,
  canInstallPackages,
  cancelUpdateDownload,
  downloadUpdate,
  installDownloadedUpdate,
  isInAppUpdateSupported,
  openInstallPermissionSettings,
  observeUpdateInstallFailures,
  parseUpdateProgress,
  toAppUpdateError,
  updateFileName,
  updateInstallErrorMessage,
} from './appUpdateInstall';

type ProgressHandler = (payload: unknown) => void;

const mockDownload = jest.fn();
const mockCancelDownload = jest.fn();
const mockInstall = jest.fn();
const mockCanInstallPackages = jest.fn();
const mockOpenInstallPermissionSettings = jest.fn();
const mockListeners = new Map<string, ProgressHandler[]>();

const PROGRESS_EVENT = 'MiraAppUpdateProgress';

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  NativeModules: {
    MiraAppUpdate: {
      download: (...args: unknown[]) => mockDownload(...args),
      cancelDownload: (...args: unknown[]) => mockCancelDownload(...args),
      install: (...args: unknown[]) => mockInstall(...args),
      canInstallPackages: (...args: unknown[]) => mockCanInstallPackages(...args),
      openInstallPermissionSettings: (...args: unknown[]) =>
        mockOpenInstallPermissionSettings(...args),
    },
  },
  DeviceEventEmitter: {
    addListener: (event: string, handler: ProgressHandler) => {
      const handlers = mockListeners.get(event) ?? [];
      handlers.push(handler);
      mockListeners.set(event, handlers);
      return {
        remove: () => {
          const current = mockListeners.get(event) ?? [];
          mockListeners.set(
            event,
            current.filter((entry) => entry !== handler),
          );
        },
      };
    },
  },
}));

const registeredNativeModule = NativeModules.MiraAppUpdate;

const emitProgress = (payload: unknown): void => {
  (mockListeners.get(PROGRESS_EVENT) ?? []).forEach((handler) => handler(payload));
};

const release: AppRelease = {
  version: { major: 0, minor: 4, patch: 0 },
  displayVersion: '0.4.0-dev',
  notes: null,
  apkUrl:
    'https://assets.tomz.io/mira/mobile/dev/releases/0.4.0/uichat-mira-mobile-release.apk',
  sha256: 'a'.repeat(64),
};

beforeEach(() => {
  mockDownload.mockReset();
  mockCancelDownload.mockReset();
  mockInstall.mockReset();
  mockCanInstallPackages.mockReset();
  mockOpenInstallPermissionSettings.mockReset();
  mockListeners.clear();
  NativeModules.MiraAppUpdate = registeredNativeModule;
  Platform.OS = 'android';
});

describe('isInAppUpdateSupported', () => {
  it('is supported on Android when the native module is registered', () => {
    expect(isInAppUpdateSupported()).toBe(true);
  });

  it('is not supported on iOS', () => {
    Platform.OS = 'ios';
    expect(isInAppUpdateSupported()).toBe(false);
  });

  it('is not supported when JS and the native project drifted apart', () => {
    delete NativeModules.MiraAppUpdate;
    expect(isInAppUpdateSupported()).toBe(false);
  });
});

describe('parseUpdateProgress', () => {
  it('keeps the reported target and total', () => {
    expect(
      parseUpdateProgress({
        target: 'mira-0.4.0-dev.apk',
        receivedBytes: 10,
        totalBytes: 40,
      }),
    ).toEqual({ target: 'mira-0.4.0-dev.apk', receivedBytes: 10, totalBytes: 40 });
  });

  it('reports a missing total as null instead of zero', () => {
    expect(
      parseUpdateProgress({
        target: 'mira-0.4.0-dev.apk',
        receivedBytes: 10,
        totalBytes: null,
      }),
    ).toEqual({ target: 'mira-0.4.0-dev.apk', receivedBytes: 10, totalBytes: null });
  });

  it('rejects payloads without a usable byte count', () => {
    expect(parseUpdateProgress({})).toBeNull();
    expect(
      parseUpdateProgress({ target: 'mira-0.4.0-dev.apk', receivedBytes: 'ten' }),
    ).toBeNull();
    expect(
      parseUpdateProgress({
        target: 'mira-0.4.0-dev.apk',
        receivedBytes: 10,
        totalBytes: 'many',
      }),
    ).toBeNull();
    expect(parseUpdateProgress(null)).toBeNull();
  });

  it('rejects frames that do not name the transfer they belong to', () => {
    expect(parseUpdateProgress({ receivedBytes: 10, totalBytes: 40 })).toBeNull();
    expect(
      parseUpdateProgress({ target: '', receivedBytes: 10, totalBytes: 40 }),
    ).toBeNull();
  });
});

describe('updateFileName', () => {
  it('derives a FileProvider-safe name from the display version', () => {
    expect(updateFileName(release)).toBe('mira-0.4.0-dev.apk');
  });

  it('replaces characters the FileProvider whitelist rejects', () => {
    expect(updateFileName({ ...release, displayVersion: '0.4.0 dev/beta' })).toBe(
      'mira-0.4.0-dev-beta.apk',
    );
  });
});

describe('downloadUpdate', () => {
  it('downloads the canonical APK and forwards native progress', async () => {
    mockDownload.mockResolvedValue('/cache/mira-update/mira-0.4.0-dev.apk');
    const progress: unknown[] = [];

    const pending = downloadUpdate(release, (update) => progress.push(update));
    emitProgress({
      target: 'mira-0.4.0-dev.apk',
      receivedBytes: 512,
      totalBytes: 2048,
    });

    await expect(pending).resolves.toBe('/cache/mira-update/mira-0.4.0-dev.apk');
    expect(mockDownload).toHaveBeenCalledWith(
      release.apkUrl,
      release.sha256,
      'mira-0.4.0-dev.apk',
    );
    expect(progress).toEqual([
      { target: 'mira-0.4.0-dev.apk', receivedBytes: 512, totalBytes: 2048 },
    ]);
  });

  it('drops progress frames that belong to another transfer', async () => {
    mockDownload.mockResolvedValue('/cache/mira-update/mira-0.4.0-dev.apk');
    const progress: unknown[] = [];

    const pending = downloadUpdate(release, (update) => progress.push(update));
    emitProgress({ target: 'mira-0.3.9-dev.apk', receivedBytes: 999, totalBytes: 1000 });
    emitProgress({
      target: 'mira-0.4.0-dev.apk',
      receivedBytes: 512,
      totalBytes: 2048,
    });

    await pending;

    expect(progress).toEqual([
      { target: 'mira-0.4.0-dev.apk', receivedBytes: 512, totalBytes: 2048 },
    ]);
  });

  it('stops listening for progress once the download settles', async () => {
    mockDownload.mockResolvedValue('/cache/mira-update/mira-0.4.0-dev.apk');

    await downloadUpdate(release, () => {});

    expect(mockListeners.get(PROGRESS_EVENT) ?? []).toHaveLength(0);
  });

  it('normalises a native rejection object into an error carrying its code', async () => {
    mockDownload.mockRejectedValue({
      code: 'UPDATE_DIGEST_MISMATCH',
      message: 'Downloaded update failed SHA-256 verification',
    });

    const failure = await downloadUpdate(release, () => {}).catch(
      (caught: unknown) => caught,
    );

    expect(failure).toBeInstanceOf(AppUpdateInstallError);
    expect(failure).toMatchObject({ code: 'UPDATE_DIGEST_MISMATCH' });
  });

  it('fails with UPDATE_UNSUPPORTED instead of calling a missing module', async () => {
    delete NativeModules.MiraAppUpdate;

    await expect(downloadUpdate(release, () => {})).rejects.toMatchObject({
      code: 'UPDATE_UNSUPPORTED',
    });
    expect(mockDownload).not.toHaveBeenCalled();
  });
});

describe('installDownloadedUpdate', () => {
  it('hands the verified file path and digest to the native installer', async () => {
    mockInstall.mockResolvedValue(42);

    await expect(
      installDownloadedUpdate('/cache/mira-update/mira-0.4.0-dev.apk', release.sha256),
    ).resolves.toBe(42);

    expect(mockInstall).toHaveBeenCalledWith(
      '/cache/mira-update/mira-0.4.0-dev.apk',
      release.sha256,
    );
  });

  it('surfaces the install permission requirement as its own code', async () => {
    mockInstall.mockRejectedValue({
      code: 'UPDATE_PERMISSION_REQUIRED',
      message: 'Installing unknown apps is not allowed for Mira',
    });

    await expect(
      installDownloadedUpdate('/cache/mira-update/mira-0.4.0-dev.apk', release.sha256),
    ).rejects.toMatchObject({ code: 'UPDATE_PERMISSION_REQUIRED' });
  });

  it('reports a digest mismatch raised by the installer instead of installing', async () => {
    mockInstall.mockRejectedValue({
      code: 'UPDATE_DIGEST_MISMATCH',
      message: 'Update file failed SHA-256 verification',
    });

    await expect(
      installDownloadedUpdate('/cache/mira-update/mira-0.4.0-dev.apk', release.sha256),
    ).rejects.toMatchObject({ code: 'UPDATE_DIGEST_MISMATCH' });
  });
});

describe('installer failure notifications', () => {
  it('accepts only bounded session-correlated failure events', () => {
    const handler = jest.fn();
    const subscription = observeUpdateInstallFailures(handler);
    emitProgress({ sessionId: 42, message: '安装失败' });
    expect(handler).not.toHaveBeenCalled();
    (mockListeners.get('MiraAppUpdateInstallFailure') ?? []).forEach((fn) =>
      fn({ sessionId: 42, message: '安装失败' }),
    );
    expect(handler).toHaveBeenCalledWith({ sessionId: 42, message: '安装失败' });
    (mockListeners.get('MiraAppUpdateInstallFailure') ?? []).forEach((fn) => {
      fn({ sessionId: '42', message: 'not valid' });
      fn({ sessionId: 41, message: '' });
      fn({ sessionId: 43, message: 'x'.repeat(121) });
    });
    expect(handler).toHaveBeenCalledTimes(1);
    subscription.remove();
  });
});

describe('install permission helpers', () => {
  it('reads the current install consent from the platform', async () => {
    mockCanInstallPackages.mockResolvedValue(true);
    await expect(canInstallPackages()).resolves.toBe(true);

    mockCanInstallPackages.mockResolvedValue(false);
    await expect(canInstallPackages()).resolves.toBe(false);
  });

  it('reports no consent when the native module is absent', async () => {
    delete NativeModules.MiraAppUpdate;
    await expect(canInstallPackages()).resolves.toBe(false);
  });

  it('opens the platform page that grants install consent', async () => {
    mockOpenInstallPermissionSettings.mockResolvedValue(undefined);

    await openInstallPermissionSettings();

    expect(mockOpenInstallPermissionSettings).toHaveBeenCalledTimes(1);
  });
});

describe('cancelUpdateDownload', () => {
  it('asks the native module to stop the transfer', async () => {
    mockCancelDownload.mockResolvedValue(undefined);

    await cancelUpdateDownload();

    expect(mockCancelDownload).toHaveBeenCalledTimes(1);
  });

  it('resolves even when the native cancel fails', async () => {
    mockCancelDownload.mockRejectedValue(new Error('no active download'));

    await expect(cancelUpdateDownload()).resolves.toBeUndefined();
  });
});

describe('toAppUpdateError', () => {
  it('passes an existing AppUpdateInstallError through untouched', () => {
    const original = new AppUpdateInstallError('UPDATE_CANCELLED', 'cancelled');
    expect(toAppUpdateError(original)).toBe(original);
  });

  it('falls back to UPDATE_INSTALL_FAILED for an unrecognised failure', () => {
    expect(toAppUpdateError(new Error('boom')).code).toBe('UPDATE_INSTALL_FAILED');
    expect(toAppUpdateError('boom').code).toBe('UPDATE_INSTALL_FAILED');
  });
});

describe('updateInstallErrorMessage', () => {
  it('explains each actionable failure in user-facing language', () => {
    expect(updateInstallErrorMessage({ code: 'UPDATE_DOWNLOAD_HTTP' })).toContain(
      '网络',
    );
    expect(updateInstallErrorMessage({ code: 'UPDATE_DIGEST_MISMATCH' })).toContain(
      '校验',
    );
    expect(
      updateInstallErrorMessage({ code: 'UPDATE_PERMISSION_REQUIRED' }),
    ).toContain('安装未知应用');
  });

  it('falls back to a generic message for unknown codes', () => {
    expect(updateInstallErrorMessage({ code: 'SOMETHING_ELSE' })).toBe(
      '更新失败，请稍后重试。',
    );
    expect(updateInstallErrorMessage(undefined)).toBe('更新失败，请稍后重试。');
  });
});
