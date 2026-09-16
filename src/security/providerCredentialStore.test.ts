import { MemoryProviderCredentialStore } from './providerCredentialStore';

describe('MemoryProviderCredentialStore', () => {
  it('keeps credentials isolated by provider id and supports clearing', async () => {
    const store = new MemoryProviderCredentialStore();
    await store.save('provider-a', 'key-a');
    await store.save('provider-b', 'key-b');

    await expect(store.load('provider-a')).resolves.toBe('key-a');
    await expect(store.load('provider-b')).resolves.toBe('key-b');

    await store.clear('provider-a');
    await expect(store.load('provider-a')).resolves.toBeNull();
    await expect(store.load('provider-b')).resolves.toBe('key-b');
  });

  it('rejects empty keys and unsafe provider ids', async () => {
    const store = new MemoryProviderCredentialStore();

    await expect(store.save('provider-a', '   ')).rejects.toThrow('cannot be empty');
    await expect(store.load('../provider-a')).rejects.toThrow('unsupported characters');
  });
});
