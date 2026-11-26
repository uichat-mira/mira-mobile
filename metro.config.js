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
const piAuthContextFile = path.resolve(
  __dirname,
  'node_modules',
  '@earendil-works',
  'pi-ai',
  'dist',
  'auth',
  'context.js',
);
const piAuthContextShimFile = path.resolve(
  __dirname,
  'src',
  'runtime',
  'piAiAuthContextShim.ts',
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
      const resolution = context.resolveRequest(context, moduleName, platform);
      // Pi's default auth context uses a variable-specifier dynamic import for
      // node:fs, which Metro cannot transform. Mira owns Local Provider auth,
      // so the Pi provider-auth default is replaced by its browser-safe shape.
      if (
        resolution?.type === 'sourceFile' &&
        resolution.filePath === piAuthContextFile
      ) {
        return { type: 'sourceFile', filePath: piAuthContextShimFile };
      }
      return resolution;
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
