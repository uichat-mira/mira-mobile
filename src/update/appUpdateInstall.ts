import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import type { AppRelease } from './appUpdate';

/**
 * Progress reported while the release APK is being written to the app cache.
 * `totalBytes` is null when the server does not send a usable Content-Length,
 * so callers must not treat a missing total as zero.
 */
export interface UpdateDownloadProgress {
  receivedBytes: number;
  totalBytes: number | null;
}

export type AppUpdateErrorCode =
  | 'UPDATE_UNSUPPORTED'
  | 'UPDATE_BAD_ARGUMENT'
  | 'UPDATE_ALREADY_DOWNLOADING'
  | 'UPDATE_DOWNLOAD_HTTP'
  | 'UPDATE_DOWNLOAD_IO'
  | 'UPDATE_DIGEST_MISMATCH'
  | 'UPDATE_CANCELLED'
  | 'UPDATE_FILE_MISSING'
  | 'UPDATE_FILE_OUTSIDE_CACHE'
  | 'UPDATE_PERMISSION_REQUIRED'
  | 'UPDATE_INSTALL_FAILED';

/**
 * Native rejections arrive as plain `{ code, message }` objects rather than
 * `Error` instances, so every failure crossing the bridge is normalised here
 * instead of being pattern-matched at each call site.
 */
export class AppUpdateInstallError extends Error {
  readonly code: AppUpdateErrorCode;

  constructor(code: AppUpdateErrorCode, message: string) {
    super(message);
    this.name = 'AppUpdateInstallError';
    this.code = code;
  }
}

interface MiraAppUpdateNativeModule {
  download(url: string, sha256: string, fileName: string): Promise<string>;
  cancelDownload(): Promise<void>;
  install(filePath: string, sha256: string): Promise<void>;
  canInstallPackages(): Promise<boolean>;
  openInstallPermissionSettings(): Promise<void>;
}

const PROGRESS_EVENT = 'MiraAppUpdateProgress';

const getNativeModule = (): MiraAppUpdateNativeModule | null => {
  const nativeModule = NativeModules.MiraAppUpdate as
    | MiraAppUpdateNativeModule
    | undefined;
  return nativeModule ?? null;
};

/**
 * In-app update is an Android capability: iOS has no signed distributable in
 * the release channel, and a missing native module means JS and the native
 * project drifted apart.
 */
export const isInAppUpdateSupported = (): boolean =>
  Platform.OS === 'android' && getNativeModule() !== null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const parseUpdateProgress = (
  payload: unknown,
): UpdateDownloadProgress | null => {
  if (!isRecord(payload)) return null;
  const { receivedBytes, totalBytes } = payload;
  if (typeof receivedBytes !== 'number' || !Number.isFinite(receivedBytes)) {
    return null;
  }
  if (totalBytes == null) {
    return { receivedBytes, totalBytes: null };
  }
  if (typeof totalBytes !== 'number' || !Number.isFinite(totalBytes)) {
    return null;
  }
  return { receivedBytes, totalBytes };
};

export const toAppUpdateError = (error: unknown): AppUpdateInstallError => {
  if (error instanceof AppUpdateInstallError) return error;
  if (isRecord(error)) {
    const { code, message } = error;
    if (typeof code === 'string') {
      return new AppUpdateInstallError(
        code as AppUpdateErrorCode,
        typeof message === 'string' && message.length > 0 ? message : code,
      );
    }
  }
  return new AppUpdateInstallError(
    'UPDATE_INSTALL_FAILED',
    error instanceof Error ? error.message : String(error),
  );
};

const updateErrorCode = (error: unknown): AppUpdateErrorCode | null => {
  if (error instanceof AppUpdateInstallError) return error.code;
  if (isRecord(error) && typeof error.code === 'string') {
    return error.code as AppUpdateErrorCode;
  }
  return null;
};

/**
 * Native file names must stay inside the FileProvider path whitelist, so the
 * channel-qualified display version is sanitised rather than trusted.
 */
export const updateFileName = (release: AppRelease): string =>
  `mira-${release.displayVersion.replace(/[^A-Za-z0-9._-]/g, '-')}.apk`;

export const downloadUpdate = async (
  release: AppRelease,
  onProgress: (progress: UpdateDownloadProgress) => void,
): Promise<string> => {
  const nativeModule = getNativeModule();
  if (nativeModule === null) {
    throw new AppUpdateInstallError(
      'UPDATE_UNSUPPORTED',
      'This platform cannot download updates in the app',
    );
  }

  const subscription = DeviceEventEmitter.addListener(
    PROGRESS_EVENT,
    (payload: unknown) => {
      const progress = parseUpdateProgress(payload);
      if (progress) onProgress(progress);
    },
  );

  try {
    return await nativeModule.download(
      release.apkUrl,
      release.sha256,
      updateFileName(release),
    );
  } catch (error) {
    throw toAppUpdateError(error);
  } finally {
    subscription.remove();
  }
};

/**
 * The native installer re-verifies the file against `sha256` before handing it
 * to the system, so the integrity gate does not depend on this call site having
 * received the path from `downloadUpdate`.
 */
export const installDownloadedUpdate = async (
  filePath: string,
  sha256: string,
): Promise<void> => {
  const nativeModule = getNativeModule();
  if (nativeModule === null) {
    throw new AppUpdateInstallError(
      'UPDATE_UNSUPPORTED',
      'This platform cannot install updates in the app',
    );
  }
  try {
    await nativeModule.install(filePath, sha256);
  } catch (error) {
    throw toAppUpdateError(error);
  }
};

export const canInstallPackages = async (): Promise<boolean> => {
  const nativeModule = getNativeModule();
  if (nativeModule === null) return false;
  try {
    return await nativeModule.canInstallPackages();
  } catch (error) {
    throw toAppUpdateError(error);
  }
};

export const openInstallPermissionSettings = async (): Promise<void> => {
  const nativeModule = getNativeModule();
  if (nativeModule === null) {
    throw new AppUpdateInstallError(
      'UPDATE_UNSUPPORTED',
      'This platform has no install permission settings',
    );
  }
  try {
    await nativeModule.openInstallPermissionSettings();
  } catch (error) {
    throw toAppUpdateError(error);
  }
};

export const cancelUpdateDownload = async (): Promise<void> => {
  const nativeModule = getNativeModule();
  if (nativeModule === null) return;
  try {
    await nativeModule.cancelDownload();
  } catch {
    // Cancelling is best-effort: the caller has already stopped tracking the
    // run, and a failure here cannot change the user-visible outcome.
  }
};

const ERROR_MESSAGES: Record<AppUpdateErrorCode, string> = {
  UPDATE_UNSUPPORTED: '当前平台不支持应用内更新。',
  UPDATE_BAD_ARGUMENT: '更新信息异常，请稍后重试。',
  UPDATE_ALREADY_DOWNLOADING: '已有下载在进行中。',
  UPDATE_DOWNLOAD_HTTP: '下载失败，请检查网络后重试。',
  UPDATE_DOWNLOAD_IO: '下载中断，请检查存储空间与网络后重试。',
  UPDATE_DIGEST_MISMATCH: '安装包校验未通过，已丢弃该文件，请重新下载。',
  UPDATE_CANCELLED: '已取消下载。',
  UPDATE_FILE_MISSING: '安装包已不存在，请重新下载。',
  UPDATE_FILE_OUTSIDE_CACHE: '安装包位置异常，请重新下载。',
  UPDATE_PERMISSION_REQUIRED: '需要允许 Mira「安装未知应用」才能完成更新。',
  UPDATE_INSTALL_FAILED: '无法启动系统安装，请稍后重试。',
};

export const updateInstallErrorMessage = (error: unknown): string => {
  const code = updateErrorCode(error);
  if (code && code in ERROR_MESSAGES) {
    return ERROR_MESSAGES[code];
  }
  return '更新失败，请稍后重试。';
};
