import { base64UrlToBytes, isValidUuidV4, uuidV4FromBytes } from './pkce';
import {
  getNativeSecureCredentialModule,
  requireNativeSecureRandom,
  type SecureRandomModule,
} from './secureStorage';

const CLOUD_INSTALLATION_SERVICE = 'io.tomz.mira.mobile.cloud-installation.v1';

export interface StoredCloudInstallation {
  schemaVersion: 1;
  installationId: string;
  createdAt: string;
}

export interface CloudInstallationStore {
  load(): Promise<StoredCloudInstallation | null>;
  save(value: StoredCloudInstallation): Promise<void>;
}

export interface CloudInstallationIdentity {
  getOrCreate(): Promise<string>;
}

export class CloudInstallationStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudInstallationStoreError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const parseStoredCloudInstallation = (
  value: string,
): StoredCloudInstallation => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new CloudInstallationStoreError(
      'Stored Mira Cloud installation identity is invalid',
    );
  }

  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== 1 ||
    typeof parsed.installationId !== 'string' ||
    !isValidUuidV4(parsed.installationId) ||
    typeof parsed.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(parsed.createdAt))
  ) {
    throw new CloudInstallationStoreError(
      'Stored Mira Cloud installation identity is incomplete',
    );
  }

  return {
    schemaVersion: 1,
    installationId: parsed.installationId,
    createdAt: new Date(parsed.createdAt).toISOString(),
  };
};

export class NativeCloudInstallationStore implements CloudInstallationStore {
  async load(): Promise<StoredCloudInstallation | null> {
    const module = getNativeSecureCredentialModule();
    if (!module) {
      throw new CloudInstallationStoreError(
        'Secure credential storage is not installed in this build',
      );
    }
    const value = await module.get(CLOUD_INSTALLATION_SERVICE);
    return value ? parseStoredCloudInstallation(value) : null;
  }

  async save(value: StoredCloudInstallation): Promise<void> {
    const module = getNativeSecureCredentialModule();
    if (!module) {
      throw new CloudInstallationStoreError(
        'Secure credential storage is not installed in this build',
      );
    }
    await module.set(CLOUD_INSTALLATION_SERVICE, JSON.stringify(value));
  }
}

export class MemoryCloudInstallationStore implements CloudInstallationStore {
  private value: StoredCloudInstallation | null = null;

  async load() {
    return this.value ? { ...this.value } : null;
  }

  async save(value: StoredCloudInstallation) {
    this.value = { ...value };
  }

  peek() {
    return this.value;
  }
}

export class MiraCloudInstallationIdentity
  implements CloudInstallationIdentity
{
  constructor(
    private readonly store: CloudInstallationStore = new NativeCloudInstallationStore(),
    private readonly random?: SecureRandomModule,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getOrCreate(): Promise<string> {
    const existing = await this.store.load();
    if (existing) return existing.installationId;

    const encoded = await (
      this.random ?? requireNativeSecureRandom()
    ).randomBytes(16);
    const installationId = uuidV4FromBytes(base64UrlToBytes(encoded));
    const createdAt = this.now().toISOString();
    await this.store.save({
      schemaVersion: 1,
      installationId,
      createdAt,
    });
    return installationId;
  }
}
