import {
  CloudSessionStoreError,
  MemoryCloudSessionStore,
  parseStoredCloudSession,
} from './cloudSessionStore';

const stored = {
  schemaVersion: 1 as const,
  sessionToken: 'mcs_v1.session-id.session-secret',
  account: { id: 'account-1', username: 'alice' },
  expiresAt: '2026-11-25T11:00:00.000Z',
  savedAt: '2026-10-25T11:00:00.000Z',
};

describe('Mira Cloud Session secure record', () => {
  it('round-trips only the Cloud session fields', async () => {
    const store = new MemoryCloudSessionStore();
    await store.save(stored);
    await expect(store.load()).resolves.toEqual(stored);
    await store.clear();
    await expect(store.load()).resolves.toBeNull();
  });

  it('parses a complete stored session', () => {
    expect(parseStoredCloudSession(JSON.stringify(stored))).toEqual(stored);
  });

  it('rejects incomplete or malformed stored sessions instead of granting authority', () => {
    expect(() => parseStoredCloudSession('not-json')).toThrow(
      CloudSessionStoreError,
    );
    expect(() =>
      parseStoredCloudSession(
        JSON.stringify({ ...stored, sessionToken: undefined }),
      ),
    ).toThrow(CloudSessionStoreError);
    expect(() =>
      parseStoredCloudSession(
        JSON.stringify({ ...stored, expiresAt: 'not-a-date' }),
      ),
    ).toThrow(CloudSessionStoreError);
    expect(() =>
      parseStoredCloudSession(
        JSON.stringify({ ...stored, account: { id: '', username: 'alice' } }),
      ),
    ).toThrow(CloudSessionStoreError);
  });

  it('marks malformed storage as corrupt for safe local clearing', () => {
    try {
      parseStoredCloudSession('{}');
      throw new Error('Expected parse to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(CloudSessionStoreError);
      expect((error as CloudSessionStoreError).reason).toBe('corrupt');
    }
  });
});
