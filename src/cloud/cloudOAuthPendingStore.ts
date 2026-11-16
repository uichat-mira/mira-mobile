import {
  getNativeSecureCredentialModule,
  type SecureCredentialModule,
} from './secureStorage';

const PENDING_SERVICE = 'io.tomz.mira.mobile.cloud-oauth-pending.v1';

export interface PendingOAuthTransaction {
  schemaVersion: 1;
  state: string;
  codeVerifier: string;
  createdAt: string;
}

export interface CloudOAuthPendingStore {
  load(): Promise<PendingOAuthTransaction | null>;
  save(value: PendingOAuthTransaction): Promise<void>;
  clear(): Promise<void>;
}

export class CloudOAuthPendingStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudOAuthPendingStoreError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const parsePendingOAuthTransaction = (
  value: string,
): PendingOAuthTransaction => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new CloudOAuthPendingStoreError(
      'Stored Mira Cloud OAuth transaction is invalid',
    );
  }

  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== 1 ||
    typeof parsed.state !== 'string' ||
    typeof parsed.codeVerifier !== 'string' ||
    typeof parsed.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(parsed.createdAt))
  ) {
    throw new CloudOAuthPendingStoreError(
      'Stored Mira Cloud OAuth transaction is incomplete',
    );
  }

  return {
    schemaVersion: 1,
    state: parsed.state,
    codeVerifier: parsed.codeVerifier,
    createdAt: new Date(parsed.createdAt).toISOString(),
  };
};

const requireModule = (): SecureCredentialModule => {
  const module = getNativeSecureCredentialModule();
  if (!module) {
    throw new CloudOAuthPendingStoreError(
      'Secure credential storage is not installed in this build',
    );
  }
  return module;
};

export class NativeCloudOAuthPendingStore implements CloudOAuthPendingStore {
  async load(): Promise<PendingOAuthTransaction | null> {
    const value = await requireModule().get(PENDING_SERVICE);
    return value ? parsePendingOAuthTransaction(value) : null;
  }

  async save(value: PendingOAuthTransaction): Promise<void> {
    await requireModule().set(PENDING_SERVICE, JSON.stringify(value));
  }

  async clear(): Promise<void> {
    await requireModule().remove(PENDING_SERVICE);
  }
}

export class MemoryCloudOAuthPendingStore implements CloudOAuthPendingStore {
  private value: PendingOAuthTransaction | null = null;

  async load() {
    return this.value ? { ...this.value } : null;
  }

  async save(value: PendingOAuthTransaction) {
    this.value = { ...value };
  }

  async clear() {
    this.value = null;
  }

  peek() {
    return this.value;
  }
}
