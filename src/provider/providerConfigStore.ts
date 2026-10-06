import { localKeyValueStore, type LocalKeyValueStore } from '../storage/localKeyValueStore';
import {
  isOpenAiStandardBaseUrl,
  normalizeOpenAiStandardBaseUrl,
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
  legacyReasoningBehaviorChanged?: boolean;
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

  const baseUrl = record.baseUrl as string;
  const requiresStandardProtocolReview =
    record.requiresStandardProtocolReview === true;
  const legacyReasoningBehaviorChanged =
    record.legacyReasoningBehaviorChanged === true;

  if (!requiresStandardProtocolReview) {
    normalizeOpenAiStandardBaseUrl(baseUrl);
  }

  return {
    id: record.id as string,
    name: record.name as string,
    baseUrl,
    model: record.model as string,
    protocol: record.protocol,
    ...(typeof record.toolGatewayId === 'string'
      ? { toolGatewayId: record.toolGatewayId }
      : {}),
    ...(requiresStandardProtocolReview
      ? { requiresStandardProtocolReview: true }
      : {}),
    ...(legacyReasoningBehaviorChanged
      ? { legacyReasoningBehaviorChanged: true }
      : {}),
  };
};

const normalizeConfigForWrite = (
  value: LocalProviderConfig,
  acknowledgeMigration = false,
): LocalProviderConfig => {
  const parsed = parseCurrentConfig(value);
  const normalized = { ...parsed };

  if (acknowledgeMigration) {
    delete normalized.legacyReasoningBehaviorChanged;
  }

  if (parsed.requiresStandardProtocolReview && acknowledgeMigration) {
    const isCorrectedHttpsBase =
      /^https:\/\//iu.test(parsed.baseUrl.trim()) &&
      isOpenAiStandardBaseUrl(parsed.baseUrl);
    if (isCorrectedHttpsBase) {
      delete normalized.requiresStandardProtocolReview;
    }
  }

  return normalized;
};

const legacyReasoningTagMode = (value: unknown): 'strip' | 'preserve' => {
  if (value === undefined) return 'strip';
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      'Stored legacy Local Provider compatibility configuration is invalid',
    );
  }
  const record = value as Record<string, unknown>;
  if (
    record.reasoningTags !== undefined &&
    record.reasoningTags !== 'strip' &&
    record.reasoningTags !== 'preserve'
  ) {
    throw new Error(
      'Stored legacy Local Provider reasoning-tag compatibility is invalid',
    );
  }
  return record.reasoningTags === 'preserve' ? 'preserve' : 'strip';
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
  const reasoningTagMode = legacyReasoningTagMode(record.compatibility);
  const requiresStandardProtocolReview = !isHttpsLegacyBase;
  const legacyReasoningBehaviorChanged = reasoningTagMode === 'strip';
  return {
    id: record.id as string,
    name: record.name as string,
    baseUrl,
    model: record.model as string,
    protocol: 'openai-chat-completions',
    ...(typeof record.toolGatewayId === 'string'
      ? { toolGatewayId: record.toolGatewayId }
      : {}),
    ...(requiresStandardProtocolReview
      ? { requiresStandardProtocolReview: true }
      : {}),
    ...(legacyReasoningBehaviorChanged
      ? { legacyReasoningBehaviorChanged: true }
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

  /**
   * Low-level full-list persistence used by internal state/rollback paths.
   * It deliberately does not acknowledge migration notices.
   */
  async save(configs: readonly LocalProviderConfig[]): Promise<void> {
    const normalized = configs.map((config) =>
      normalizeConfigForWrite(config),
    );
    await this.store.set(
      LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.current,
      JSON.stringify(normalized),
    );
  }

  /**
   * User-authored Provider write. A successful validated upsert acknowledges
   * non-blocking migration notices and clears a blocking review only after the
   * Base URL has been corrected to a standard root.
   */
  async upsert(config: LocalProviderConfig): Promise<void> {
    const configs = await this.load();
    const normalized = normalizeConfigForWrite(config, true);
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
