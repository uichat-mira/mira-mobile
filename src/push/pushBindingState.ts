import { NativeModules } from 'react-native';

import { normalizePushSourceScope } from './brokerContracts';

const PUSH_BINDING_SERVICE = 'io.tomz.mira.mobile.push-binding.v1';
const MAX_CONSUMED_BINDING_NONCES = 64;

export type PushBindingStatus = 'pending-handoff' | 'active';

export interface StoredPushBinding {
  installationId: string;
  hostId: string;
  brokerBaseUrl: string;
  sourceScope: string[];
  bindingNonce: string;
  status: PushBindingStatus;
  updatedAt: string;
}

interface PushBindingRegistry {
  schemaVersion: 1;
  activeBinding: StoredPushBinding | null;
  consumedBindingNonces: string[];
}

interface NativeSecureCredentialModule {
  get(service: string): Promise<string | null>;
  set(service: string, value: string): Promise<void>;
  remove(service: string): Promise<void>;
}

export interface PushBindingStateStore {
  getActiveBinding(): Promise<StoredPushBinding | null>;
  claimBindingNonce(nonce: string): Promise<void>;
  saveBinding(binding: StoredPushBinding): Promise<void>;
  clearBinding(): Promise<void>;
  clearAll(): Promise<void>;
}

const emptyRegistry = (): PushBindingRegistry => ({
  schemaVersion: 1,
  activeBinding: null,
  consumedBindingNonces: [],
});

const requireNativeModule = (): NativeSecureCredentialModule => {
  const module = NativeModules.MiraSecureCredentialStore as
    | NativeSecureCredentialModule
    | undefined;
  if (
    !module ||
    typeof module.get !== 'function' ||
    typeof module.set !== 'function' ||
    typeof module.remove !== 'function'
  ) {
    throw new Error('Secure Push binding storage is unavailable');
  }
  return module;
};

const parseBinding = (value: unknown): StoredPushBinding => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored Push binding is invalid');
  }
  const record = value as Record<string, unknown>;
  const sourceScope = Array.isArray(record.sourceScope)
    ? normalizePushSourceScope(
        record.sourceScope.filter(
          (item): item is string => typeof item === 'string',
        ),
      )
    : [];
  if (
    typeof record.installationId !== 'string' ||
    !record.installationId.trim() ||
    typeof record.hostId !== 'string' ||
    !record.hostId.trim() ||
    typeof record.brokerBaseUrl !== 'string' ||
    !record.brokerBaseUrl.trim() ||
    sourceScope.length === 0 ||
    typeof record.bindingNonce !== 'string' ||
    !record.bindingNonce.trim() ||
    (record.status !== 'pending-handoff' && record.status !== 'active') ||
    typeof record.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.updatedAt))
  ) {
    throw new Error('Stored Push binding is incomplete');
  }
  return {
    installationId: record.installationId,
    hostId: record.hostId,
    brokerBaseUrl: record.brokerBaseUrl,
    sourceScope,
    bindingNonce: record.bindingNonce,
    status: record.status,
    updatedAt: new Date(record.updatedAt).toISOString(),
  };
};

const parseRegistry = (raw: string): PushBindingRegistry => {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Stored Push binding registry is invalid');
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    !Array.isArray(record.consumedBindingNonces) ||
    !record.consumedBindingNonces.every(item => typeof item === 'string')
  ) {
    throw new Error('Stored Push binding registry is incomplete');
  }
  return {
    schemaVersion: 1,
    activeBinding:
      record.activeBinding === null ? null : parseBinding(record.activeBinding),
    consumedBindingNonces: Array.from(
      new Set(record.consumedBindingNonces as string[]),
    ).slice(-MAX_CONSUMED_BINDING_NONCES),
  };
};

abstract class BasePushBindingStateStore implements PushBindingStateStore {
  protected abstract readRaw(): Promise<string | null>;
  protected abstract writeRaw(value: string): Promise<void>;
  protected abstract removeRaw(): Promise<void>;

  private async loadRegistry() {
    const raw = await this.readRaw();
    return raw ? parseRegistry(raw) : emptyRegistry();
  }

  private async saveRegistry(registry: PushBindingRegistry) {
    await this.writeRaw(JSON.stringify(registry));
  }

  async getActiveBinding() {
    const registry = await this.loadRegistry();
    return registry.activeBinding
      ? { ...registry.activeBinding, sourceScope: [...registry.activeBinding.sourceScope] }
      : null;
  }

  async claimBindingNonce(nonce: string) {
    const normalized = nonce.trim();
    if (!normalized) throw new Error('Push binding nonce is required');
    const registry = await this.loadRegistry();
    if (registry.consumedBindingNonces.includes(normalized)) {
      throw new Error('Push binding nonce has already been used');
    }
    registry.consumedBindingNonces = [
      ...registry.consumedBindingNonces,
      normalized,
    ].slice(-MAX_CONSUMED_BINDING_NONCES);
    await this.saveRegistry(registry);
  }

  async saveBinding(binding: StoredPushBinding) {
    const registry = await this.loadRegistry();
    registry.activeBinding = {
      ...binding,
      sourceScope: normalizePushSourceScope(binding.sourceScope),
    };
    await this.saveRegistry(registry);
  }

  async clearBinding() {
    const registry = await this.loadRegistry();
    registry.activeBinding = null;
    await this.saveRegistry(registry);
  }

  async clearAll() {
    await this.removeRaw();
  }
}

export class NativePushBindingStateStore extends BasePushBindingStateStore {
  protected async readRaw() {
    return requireNativeModule().get(PUSH_BINDING_SERVICE);
  }

  protected async writeRaw(value: string) {
    await requireNativeModule().set(PUSH_BINDING_SERVICE, value);
  }

  protected async removeRaw() {
    await requireNativeModule().remove(PUSH_BINDING_SERVICE);
  }
}

export class MemoryPushBindingStateStore extends BasePushBindingStateStore {
  private raw: string | null = null;

  protected async readRaw() {
    return this.raw;
  }

  protected async writeRaw(value: string) {
    this.raw = value;
  }

  protected async removeRaw() {
    this.raw = null;
  }
}

export const pushBindingStateStore = new NativePushBindingStateStore();
