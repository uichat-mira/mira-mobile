import { compareSemver, parseSemver, type SemverVersion } from './semver';

export type ReleaseChannel = 'predev' | 'dev' | 'test' | 'prod';

export interface AppRelease {
  version: SemverVersion;
  displayVersion: string;
  notes: string | null;
  /** Canonical same-channel R2 URL of the signed Release APK. */
  apkUrl: string;
  sha256: string;
}

interface R2ReleaseManifestPayload {
  version?: unknown;
  channel?: unknown;
  displayVersion?: unknown;
  apk?: unknown;
  sha256?: unknown;
  notes?: unknown;
}

const R2_PUBLIC_BASE_URL = 'https://assets.tomz.io';
const RELEASED_APK_NAME = 'uichat-mira-mobile-release.apk';

const channelRootUrl = (channel: ReleaseChannel): string =>
  `${R2_PUBLIC_BASE_URL}/mira/mobile/${channel}/`;

export const manifestUrlForChannel = (channel: ReleaseChannel): string =>
  `${channelRootUrl(channel)}latest/latest.json`;

const expectedApkPath = (version: string): string =>
  `releases/${version}/${RELEASED_APK_NAME}`;

const expectedDisplayVersion = (
  channel: ReleaseChannel,
  version: string,
): string => (channel === 'prod' ? version : `${version}-${channel}`);

const parseR2Manifest = (
  channel: ReleaseChannel,
  payload: unknown,
): AppRelease => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('R2 更新清单格式异常');
  }

  const manifest = payload as R2ReleaseManifestPayload;
  if (manifest.channel !== channel) {
    throw new Error('R2 更新清单渠道不匹配');
  }
  if (typeof manifest.version !== 'string') {
    throw new Error('R2 更新清单版本无效');
  }

  const version = parseSemver(manifest.version);
  if (!version) {
    throw new Error('R2 更新清单版本无效');
  }

  if (
    typeof manifest.displayVersion !== 'string' ||
    manifest.displayVersion !== expectedDisplayVersion(channel, manifest.version)
  ) {
    throw new Error('R2 更新清单展示版本无效');
  }

  const canonicalApkPath = expectedApkPath(manifest.version);
  if (typeof manifest.apk !== 'string' || manifest.apk !== canonicalApkPath) {
    throw new Error('R2 更新清单 APK 路径无效');
  }

  if (
    typeof manifest.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(manifest.sha256)
  ) {
    throw new Error('R2 更新清单 SHA-256 无效');
  }

  if (manifest.notes != null && typeof manifest.notes !== 'string') {
    throw new Error('R2 更新清单说明无效');
  }

  return {
    version,
    displayVersion: manifest.displayVersion,
    notes: typeof manifest.notes === 'string' ? manifest.notes : null,
    apkUrl: `${channelRootUrl(channel)}${canonicalApkPath}`,
    sha256: manifest.sha256.toLowerCase(),
  };
};

export type ReleaseFetcher = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export const fetchLatestRelease = async (
  channel: ReleaseChannel,
  fetchImpl: ReleaseFetcher,
): Promise<AppRelease> => {
  const response = await fetchImpl(manifestUrlForChannel(channel), {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`R2 更新清单请求失败（HTTP ${response.status}）`);
  }
  return parseR2Manifest(channel, await response.json());
};

export const isUpdateAvailable = (
  currentVersion: SemverVersion,
  latest: AppRelease | null,
): boolean => Boolean(latest && compareSemver(latest.version, currentVersion) > 0);
