import { NativeModules } from 'react-native';
import nacl from 'tweetnacl';

const INSTALLATION_SERVICE = 'io.tomz.mira.mobile.push-installation.v1';
const INSTALLATION_PREFIX = 'mira-installation-';
const NONCE_PREFIX = 'mira-push-';

interface NativeSecureCredentialModule {
  get(service: string): Promise<string | null>;
  set(service: string, value: string): Promise<void>;
  remove(service: string): Promise<void>;
  randomBytes(length: number): Promise<string>;
}

export interface PushInstallationRecord {
  schemaVersion: 1;
  installationId: string;
  seed: string;
  createdAt: string;
}

export interface PushInstallationIdentity {
  installationId: string;
  installationPublicKey: string;
  createdAt: string;
}

export interface PushInstallationSecureStore {
  load(): Promise<PushInstallationRecord | null>;
  save(value: PushInstallationRecord): Promise<void>;
  clear(): Promise<void>;
  randomBytes(length: number): Promise<string>;
}

const base64UrlToBytes = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of padded.replace(/=+$/u, '')) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid base64url value');
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
};

export const bytesToBase64Url = (value: Uint8Array) => {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < value.length; index += 3) {
    const first = value[index] ?? 0;
    const second = value[index + 1] ?? 0;
    const third = value[index + 2] ?? 0;
    const chunk = (first << 16) | (second << 8) | third;
    output += alphabet[(chunk >> 18) & 63];
    output += alphabet[(chunk >> 12) & 63];
    output += index + 1 < value.length ? alphabet[(chunk >> 6) & 63] : '=';
    output += index + 2 < value.length ? alphabet[chunk & 63] : '=';
  }
  return output.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
};

const utf8Bytes = (value: string) => {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.codePointAt(index);
    if (codePoint === undefined) continue;
    if (codePoint > 0xffff) index += 1;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
};

const parseRecord = (value: string): PushInstallationRecord => {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Stored Push installation identity is invalid');
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    typeof record.installationId !== 'string' ||
    !record.installationId.startsWith(INSTALLATION_PREFIX) ||
    typeof record.seed !== 'string' ||
    base64UrlToBytes(record.seed).length !== nacl.sign.seedLength ||
    typeof record.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(record.createdAt))
  ) {
    throw new Error('Stored Push installation identity is incomplete');
  }
  return {
    schemaVersion: 1,
    installationId: record.installationId,
    seed: record.seed,
    createdAt: new Date(record.createdAt).toISOString(),
  };
};

const requireNativeSecureModule = (): NativeSecureCredentialModule => {
  const module = NativeModules.MiraSecureCredentialStore as
    | NativeSecureCredentialModule
    | undefined;
  if (
    !module ||
    typeof module.get !== 'function' ||
    typeof module.set !== 'function' ||
    typeof module.remove !== 'function' ||
    typeof module.randomBytes !== 'function'
  ) {
    throw new Error('Secure Push installation storage is unavailable');
  }
  return module;
};

export class NativePushInstallationSecureStore
  implements PushInstallationSecureStore
{
  async load() {
    const raw = await requireNativeSecureModule().get(INSTALLATION_SERVICE);
    return raw ? parseRecord(raw) : null;
  }

  async save(value: PushInstallationRecord) {
    await requireNativeSecureModule().set(
      INSTALLATION_SERVICE,
      JSON.stringify(value),
    );
  }

  async clear() {
    await requireNativeSecureModule().remove(INSTALLATION_SERVICE);
  }

  randomBytes(length: number) {
    return requireNativeSecureModule().randomBytes(length);
  }
}

export class MemoryPushInstallationSecureStore
  implements PushInstallationSecureStore
{
  private value: PushInstallationRecord | null = null;
  private counter = 1;

  async load() {
    return this.value ? { ...this.value } : null;
  }

  async save(value: PushInstallationRecord) {
    this.value = { ...value };
  }

  async clear() {
    this.value = null;
  }

  async randomBytes(length: number) {
    const bytes = Uint8Array.from(
      { length },
      (_, index) => (this.counter + index) & 0xff,
    );
    this.counter += length;
    return bytesToBase64Url(bytes);
  }

  peek() {
    return this.value ? { ...this.value } : null;
  }
}

export class PushInstallationIdentityService {
  constructor(
    private readonly store: PushInstallationSecureStore =
      new NativePushInstallationSecureStore(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getOrCreate(): Promise<PushInstallationIdentity> {
    const existing = await this.store.load();
    if (existing) return this.toIdentity(existing);

    const seed = await this.store.randomBytes(nacl.sign.seedLength);
    if (base64UrlToBytes(seed).length !== nacl.sign.seedLength) {
      throw new Error('Secure random source returned an invalid Ed25519 seed');
    }
    const idEntropy = await this.store.randomBytes(16);
    const record: PushInstallationRecord = {
      schemaVersion: 1,
      installationId: `${INSTALLATION_PREFIX}${idEntropy}`,
      seed,
      createdAt: this.now().toISOString(),
    };
    await this.store.save(record);
    return this.toIdentity(record);
  }

  async sign(value: string) {
    const record = await this.requireRecord();
    const keyPair = nacl.sign.keyPair.fromSeed(base64UrlToBytes(record.seed));
    return bytesToBase64Url(
      nacl.sign.detached(utf8Bytes(value), keyPair.secretKey),
    );
  }

  async createNonce() {
    return `${NONCE_PREFIX}${await this.store.randomBytes(18)}`;
  }

  async reset() {
    await this.store.clear();
  }

  private async requireRecord() {
    const record = await this.store.load();
    if (!record) {
      await this.getOrCreate();
      const created = await this.store.load();
      if (!created) throw new Error('Push installation identity was not persisted');
      return created;
    }
    return record;
  }

  private toIdentity(record: PushInstallationRecord): PushInstallationIdentity {
    const keyPair = nacl.sign.keyPair.fromSeed(base64UrlToBytes(record.seed));
    return {
      installationId: record.installationId,
      installationPublicKey: bytesToBase64Url(keyPair.publicKey),
      createdAt: record.createdAt,
    };
  }
}

export const pushInstallationIdentity = new PushInstallationIdentityService();
