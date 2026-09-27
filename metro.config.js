const { execFileSync } = require('node:child_process');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');
const { resolveReleaseChannel } = require('./scripts/resolve-release-channel');

const currentBranch = () => {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};

/**
 * Build-time release channel truth (MOB-028A).
 *
 * predev/dev/test/prod builds resolve to their own channel modules. Branch
 * truth is authoritative for normal CI/local checkouts; detached release
 * orchestration can use an explicitly locked channel.
 */
const releaseChannel = resolveReleaseChannel({
  env: process.env,
  branchName: currentBranch(),
});
const channelModuleFilename = releaseChannel === 'test' ? 'test-channel.ts' : `${releaseChannel}.ts`;
const channelModulePath = path.resolve(
  __dirname,
  'src',
  'update',
  'channel',
  channelModuleFilename,
);

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  // Keep release bundling stable on Windows when transforming large ESM dependencies.
  maxWorkers: 1,
  resolver: {
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === 'mira-release-channel') {
        return { type: 'sourceFile', filePath: channelModulePath };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
