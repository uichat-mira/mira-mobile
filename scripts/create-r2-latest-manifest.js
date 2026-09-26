const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { RELEASE_CHANNELS } = require('./resolve-release-channel');

const RELEASED_APK_NAME = 'uichat-mira-mobile-release.apk';
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

const assertChannel = channel => {
  if (!RELEASE_CHANNELS.includes(channel)) {
    throw new Error(`Unsupported release channel: ${channel}`);
  }
};

const assertVersion = version => {
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new Error(`Invalid package version: ${version}`);
  }
};

const resolveRepositoryAssetDirectory = assetDir => {
  if (typeof assetDir !== 'string' || !assetDir.trim()) {
    throw new Error('Release asset directory must be a non-empty relative path');
  }
  const candidate = assetDir.trim();
  if (path.isAbsolute(candidate)) {
    throw new Error('Release asset directory must stay inside the repository');
  }

  const repositoryRoot = path.resolve(process.cwd());
  const resolved = path.resolve(repositoryRoot, candidate);
  const relative = path.relative(repositoryRoot, resolved);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('Release asset directory must stay inside the repository');
  }
  return resolved;
};

const displayVersionForChannel = (version, channel) => {
  assertVersion(version);
  assertChannel(channel);
  return channel === 'prod' ? version : `${version}-${channel}`;
};

const r2ChannelRootFor = channel => {
  assertChannel(channel);
  return `mira/mobile/${channel}`;
};

const r2LatestPrefixFor = channel => `${r2ChannelRootFor(channel)}/latest`;

const r2ReleasePrefixFor = (channel, version) => {
  assertVersion(version);
  return `${r2ChannelRootFor(channel)}/releases/${version}`;
};

const releaseApkPathFor = (channel, version) => {
  assertChannel(channel);
  assertVersion(version);
  return `releases/${version}/${RELEASED_APK_NAME}`;
};

const parseSha256File = text => {
  if (typeof text !== 'string') throw new Error('Invalid SHA-256 file');
  const [digest] = text.trim().split(/\s+/);
  if (!SHA256_PATTERN.test(digest ?? '')) {
    throw new Error('Invalid APK SHA-256 digest');
  }
  return digest.toLowerCase();
};

const createLatestManifest = ({ version, channel, sha256, commit = null }) => {
  assertVersion(version);
  assertChannel(channel);
  if (!SHA256_PATTERN.test(sha256 ?? '')) {
    throw new Error('Invalid APK SHA-256 digest');
  }

  return {
    version,
    channel,
    displayVersion: displayVersionForChannel(version, channel),
    apk: releaseApkPathFor(channel, version),
    sha256: sha256.toLowerCase(),
    ...(commit ? { commit } : {}),
  };
};

const writeManifestFromBuild = ({
  assetDir = 'release-assets',
  channel = process.env.MIRA_RELEASE_CHANNEL,
  commit = process.env.GITHUB_SHA || null,
} = {}) => {
  assertChannel(channel);
  const packageJson = JSON.parse(
    readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
  );
  const version = packageJson.version;
  assertVersion(version);
  const assetRoot = resolveRepositoryAssetDirectory(assetDir);

  const checksumPath = path.join(
    assetRoot,
    `${RELEASED_APK_NAME}.sha256`,
  );
  const sha256 = parseSha256File(readFileSync(checksumPath, 'utf8'));
  const manifest = createLatestManifest({ version, channel, sha256, commit });
  const outputPath = path.join(assetRoot, 'latest.json');
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { manifest, outputPath };
};

if (require.main === module) {
  const assetDir = process.argv[2] || 'release-assets';
  const { manifest, outputPath } = writeManifestFromBuild({ assetDir });
  process.stdout.write(
    `Wrote ${outputPath}: ${manifest.displayVersion} (${manifest.channel})\n`,
  );
}

module.exports = {
  RELEASED_APK_NAME,
  createLatestManifest,
  displayVersionForChannel,
  parseSha256File,
  r2ChannelRootFor,
  r2LatestPrefixFor,
  r2ReleasePrefixFor,
  releaseApkPathFor,
  resolveRepositoryAssetDirectory,
  writeManifestFromBuild,
};
