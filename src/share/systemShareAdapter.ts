import { NativeModules, Platform, Share } from 'react-native';

interface AndroidImageShareModule {
  shareImage: (fileUri: string, title: string) => Promise<void>;
}

export interface SystemShareDependencies {
  platform?: string;
  iosShare?: (content: { url: string; title?: string }) => Promise<unknown>;
  androidShare?: (fileUri: string, title: string) => Promise<void>;
}

export const normalizeLocalFileUri = (uri: string): string => {
  const normalized = uri.trim();
  if (!normalized) throw new Error('Share image URI is empty');
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(normalized)) return normalized;
  return `file://${normalized}`;
};

/**
 * Open the native platform share sheet for a PNG created by ShareCardCapture.
 * iOS core Share supports file URLs; Android delegates to the small native
 * bridge so the private tmpfile is exposed through FileProvider, never as a
 * raw file:// URI to another app.
 */
export async function sharePngFile(
  uri: string,
  title: string,
  dependencies: SystemShareDependencies = {},
): Promise<void> {
  const fileUri = normalizeLocalFileUri(uri);
  const platform = dependencies.platform ?? Platform.OS;

  if (platform === 'ios') {
    const iosShare = dependencies.iosShare ?? ((content) => Share.share(content));
    await iosShare({ url: fileUri, title });
    return;
  }

  if (platform === 'android') {
    const nativeModule = NativeModules.MiraImageShare as
      | AndroidImageShareModule
      | undefined;
    const androidShare = dependencies.androidShare ?? nativeModule?.shareImage?.bind(nativeModule);
    if (!androidShare) {
      throw new Error('Android image share bridge is unavailable');
    }
    await androidShare(fileUri, title);
    return;
  }

  throw new Error(`Conversation image sharing is unsupported on ${platform}`);
}
