import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import { ProviderConfigStore, type LocalProviderConfig } from './providerConfigStore';

const config: LocalProviderConfig = {
  id: 'openai-main',
  name: 'OpenAI compatible',
  baseUrl: 'https://provider.example.com',
  model: 'model-1',
  protocol: 'chat-completions',
  toolGatewayId: 'gateway-1',
  compatibility: { reasoningTags: 'strip' },
};

describe('ProviderConfigStore', () => {
  it('round-trips non-secret provider configuration', async () => {
    const store = new ProviderConfigStore(new MemoryLocalKeyValueStore());
    await store.save([config]);

    await expect(store.load()).resolves.toEqual([config]);
  });

  it('keeps legacy provider configuration with compatibility disabled', async () => {
    const storage = new MemoryLocalKeyValueStore();
    await storage.set(
      'mira.local-provider.configs.v1',
      JSON.stringify([
        {
          id: 'legacy',
          name: 'Legacy Provider',
          baseUrl: 'https://legacy.example.com',
          model: 'legacy-model',
          protocol: 'chat-completions',
        },
      ]),
    );
    const store = new ProviderConfigStore(storage);

    await expect(store.load()).resolves.toEqual([
      {
        id: 'legacy',
        name: 'Legacy Provider',
        baseUrl: 'https://legacy.example.com',
        model: 'legacy-model',
        protocol: 'chat-completions',
      },
    ]);
  });

  it('rejects unsupported reasoning-tag compatibility values', async () => {
    const storage = new MemoryLocalKeyValueStore();
    await storage.set(
      'mira.local-provider.configs.v1',
      JSON.stringify([
        {
          ...config,
          compatibility: { reasoningTags: 'auto' },
        },
      ]),
    );
    const store = new ProviderConfigStore(storage);

    await expect(store.load()).rejects.toThrow('reasoning-tag compatibility');
  });

  it('rejects incomplete stored configuration', async () => {
    const storage = new MemoryLocalKeyValueStore();
    await storage.set('mira.local-provider.configs.v1', JSON.stringify([{ id: 'broken' }]));
    const store = new ProviderConfigStore(storage);

    await expect(store.load()).rejects.toThrow('incomplete');
  });

  it('upserts one provider without overwriting other providers', async () => {
    const store = new ProviderConfigStore(new MemoryLocalKeyValueStore());
    await store.save([config]);
    await store.upsert({ ...config, id: 'second', name: 'Second Provider' });
    await expect(store.load()).resolves.toHaveLength(2);
    await store.upsert({ ...config, name: 'Renamed' });
    await expect(store.load()).resolves.toEqual([
      { ...config, name: 'Renamed' },
      { ...config, id: 'second', name: 'Second Provider' },
    ]);
  });

  it('removes only the selected provider', async () => {
    const store = new ProviderConfigStore(new MemoryLocalKeyValueStore());
    await store.save([config, { ...config, id: 'second' }]);
    await store.remove('openai-main');
    await expect(store.load()).resolves.toEqual([{ ...config, id: 'second' }]);
  });
});
