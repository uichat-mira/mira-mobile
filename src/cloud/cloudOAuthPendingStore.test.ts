import {
  CloudOAuthPendingStoreError,
  MemoryCloudOAuthPendingStore,
  parsePendingOAuthTransaction,
} from './cloudOAuthPendingStore';

const pending = {
  schemaVersion: 1 as const,
  state: 'state-0123456789-abcdef',
  codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  createdAt: '2026-10-25T11:00:00.000Z',
};

describe('pending Mira Cloud OAuth transaction', () => {
  it('round-trips the PKCE verifier and state in a secure-store record', async () => {
    const store = new MemoryCloudOAuthPendingStore();
    await store.save(pending);
    await expect(store.load()).resolves.toEqual(pending);
    await store.clear();
    await expect(store.load()).resolves.toBeNull();
  });

  it('rejects malformed pending transactions instead of exchanging them', () => {
    expect(parsePendingOAuthTransaction(JSON.stringify(pending))).toEqual(
      pending,
    );
    expect(() => parsePendingOAuthTransaction('not-json')).toThrow(
      CloudOAuthPendingStoreError,
    );
    expect(() =>
      parsePendingOAuthTransaction(
        JSON.stringify({ ...pending, codeVerifier: '' }),
      ),
    ).not.toThrow();
    expect(() =>
      parsePendingOAuthTransaction(JSON.stringify({ ...pending, state: 42 })),
    ).toThrow(CloudOAuthPendingStoreError);
  });
});
