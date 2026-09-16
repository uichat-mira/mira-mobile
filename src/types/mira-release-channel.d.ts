// The real module is selected at bundle time:
// - Metro (metro.config.js) resolves `mira-release-channel` to the matching
//   predev/dev/test/prod source module from explicit branch/build truth.
// - Jest (jest.config.js moduleNameMapper) resolves to dev unless a test imports
//   the channel modules directly.
declare module 'mira-release-channel' {
  export type ReleaseChannelValue = 'predev' | 'dev' | 'test' | 'prod';
  export const releaseChannel: ReleaseChannelValue;
}
