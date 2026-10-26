import type { CloudAccountIdentity } from './cloudAuthApi';
import {
  getNativeSecureCredentialModule,
  type SecureCredentialModule,
} from './secureStorage';

const CLOUD_SESSION_SERVICE = 'io.tomz.mira.mobile.cloud-account.v1';

export interface StoredCloudSession {
  schemaVersion: 1;
  sessionToken: string;
  account: CloudAccountIdentity;
  expiresAt: string;
  savedAt: string;
}

export interface CloudSessionStore {
  isAvailable(): boolean;
  load(): Promise<StoredCloudSession | null>;
  save(value: StoredCloudSession): Promise<void>;
  clear(): Promise<void>;
}

export class CloudSessionStoreError extends Error {
  constructor(readonly reason: 'corrupt' | 'storage', message: string) {
    super(message);
    this.name = 'CloudSessionStoreError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const parseStoredCloudSession = (value: string): StoredCloudSession => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new CloudSessionStoreError(
      'corrupt',
      'Stored Mira Cloud session is invalid',
    );
  }

  if (!isRecord(parsed)) {
    throw new CloudSessionStoreError(
      'corrupt',
      'Stored Mira Cloud session is invalid',
    );
  }
  const account = parsed.account;
  if (
    parsed.schemaVersion !== 1 ||
    typeof parsed.sessionToken !== 'string' ||
    parsed.sessionToken.length === 0 ||
    typeof parsed.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(parsed.expiresAt)) ||
    typeof parsed.savedAt !== 'string' ||
    !Number.isFinite(Date.parse(parsed.savedAt)) ||
    !isRecord(account) ||
    typeof account.id !== 'string' ||
    account.id.length === 0 ||
    typeof account.username !== 'string' ||
    account.username.length === 0
  ) {
    throw new CloudSessionStoreError(
      'corrupt',
      'Stored Mira Cloud session is incomplete',
    );
  }

  return {
    schemaVersion: 1,
    sessionToken: parsed.sessionToken,
    account: { id: account.id, username: account.username },
    expiresAt: parsed.expiresAt,
    savedAt: parsed.savedAt,
  };
};

const requireModule = (): SecureCredentialModule => {
  const module = getNativeSecureCredentialModule();
  if (!module) {
    throw new CloudSessionStoreError(
      'storage',
      'Secure credential storage is not installed in this build',
    );
  }
  return module;
};

export class NativeCloudSessionStore implements CloudSessionStore {
  isAvailable() {
    return getNativeSecureCredentialModule() !== null;
  }

  async load(): Promise<StoredCloudSession | null> {
    const value = await requireModule().get(CLOUD_SESSION_SERVICE);
    return value ? parseStoredCloudSession(value) : null;
  }

  async save(value: StoredCloudSession): Promise<void> {
    await requireModule().set(CLOUD_SESSION_SERVICE, JSON.stringify(value));
  }

  async clear(): Promise<void> {
    await requireModule().remove(CLOUD_SESSION_SERVICE);
  }
}

export class MemoryCloudSessionStore implements CloudSessionStore {
  private value: StoredCloudSession | null = null;

  isAvailable() {
    return true;
  }

  async load() {
    return this.value
      ? {
          ...this.value,
          account: { ...this.value.account },
        }
      : null;
  }

  async save(value: StoredCloudSession) {
    this.value = JSON.parse(JSON.stringify(value)) as StoredCloudSession;
  }

  async clear() {
    this.value = null;
  }

  peek() {
    return this.value;
  }
}

export const cloudSessionStore: CloudSessionStore =
  new NativeCloudSessionStore();
