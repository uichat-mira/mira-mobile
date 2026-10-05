import { localKeyValueStore, type LocalKeyValueStore } from '../storage/localKeyValueStore';
import {
  isOpenAiStandardBaseUrl,
  type OpenAiStandardProtocol,
} from './openAiStandardProtocol';

export interface LocalProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: OpenAiStandardProtocol;
  toolGatewayId?: string;
  requiresStandardProtocolReview?: boolean;
}

export const LOCAL_PROVIDER_CONFIG_STORAGE_KEYS = {
  current: 'mira.local-provider.configs.v2',
  legacyV1: 'mira.local-provider.configs.v1',
} as const;

const parseCommonFields = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored local Provider configuration is invalid');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    typeof record.name !== 'string' ||
    typeof record.baseUrl !== 'string' ||
    typeof record.model !== 'string'
  ) {
    throw new Error('Stored local Provider configuration is incomplete');
  }
  return record;
};

const parseCurrentConfig = (value: unknown): LocalProviderConfig => {
  const record = parseCommonFields(value);
  if (
    record.protocol !== 'openai-chat-completions' &&
    record.protocol !== 'openai-responses'
  ) {
    throw new Error('Stored local Provider protocol is unsupported');
  }

  return {
    id: record.id as string,
    name: record.name as string,
    baseUrl: record.baseUrl as string,
    model: record.model as string,
    protocol: record.protocol,
    ...(typeof record.toolGatewayId === 'string'
      ? { toolGatewayId: record.toolGatewayId }
      : {}),
    ...(record.requiresStandardProtocolReview === true
      ? { requiresStandardProtocolReview: true }
      : {}),
  };
};

const migrateLegacyConfig = (value: unknown): LocalProviderConfig => {
  const record = parseCommonFields(value);
  if (record.protocol !== 'chat-completions') {
    throw new Error('Stored legacy Local Provider protocol is unsupported');
  }

  const baseUrl = record.baseUrl as string;
  const isHttpsLegacyBase =
    /^https:\/\//iu.test(baseUrl.trim()) &&
    isOpenAiStandardBaseUrl(baseUrl);
  return {
    id: record.id as string,
    name: record.name as string,
    baseUrl,
    model: record.model as string,
    protocol: 'openai-chat-completions',
    ...(typeof record.toolGatewayId === 'string'
      ? { toolGatewayId: record.toolGatewayId }
      : {}),
    ...(!isHttpsLegacyBase
      ? { requiresStandardProtocolReview: true }
      : {}),
  };
};

const parseConfigArray = (
  raw: string,
  parse: (value: unknown) => LocalProviderConfig,
): LocalProviderConfig[] => {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Stored local Provider configurations must be an array');
  }
  return parsed.map(parse);
};

export class ProviderConfigStore {
  constructor(private readonly store: LocalKeyValueStore = localKeyValueStore) {}

  async load(): Promise<LocalProviderConfig[]> {
    const current = await this.store.get(LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.current);
    if (current) {
      return parseConfigArray(current, parseCurrentConfig);
    }

    const legacy = await this.store.get(LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.legacyV1);
    if (!legacy) return [];

    const migrated = parseConfigArray(legacy, migrateLegacyConfig);
    await this.store.set(
      LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.current,
      JSON.stringify(migrated),
    );
    return migrated;
  }

  async save(configs: readonly LocalProviderConfig[]): Promise<void> {
    const normalized = configs.map(parseCurrentConfig);
    await this.store.set(
      LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.current,
      JSON.stringify(normalized),
    );
  }

  async upsert(config: LocalProviderConfig): Promise<void> {
    const configs = await this.load();
    const normalized = parseCurrentConfig(config);
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
    await Promise.all([
      this.store.remove(LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.current),
      this.store.remove(LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.legacyV1),
    ]);
  }
}
