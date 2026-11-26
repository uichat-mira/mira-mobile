import { NativeModules } from 'react-native';
import type { RemoteDeviceScope } from '../protocol/remoteHostV1';

export interface StoredDeviceCredential {
  hostUrl: string;
  credential: string;
  deviceId: string;
  scopes: RemoteDeviceScope[];
  savedAt: string;
}

export interface DeviceCredentialStore {
  isAvailable(): boolean;
  load(): Promise<StoredDeviceCredential | null>;
  save(value: StoredDeviceCredential): Promise<void>;
  clear(): Promise<void>;
}

interface NativeSecureCredentialModule {
  get(service: string): Promise<string | null>;
  set(service: string, value: string): Promise<void>;
  remove(service: string): Promise<void>;
}

const SERVICE_NAME = 'io.tomz.mira.mobile.remote-device';

const getNativeModule = (): NativeSecureCredentialModule | null => {
  const module = NativeModules.MiraSecureCredentialStore as
    | NativeSecureCredentialModule
    | undefined;

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

const parseStoredCredential = (value: string): StoredDeviceCredential | null => {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Stored Mira device credential is invalid');
  }

  const record = parsed as Record<string, unknown>;
  const hostUrl = typeof record.hostUrl === 'string' ? record.hostUrl.trim() : '';
  // Relay-only records have no usable Direct connection after retirement.
  if (!hostUrl) return null;

  if (
    typeof record.credential !== 'string' ||
    typeof record.deviceId !== 'string' ||
    typeof record.savedAt !== 'string' ||
    !Array.isArray(record.scopes) ||
    !record.scopes.every((scope) => typeof scope === 'string')
  ) {
    throw new Error('Stored Mira device credential is incomplete');
  }
  return {
    hostUrl,
    credential: record.credential,
    deviceId: record.deviceId,
    scopes: record.scopes as RemoteDeviceScope[],
    savedAt: record.savedAt,
  };
};

export class NativeDeviceCredentialStore implements DeviceCredentialStore {
  private pending: Promise<void> = Promise.resolve();

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  isAvailable() {
    return getNativeModule() !== null;
  }

  async load(): Promise<StoredDeviceCredential | null> {
    return this.serialize(async () => {
      const module = getNativeModule();
      if (!module) {
        throw new Error('Secure credential storage is not installed in this build');
      }

      const value = await module.get(SERVICE_NAME);
      if (!value) return null;
      const credential = parseStoredCredential(value);
      if (!credential) {
        await module.remove(SERVICE_NAME);
        return null;
      }
      // Strip the retired token from secure storage, not only from memory.
      const canonical = JSON.stringify(credential);
      if (canonical !== value) await module.set(SERVICE_NAME, canonical);
      return credential;
    });
  }

  async save(value: StoredDeviceCredential): Promise<void> {
    return this.serialize(async () => {
      const module = getNativeModule();
      if (!module) {
        throw new Error('Secure credential storage is not installed in this build');
      }
      await module.set(SERVICE_NAME, JSON.stringify({
        hostUrl: value.hostUrl,
        credential: value.credential,
        deviceId: value.deviceId,
        scopes: value.scopes,
        savedAt: value.savedAt,
      }));
    });
  }

  async clear(): Promise<void> {
    return this.serialize(async () => {
      const module = getNativeModule();
      if (!module) {
        throw new Error('Secure credential storage is not installed in this build');
      }
      await module.remove(SERVICE_NAME);
    });
  }
}

export class MemoryDeviceCredentialStore implements DeviceCredentialStore {
  private value: StoredDeviceCredential | null = null;

  isAvailable() {
    return true;
  }

  async load() {
    return this.value;
  }

  async save(value: StoredDeviceCredential) {
    this.value = {
      hostUrl: value.hostUrl,
      credential: value.credential,
      deviceId: value.deviceId,
      scopes: [...value.scopes],
      savedAt: value.savedAt,
    };
  }

  async clear() {
    this.value = null;
  }
}

export const deviceCredentialStore = new NativeDeviceCredentialStore();
