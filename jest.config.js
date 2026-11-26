module.exports = {
  preset: '@react-native/jest-preset',
  moduleNameMapper: {
    '^lucide-react-native$':
      '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
    '^marked$': '<rootDir>/node_modules/marked/lib/marked.umd.js',
    '^mira-release-channel$': '<rootDir>/src/update/channel/dev.ts',
    // Pi packages expose ESM-only "exports" without a CommonJS fallback. Jest's
    // default resolver asks for "require", so point it at the built ESM files
    // that Babel then transforms.
    '^@earendil-works/pi-agent-core$':
      '<rootDir>/node_modules/@earendil-works/pi-agent-core/dist/index.js',
    '^@earendil-works/pi-ai$':
      '<rootDir>/node_modules/@earendil-works/pi-ai/dist/index.js',
    '^@earendil-works/pi-schema$':
      '<rootDir>/node_modules/@earendil-works/pi-schema/dist/index.js',
    '^@earendil-works/pi-schema/formats$':
      '<rootDir>/node_modules/@earendil-works/pi-schema/dist/formats/index.js',
    '^@earendil-works/pi-telemetry$':
      '<rootDir>/node_modules/@earendil-works/pi-telemetry/dist/index.js',
  },
  // Pi Core ships ESM-only dist files; let Babel transform that package tree.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@earendil-works)/)',
  ],
};
