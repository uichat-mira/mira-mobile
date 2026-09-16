const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { resolveReleaseChannel } = require('../../scripts/resolve-release-channel');
const {
  createLatestManifest,
  displayVersionForChannel,
  r2LatestPrefixFor,
  r2ReleasePrefixFor,
} = require('../../scripts/create-r2-latest-manifest');

const readSource = path => readFileSync(resolve(process.cwd(), path), 'utf8');
const SHA256 = 'a'.repeat(64);

describe('MOB-028A release truth', () => {
  it('keeps predev, dev, test and prod isolated by branch truth', () => {
    for (const channel of ['predev', 'dev', 'test', 'prod']) {
      expect(resolveReleaseChannel({ env: {}, branchName: channel })).toBe(channel);
      expect(
        resolveReleaseChannel({
          env: {
            MIRA_RELEASE_CHANNEL: 'dev',
            GITHUB_REF_NAME: channel,
          },
          branchName: '',
        }),
      ).toBe(channel);
    }
  });

  it('keeps PR base truth authoritative over stale workflow env', () => {
    expect(
      resolveReleaseChannel({
        env: { MIRA_RELEASE_CHANNEL: 'dev', GITHUB_BASE_REF: 'prod' },
        branchName: '',
      }),
    ).toBe('prod');
    expect(
      resolveReleaseChannel({
        env: { MIRA_RELEASE_CHANNEL: 'dev', GITHUB_BASE_REF: 'test' },
        branchName: '',
      }),
    ).toBe('test');
  });

  it('supports a locked CI channel for detached release checkouts', () => {
    expect(
      resolveReleaseChannel({
        env: {
          MIRA_RELEASE_CHANNEL: 'test',
          MIRA_RELEASE_CHANNEL_LOCKED: 'true',
          GITHUB_REF_NAME: 'dev',
        },
        branchName: '',
      }),
    ).toBe('test');
    expect(() =>
      resolveReleaseChannel({
        env: { MIRA_RELEASE_CHANNEL_LOCKED: 'true' },
        branchName: '',
      }),
    ).toThrow('requires MIRA_RELEASE_CHANNEL');
  });

  it('keeps unknown local branches non-publishable by convention and rejects invalid explicit channels', () => {
    expect(resolveReleaseChannel({ env: {}, branchName: 'feature/mob-028a' })).toBe('dev');
    expect(() =>
      resolveReleaseChannel({
        env: { MIRA_RELEASE_CHANNEL: 'preview' },
        branchName: 'feature/mob-028a',
      }),
    ).toThrow('Invalid MIRA_RELEASE_CHANNEL');
  });

  it('declares predev as predev in the canonical predev workflow', () => {
    const workflow = readSource('.github/workflows/predev-ci.yml');
    expect(workflow).toContain('MIRA_RELEASE_CHANNEL: predev');
    expect(workflow).not.toContain('MIRA_RELEASE_CHANNEL: dev\n');
  });

  it('binds canonical release artifacts to both branch and commit', () => {
    const workflow = readSource('.github/workflows/r2-release-truth.yml');
    expect(workflow).toContain('-f branch="$RELEASE_CHANNEL"');
    expect(workflow).toContain('-f head_sha="$GITHUB_SHA"');
    expect(workflow).toContain('source_branch=$(printf');
    expect(workflow).toContain('source_sha=$(printf');
    expect(workflow).toContain('source_path=$(printf');
    expect(workflow).toContain('[ "$source_branch" != "$RELEASE_CHANNEL" ]');
    expect(workflow).toContain('[ "$source_sha" != "$GITHUB_SHA" ]');
  });

  it('creates branch-qualified display versions and isolated R2 prefixes', () => {
    expect(displayVersionForChannel('0.2.11', 'predev')).toBe('0.2.11-predev');
    expect(displayVersionForChannel('0.2.11', 'dev')).toBe('0.2.11-dev');
    expect(displayVersionForChannel('0.2.11', 'test')).toBe('0.2.11-test');
    expect(displayVersionForChannel('0.2.11', 'prod')).toBe('0.2.11');

    expect(r2LatestPrefixFor('test')).toBe('mira/mobile/test/latest');
    expect(r2ReleasePrefixFor('dev', '0.2.11')).toBe(
      'mira/mobile/dev/releases/0.2.11',
    );
  });

  it('shows the installed channel-qualified version in About', () => {
    const about = readSource('src/screens/AboutScreen.tsx');
    expect(about).toContain("releaseChannel === 'prod' ? version : `${version}-${releaseChannel}`");
    expect(about).toContain("predev: '预开发'");
    expect(about).toContain("test: '测试'");
    expect(about).toContain('installedDisplayVersion');
  });

  it('points latest metadata to an immutable same-channel versioned APK', () => {
    expect(
      createLatestManifest({
        version: '0.2.11',
        channel: 'dev',
        sha256: SHA256,
        commit: 'abc123',
      }),
    ).toEqual({
      version: '0.2.11',
      channel: 'dev',
      displayVersion: '0.2.11-dev',
      apk: 'releases/0.2.11/uichat-mira-mobile-release.apk',
      sha256: SHA256,
      commit: 'abc123',
    });
  });

  it('rejects different bytes for an already published branch+version', () => {
    const publisher = readSource('scripts/publish-r2-release-truth.sh');
    expect(publisher).toContain('verify_existing_version');
    expect(publisher).toContain('remote_apk_digest=$(aws s3 cp');
    expect(publisher).toContain('| sha256sum');
    expect(publisher).toContain('[ "$local_digest" != "$remote_apk_digest" ]');
    expect(publisher).toContain('Version collision for ${channel}/${version}');
    expect(publisher).toContain('Bump package.json.version before publishing');
    expect(publisher).toContain('Incomplete immutable R2 release already exists');
  });

  it('fails closed when immutable R2 object state cannot be determined', () => {
    const publisher = readSource('scripts/publish-r2-release-truth.sh');
    expect(publisher).toContain('(404|Not Found|NoSuchKey)');
    expect(publisher).toContain('Unable to determine R2 object state');
    expect(publisher).toContain('if [ "$state" -ne 1 ]; then exit 1; fi');
  });

  it('publishes latest.json only after immutable assets and latest mirrors are verified', () => {
    const publisher = readSource('scripts/publish-r2-release-truth.sh');
    const immutableVerifyIndex = publisher.indexOf('verify_existing_version');
    const mirrorVerifyIndex = publisher.indexOf('if upload_latest_mirrors && verify_latest_mirrors');
    const manifestUploadIndex = publisher.indexOf('aws s3 cp "$manifest"');

    expect(publisher).toContain('releases/${version}');
    expect(publisher).toContain("--cache-control 'public, max-age=31536000, immutable'");
    expect(immutableVerifyIndex).toBeGreaterThan(-1);
    expect(mirrorVerifyIndex).toBeGreaterThan(immutableVerifyIndex);
    expect(manifestUploadIndex).toBeGreaterThan(mirrorVerifyIndex);
  });

  it('does not ship an unused empty iOS location permission description', () => {
    const plist = readSource('ios/UIChatMira/Info.plist');

    expect(plist).not.toContain('NSLocationWhenInUseUsageDescription');
  });

  it('keeps the iOS installed marketing version aligned with package.json', () => {
    const packageVersion = JSON.parse(readSource('package.json')).version;
    const plist = readSource('ios/UIChatMira/Info.plist');
    const match = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist);

    expect(match).not.toBeNull();
    expect(match[1]).toBe(packageVersion);
  });
});
