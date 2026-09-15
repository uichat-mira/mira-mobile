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
// internals. Keep that third-party implementation behind this narrow runtime
// boundary rather than weakening the repository TypeScript rules.
const viewShotRuntime = require('react-native-view-shot') as ViewShotRuntime;

export const captureRef = viewShotRuntime.captureRef;
