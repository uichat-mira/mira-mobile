import { Platform } from 'react-native';
import { version } from '../../package.json';
import type { NativeDeviceMetadata } from './cloudAuthApi';

// Public device model, not a hardware identifier or a user-customized name.
// iOS exposes only its device class here; we must not invent a specific model.
export function getCloudDeviceMetadata(): NativeDeviceMetadata {
  const constants = Platform.constants as Record<string, unknown>;
  const read = (key: string): string | undefined => {
    const value = constants?.[key];
    return typeof value === 'string' && value.trim()
      ? value.trim().slice(0, 64)
      : undefined;
  };
  const android = Platform.OS === 'android';
  const brand = android ? read('Brand') : undefined;
  const model = android ? read('Model') : undefined;
  const deviceName = android
    ? model
      ? brand && !model.toLowerCase().startsWith(brand.toLowerCase())
        ? `${brand} ${model}`
        : model
      : undefined
    : Platform.OS === 'ios'
      ? (read('interfaceIdiom') === 'pad' ? 'iPad' : 'iPhone')
      : undefined;
  const osVersion = android
    ? read('Release')
    : typeof Platform.Version === 'string'
      ? Platform.Version
      : undefined;
  return {
    clientName: 'Mira Mobile',
    clientVersion: version,
    osName: android ? 'Android' : 'iOS',
    ...(osVersion ? { osVersion } : {}),
    ...(deviceName ? { deviceName: deviceName.slice(0, 80) } : {}),
  };
}
