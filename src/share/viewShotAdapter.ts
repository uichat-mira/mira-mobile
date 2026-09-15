export interface ViewShotCaptureOptions {
  format: 'png' | 'jpg' | 'webm';
  quality?: number;
  result: 'tmpfile' | 'base64' | 'data-uri' | 'zip-base64';
  fileName?: string;
}

type ViewShotRuntime = {
  captureRef: (target: unknown, options: ViewShotCaptureOptions) => Promise<string>;
};

// react-native-view-shot 5.x exposes TypeScript source files through its package
// entry. Mira's strict noUnused* checks would otherwise typecheck dependency
// internals, while Jest would eagerly parse that source during App imports.
// Keep the package behind a lazy runtime boundary instead of weakening either
// repository TypeScript rules or Jest's node_modules transform policy.
export const captureRef: ViewShotRuntime['captureRef'] = (target, options) => {
  const viewShotRuntime = require('react-native-view-shot') as ViewShotRuntime;
  return viewShotRuntime.captureRef(target, options);
};
