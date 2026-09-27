import {
  fetchLatestRelease,
  isUpdateAvailable,
  manifestUrlForChannel,
  type AppRelease,
} from './appUpdate';
import { parseSemver } from './semver';

const SHA256 = 'a'.repeat(64);

const manifest = (
  channel: 'predev' | 'dev' | 'test' | 'prod',
  version = '0.2.10',
) => ({
  version,
  channel,
  displayVersion: channel === 'prod' ? version : `${version}-${channel}`,
  apk: `releases/${version}/uichat-mira-mobile-release.apk`,
  sha256: SHA256,
});

const release = (version: string): AppRelease => ({
  version: parseSemver(version)!,
  displayVersion: `${version}-dev`,
  notes: null,
  apkUrl: `https://assets.tomz.io/mira/mobile/dev/releases/${version}/uichat-mira-mobile-release.apk`,
  sha256: SHA256,
});

const jsonResponse = (payload: unknown) =>
  ({ ok: true, status: 200, json: async () => payload }) as Response;

describe('manifestUrlForChannel', () => {
  it.each(['predev', 'dev', 'test', 'prod'] as const)(
    'maps %s to only its own R2 manifest',
    (channel) => {
      expect(manifestUrlForChannel(channel)).toBe(
        `https://assets.tomz.io/mira/mobile/${channel}/latest/latest.json`,
      );
    },
  );
});

describe('fetchLatestRelease', () => {
  it.each(['predev', 'dev', 'test', 'prod'] as const)(
    'requests only the %s channel manifest',
    async (channel) => {
      let requestedUrl = '';
      const fetchImpl = async (url: string) => {
        requestedUrl = url;
        return jsonResponse(manifest(channel));
      };

      const result = await fetchLatestRelease(channel, fetchImpl);

      expect(requestedUrl).toBe(manifestUrlForChannel(channel));
      expect(result.displayVersion).toBe(
        channel === 'prod' ? '0.2.10' : `0.2.10-${channel}`,
      );
    },
  );

  it('builds the Android download URL from the same channel versioned object', async () => {
    const result = await fetchLatestRelease('dev', async () =>
      jsonResponse(manifest('dev')),
    );

    expect(result.apkUrl).toBe(
      'https://assets.tomz.io/mira/mobile/dev/releases/0.2.10/uichat-mira-mobile-release.apk',
    );
    expect(result.sha256).toBe(SHA256);
  });

  it('rejects a manifest from a different channel', async () => {
    await expect(
      fetchLatestRelease('dev', async () => jsonResponse(manifest('prod'))),
    ).rejects.toThrow('渠道不匹配');
  });

  it('throws on HTTP failure instead of reporting up to date', async () => {
    await expect(
      fetchLatestRelease('dev', async () =>
        ({ ok: false, status: 503 }) as Response,
      ),
    ).rejects.toThrow('HTTP 503');
  });

  it('preserves network failures as retryable failures', async () => {
    await expect(
      fetchLatestRelease('dev', async () => {
        throw new Error('network unreachable');
      }),
    ).rejects.toThrow('network unreachable');
  });

  it('rejects a non-object manifest', async () => {
    await expect(
      fetchLatestRelease('dev', async () => jsonResponse([])),
    ).rejects.toThrow('格式异常');
  });

  it('rejects an invalid semantic version', async () => {
    await expect(
      fetchLatestRelease('dev', async () =>
        jsonResponse({ ...manifest('dev'), version: '0.2' }),
      ),
    ).rejects.toThrow('版本无效');
  });

  it('rejects a display version inconsistent with build truth', async () => {
    await expect(
      fetchLatestRelease('test', async () =>
        jsonResponse({ ...manifest('test'), displayVersion: '0.2.10-dev' }),
      ),
    ).rejects.toThrow('展示版本无效');
  });

  it('rejects a missing APK path', async () => {
    await expect(
      fetchLatestRelease('dev', async () =>
        jsonResponse({ ...manifest('dev'), apk: undefined }),
      ),
    ).rejects.toThrow('APK 路径无效');
  });

  it.each([
    'https://evil.example/app.apk',
    '../prod/releases/0.2.10/uichat-mira-mobile-release.apk',
    'releases/0.2.9/uichat-mira-mobile-release.apk',
    'releases/0.2.10/other.apk',
    'latest/uichat-mira-mobile-release.apk',
    'prod/releases/0.2.10/uichat-mira-mobile-release.apk',
  ])('rejects unsafe or non-canonical APK path %s', async (apk) => {
    await expect(
      fetchLatestRelease('dev', async () =>
        jsonResponse({ ...manifest('dev'), apk }),
      ),
    ).rejects.toThrow('APK 路径无效');
  });

  it('rejects an invalid SHA-256', async () => {
    await expect(
      fetchLatestRelease('dev', async () =>
        jsonResponse({ ...manifest('dev'), sha256: 'not-a-sha' }),
      ),
    ).rejects.toThrow('SHA-256 无效');
  });

  it('does not contact GitHub Releases', async () => {
    let calls = 0;
    const fetchImpl = async (url: string) => {
      calls += 1;
      expect(url).not.toContain('api.github.com');
      expect(url).not.toContain('/releases');
      return jsonResponse(manifest('dev'));
    };

    await fetchLatestRelease('dev', fetchImpl);
    expect(calls).toBe(1);
  });
});

describe('isUpdateAvailable', () => {
  it('detects 0.2.10 as newer than 0.2.9', () => {
    expect(isUpdateAvailable(parseSemver('0.2.9')!, release('0.2.10'))).toBe(true);
  });

  it('treats equal versions as current', () => {
    expect(isUpdateAvailable(parseSemver('0.2.10')!, release('0.2.10'))).toBe(false);
  });

  it('treats a newer local version as current', () => {
    expect(isUpdateAvailable(parseSemver('0.3.0')!, release('0.2.10'))).toBe(false);
  });

  it('treats an absent release as unknown rather than an available update', () => {
    expect(isUpdateAvailable(parseSemver('0.2.10')!, null)).toBe(false);
  });
});
