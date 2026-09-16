import { NativeModules } from 'react-native';

export interface ProviderCredentialStore {
  isAvailable(): boolean;
  load(providerId: string): Promise<string | null>;
  save(providerId: string, apiKey: string): Promise<void>;
  clear(providerId: string): Promise<void>;
}

interface NativeSecureCredentialModule {
  get(service: string): Promise<string | null>;
  set(service: string, value: string): Promise<void>;
  remove(service: string): Promise<void>;
}

const SERVICE_PREFIX = 'io.tomz.mira.mobile.local-provider.';

const getNativeModule = (): NativeSecureCredentialModule | null => {
  const module = NativeModules.MiraSecureCredentialStore as NativeSecureCredentialModule | undefined;
  if (
    !module ||
    typeof module.get !== 'function' ||
    typeof module.set !== 'function' ||
    typeof module.remove !== 'function'
  ) {
    return null;
  }
  return module;
};

const serviceFor = (providerId: string): string => {
  const normalized = providerId.trim();
  if (!normalized || !/^[a-zA-Z0-9._-]+$/u.test(normalized)) {
    throw new Error('Provider id contains unsupported characters');
  }
  return `${SERVICE_PREFIX}${normalized}`;
};

export class NativeProviderCredentialStore implements ProviderCredentialStore {
  isAvailable() {
    return getNativeModule() !== null;
  }

  async load(providerId: string): Promise<string | null> {
    const module = getNativeModule();
    if (!module) throw new Error('Secure credential storage is not installed in this build');
    return module.get(serviceFor(providerId));
  }

  async save(providerId: string, apiKey: string): Promise<void> {
    const module = getNativeModule();
    if (!module) throw new Error('Secure credential storage is not installed in this build');
    const value = apiKey.trim();
    if (!value) throw new Error('Provider API key cannot be empty');
    await module.set(serviceFor(providerId), value);
  }

  async clear(providerId: string): Promise<void> {
    const module = getNativeModule();
    if (!module) throw new Error('Secure credential storage is not installed in this build');
    await module.remove(serviceFor(providerId));
  }
}

export class MemoryProviderCredentialStore implements ProviderCredentialStore {
  private readonly values = new Map<string, string>();

  isAvailable() {
    return true;
  }

  async load(providerId: string) {
    return this.values.get(serviceFor(providerId)) ?? null;
  }

  async save(providerId: string, apiKey: string) {
    const value = apiKey.trim();
    if (!value) throw new Error('Provider API key cannot be empty');
    this.values.set(serviceFor(providerId), value);
  }

  async clear(providerId: string) {
    this.values.delete(serviceFor(providerId));
  }
}

export const providerCredentialStore = new NativeProviderCredentialStore();
