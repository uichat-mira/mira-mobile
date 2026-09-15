import { localKeyValueStore, type LocalKeyValueStore } from '../storage/localKeyValueStore';

export interface LocalProviderCompatibility {
  reasoningTags?: 'strip' | 'preserve';
}

export interface LocalProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: 'chat-completions';
  toolGatewayId?: string;
  compatibility?: LocalProviderCompatibility;
}

const STORAGE_KEY = 'mira.local-provider.configs.v1';

const parseCompatibility = (
  value: unknown,
): LocalProviderCompatibility => {
  if (value === undefined) return { reasoningTags: 'strip' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored local Provider compatibility configuration is invalid');
  }
  const record = value as Record<string, unknown>;
  if (
    record.reasoningTags !== undefined &&
    record.reasoningTags !== 'strip' &&
    record.reasoningTags !== 'preserve'
  ) {
    throw new Error('Stored local Provider reasoning-tag compatibility is invalid');
  }
  return {
    reasoningTags: record.reasoningTags === 'preserve' ? 'preserve' : 'strip',
  };
};

const parseConfig = (value: unknown): LocalProviderConfig => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored local Provider configuration is invalid');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    typeof record.name !== 'string' ||
    typeof record.baseUrl !== 'string' ||
    typeof record.model !== 'string' ||
    record.protocol !== 'chat-completions'
  ) {
    throw new Error('Stored local Provider configuration is incomplete');
  }
  const compatibility = parseCompatibility(record.compatibility);
  return {
    id: record.id,
    name: record.name,
    baseUrl: record.baseUrl,
    model: record.model,
    protocol: 'chat-completions',
    ...(typeof record.toolGatewayId === 'string' ? { toolGatewayId: record.toolGatewayId } : {}),
    compatibility,
  };
};

export class ProviderConfigStore {
  constructor(private readonly store: LocalKeyValueStore = localKeyValueStore) {}

  async load(): Promise<LocalProviderConfig[]> {
    const value = await this.store.get(STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) throw new Error('Stored local Provider configurations must be an array');
    return parsed.map(parseConfig);
  }

  async save(configs: readonly LocalProviderConfig[]): Promise<void> {
    const normalized = configs.map(parseConfig);
    await this.store.set(STORAGE_KEY, JSON.stringify(normalized));
  }

  async upsert(config: LocalProviderConfig): Promise<void> {
    const configs = await this.load();
    const normalized = parseConfig(config);
    const index = configs.findIndex((item) => item.id === normalized.id);
    if (index < 0) {
      await this.save([...configs, normalized]);
      return;
    }
    const next = [...configs];
    next[index] = normalized;
    await this.save(next);
  }

  async remove(providerId: string): Promise<void> {
    const configs = await this.load();
    await this.save(configs.filter((item) => item.id !== providerId));
  }

  async clear(): Promise<void> {
    await this.store.remove(STORAGE_KEY);
  }
}
