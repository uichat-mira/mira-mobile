module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // linkedom's HTML parser is published as an ES module under Metro's
  // package-export resolution and uses `export * as`, which the React Native
  // preset does not rewrite by itself.
  plugins: ['@babel/plugin-transform-export-namespace-from'],
};
