import { NativeModules } from 'react-native';

export interface SecureCredentialModule {
  get(service: string): Promise<string | null>;
  set(service: string, value: string): Promise<void>;
  remove(service: string): Promise<void>;
}

export interface SecureRandomModule extends SecureCredentialModule {
  randomBytes(length: number): Promise<string>;
}

const hasCredentialMethods = (
  module: unknown,
): module is SecureCredentialModule => {
  if (!module || typeof module !== 'object') return false;
  const candidate = module as Record<string, unknown>;
  return (
    typeof candidate.get === 'function' &&
    typeof candidate.set === 'function' &&
    typeof candidate.remove === 'function'
  );
};

export const getNativeSecureCredentialModule =
  (): SecureCredentialModule | null => {
    const module = NativeModules.MiraSecureCredentialStore as unknown;
    return hasCredentialMethods(module) ? module : null;
  };

export const requireNativeSecureCredentialModule =
  (): SecureCredentialModule => {
    const module = getNativeSecureCredentialModule();
    if (!module) {
      throw new Error(
        'Secure credential storage is not installed in this build',
      );
    }
    return module;
  };

export const requireNativeSecureRandom = (): SecureRandomModule => {
  const module = getNativeSecureCredentialModule() as
    | (SecureCredentialModule & { randomBytes?: unknown })
    | null;
  if (!module || typeof module.randomBytes !== 'function') {
    throw new Error('Secure random generation is unavailable in this build');
  }
  return module as SecureRandomModule;
};
