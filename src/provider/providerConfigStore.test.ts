import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import {
  LOCAL_PROVIDER_CONFIG_STORAGE_KEYS,
  ProviderConfigStore,
  type LocalProviderConfig,
} from './providerConfigStore';

const chatConfig: LocalProviderConfig = {
  id: 'openai-main',
  name: 'OpenAI Chat',
  baseUrl: 'https://provider.example.com',
  model: 'model-1',
  protocol: 'openai-chat-completions',
  toolGatewayId: 'gateway-1',
};

const responsesConfig: LocalProviderConfig = {
  ...chatConfig,
  id: 'responses-main',
  name: 'OpenAI Responses',
  protocol: 'openai-responses',
};

describe('ProviderConfigStore', () => {
  it('round-trips both standard OpenAI protocols', async () => {
    const store = new ProviderConfigStore(new MemoryLocalKeyValueStore());
    await store.save([chatConfig, responsesConfig]);

    await expect(store.load()).resolves.toEqual([
      chatConfig,
      responsesConfig,
    ]);
  });

  it.each([
    'https://provider.example.com',
    'https://provider.example.com/v1',
    'https://provider.example.com/v1/',
  ])('migrates a legacy standard Chat Completions base URL: %s', async (baseUrl) => {
    const storage = new MemoryLocalKeyValueStore();
    await storage.set(
      LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.legacyV1,
      JSON.stringify([
        {
          id: 'legacy',
          name: 'Legacy Provider',
          baseUrl,
          model: 'legacy-model',
          protocol: 'chat-completions',
          compatibility: { reasoningTags: 'strip' },
        },
      ]),
    );
    const store = new ProviderConfigStore(storage);

    await expect(store.load()).resolves.toEqual([
      {
        id: 'legacy',
        name: 'Legacy Provider',
        baseUrl,
        model: 'legacy-model',
        protocol: 'openai-chat-completions',
        legacyReasoningBehaviorChanged: true,
      },
    ]);

    const raw = await storage.get(LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.current);
    expect(JSON.parse(raw ?? 'null')).toEqual([
      expect.objectContaining({
        id: 'legacy',
        protocol: 'openai-chat-completions',
        legacyReasoningBehaviorChanged: true,
      }),
    ]);
    await expect(
      storage.get(LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.legacyV1),
    ).resolves.not.toBeNull();
  });

  it.each([
    'https://provider.example.com/api/v1',
    'https://provider.example.com/custom',
  ])('keeps a non-standard legacy URL but requires explicit review: %s', async (baseUrl) => {
    const storage = new MemoryLocalKeyValueStore();
    await storage.set(
      LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.legacyV1,
      JSON.stringify([
        {
          id: 'legacy-private-path',
          name: 'Legacy private path',
          baseUrl,
          model: 'legacy-model',
          protocol: 'chat-completions',
        },
      ]),
    );
    const store = new ProviderConfigStore(storage);

    await expect(store.load()).resolves.toEqual([
      {
        id: 'legacy-private-path',
        name: 'Legacy private path',
        baseUrl,
        model: 'legacy-model',
        protocol: 'openai-chat-completions',
        requiresStandardProtocolReview: true,
        legacyReasoningBehaviorChanged: true,
      },
    ]);
  });

  it('requires review for a migrated legacy HTTP Base URL', async () => {
    const storage = new MemoryLocalKeyValueStore();
    await storage.set(
      LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.legacyV1,
      JSON.stringify([
        {
          id: 'legacy-http',
          name: 'Legacy HTTP',
          baseUrl: 'http://provider.example.com',
          model: 'legacy-model',
          protocol: 'chat-completions',
        },
      ]),
    );

    await expect(new ProviderConfigStore(storage).load()).resolves.toEqual([
      {
        id: 'legacy-http',
        name: 'Legacy HTTP',
        baseUrl: 'http://provider.example.com',
        model: 'legacy-model',
        protocol: 'openai-chat-completions',
        requiresStandardProtocolReview: true,
        legacyReasoningBehaviorChanged: true,
      },
    ]);
  });

  it('drops legacy reasoning-tag compatibility instead of preserving the hack', async () => {
    const storage = new MemoryLocalKeyValueStore();
    await storage.set(
      LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.legacyV1,
      JSON.stringify([
        {
          id: 'legacy-reasoning',
          name: 'Legacy reasoning',
          baseUrl: 'https://provider.example.com',
          model: 'legacy-model',
          protocol: 'chat-completions',
          compatibility: { reasoningTags: 'preserve' },
        },
      ]),
    );

    const loaded = await new ProviderConfigStore(storage).load();
    expect(loaded[0]).not.toHaveProperty('compatibility');
    expect(loaded[0]).not.toHaveProperty('requiresStandardProtocolReview');
    expect(loaded[0]).not.toHaveProperty('legacyReasoningBehaviorChanged');
  });

  it('rejects attempts to drop a blocking review flag while the Base URL is still non-standard', async () => {
    const storage = new MemoryLocalKeyValueStore();
    await storage.set(
      LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.legacyV1,
      JSON.stringify([
        {
          id: 'legacy-private',
          name: 'Legacy private',
          baseUrl: 'https://provider.example.com/api/v1',
          model: 'legacy-model',
          protocol: 'chat-completions',
        },
      ]),
    );
    const store = new ProviderConfigStore(storage);
    const [flagged] = await store.load();
    expect(flagged.requiresStandardProtocolReview).toBe(true);

    await expect(
      store.upsert({
        id: flagged.id,
        name: 'Renamed only',
        baseUrl: flagged.baseUrl,
        model: flagged.model,
        protocol: flagged.protocol,
      }),
    ).rejects.toThrow('API root or standard /v1 root');

    await expect(store.load()).resolves.toEqual([
      expect.objectContaining({
        id: 'legacy-private',
        baseUrl: 'https://provider.example.com/api/v1',
        requiresStandardProtocolReview: true,
      }),
    ]);
  });

  it('clears a stale migration review flag when a corrected HTTPS Base URL is upserted', async () => {
    const storage = new MemoryLocalKeyValueStore();
    await storage.set(
      LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.legacyV1,
      JSON.stringify([
        {
          id: 'legacy-private',
          name: 'Legacy private',
          baseUrl: 'https://provider.example.com/api/v1',
          model: 'legacy-model',
          protocol: 'chat-completions',
        },
      ]),
    );
    const store = new ProviderConfigStore(storage);
    const [flagged] = await store.load();

    await store.upsert({
      ...flagged,
      baseUrl: 'https://provider.example.com/v1',
    });

    await expect(store.load()).resolves.toEqual([
      {
        id: 'legacy-private',
        name: 'Legacy private',
        baseUrl: 'https://provider.example.com/v1',
        model: 'legacy-model',
        protocol: 'openai-chat-completions',
      },
    ]);
  });

  it('preserves a migration notice through low-level save and clears it only on explicit upsert', async () => {
    const storage = new MemoryLocalKeyValueStore();
    await storage.set(
      LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.legacyV1,
      JSON.stringify([{
        id: 'legacy',
        name: 'Legacy',
        baseUrl: 'https://provider.example.com',
        model: 'legacy-model',
        protocol: 'chat-completions',
      }]),
    );
    const store = new ProviderConfigStore(storage);
    const [migrated] = await store.load();
    expect(migrated.legacyReasoningBehaviorChanged).toBe(true);

    await store.save([migrated]);
    await expect(store.load()).resolves.toEqual([
      expect.objectContaining({
        id: 'legacy',
        legacyReasoningBehaviorChanged: true,
      }),
    ]);

    await store.upsert(migrated);
    const [acknowledged] = await store.load();
    expect(acknowledged).not.toHaveProperty(
      'legacyReasoningBehaviorChanged',
    );
  });

  it('keeps another provider migration notice when one provider is upserted', async () => {
    const storage = new MemoryLocalKeyValueStore();
    const store = new ProviderConfigStore(storage);
    const other: LocalProviderConfig = {
      ...chatConfig,
      id: 'other',
      legacyReasoningBehaviorChanged: true,
    };
    await store.save([other, chatConfig]);

    await store.upsert({ ...chatConfig, name: 'Renamed' });

    await expect(store.load()).resolves.toEqual([
      other,
      { ...chatConfig, name: 'Renamed' },
    ]);
  });

  it('prefers current v2 storage once migration has completed', async () => {
    const storage = new MemoryLocalKeyValueStore();
    await storage.set(
      LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.current,
      JSON.stringify([responsesConfig]),
    );
    await storage.set(
      LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.legacyV1,
      JSON.stringify([
        {
          id: 'legacy',
          name: 'Legacy',
          baseUrl: 'https://legacy.example.com',
          model: 'legacy',
          protocol: 'chat-completions',
        },
      ]),
    );

    await expect(new ProviderConfigStore(storage).load()).resolves.toEqual([
      responsesConfig,
    ]);
  });

  it('rejects unsupported current protocols', async () => {
    const storage = new MemoryLocalKeyValueStore();
    await storage.set(
      LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.current,
      JSON.stringify([{ ...chatConfig, protocol: 'vendor-private' }]),
    );

    await expect(new ProviderConfigStore(storage).load()).rejects.toThrow(
      'protocol is unsupported',
    );
  });

  it('rejects incomplete stored configuration', async () => {
    const storage = new MemoryLocalKeyValueStore();
    await storage.set(
      LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.current,
      JSON.stringify([{ id: 'broken' }]),
    );

    await expect(new ProviderConfigStore(storage).load()).rejects.toThrow(
      'incomplete',
    );
  });

  it('upserts one provider without overwriting other providers', async () => {
    const store = new ProviderConfigStore(new MemoryLocalKeyValueStore());
    await store.save([chatConfig]);
    await store.upsert({
      ...responsesConfig,
      id: 'second',
      name: 'Second Provider',
    });
    await expect(store.load()).resolves.toHaveLength(2);

    await store.upsert({ ...chatConfig, name: 'Renamed' });
    await expect(store.load()).resolves.toEqual([
      { ...chatConfig, name: 'Renamed' },
      { ...responsesConfig, id: 'second', name: 'Second Provider' },
    ]);
  });

  it('removes only the selected provider', async () => {
    const store = new ProviderConfigStore(new MemoryLocalKeyValueStore());
    await store.save([chatConfig, responsesConfig]);
    await store.remove(chatConfig.id);

    await expect(store.load()).resolves.toEqual([responsesConfig]);
  });

  it('clears both current and legacy config snapshots explicitly', async () => {
    const storage = new MemoryLocalKeyValueStore();
    await storage.set(
      LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.current,
      JSON.stringify([chatConfig]),
    );
    await storage.set(
      LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.legacyV1,
      JSON.stringify([]),
    );

    await new ProviderConfigStore(storage).clear();

    await expect(
      storage.get(LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.current),
    ).resolves.toBeNull();
    await expect(
      storage.get(LOCAL_PROVIDER_CONFIG_STORAGE_KEYS.legacyV1),
    ).resolves.toBeNull();
  });
});
