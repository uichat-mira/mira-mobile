import {
  MemoryCloudSessionStore,
  type StoredCloudSession,
} from '../cloud/cloudSessionStore';
import { WhoYouError } from './whoYouError';
import type {
  WhoYouMailbox,
  WhoYouMcpClientLike,
  WhoYouSnapshot,
} from './whoYouMcpClient';
import {
  createWhoYouStore,
  type WhoYouCloudSnapshot,
} from './whoYouStore';

const NOW = new Date('2026-11-22T00:00:00.000Z');

const mailbox: WhoYouMailbox = {
  mailboxId: 'mailbox-gmail-1',
  address: 'alice@example.test',
  kind: 'third_party',
  provider: 'gmail',
  status: 'active',
  credentialStatus: 'active',
  quotaBytes: 1000,
  bytesUsed: 20,
  messageCount: 3,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const snapshot: WhoYouSnapshot = {
  identity: {
    accountId: 'account-1',
    consumerId: 'account-1',
    scopes: ['whoyou.read'],
  },
  mailboxes: [mailbox],
};

const storedSession = (
  overrides: Partial<StoredCloudSession> = {},
): StoredCloudSession => ({
  schemaVersion: 1,
  sessionToken: 'mcs_v1.session-id.session-secret',
  account: { id: 'account-1', username: 'alice' },
  expiresAt: '2026-12-22T00:00:00.000Z',
  savedAt: '2026-11-22T00:00:00.000Z',
  ...overrides,
});

const setup = (options: {
  session?: StoredCloudSession | null;
  cloud?: WhoYouCloudSnapshot;
  client?: jest.Mock;
} = {}) => {
  let cloud: WhoYouCloudSnapshot = options.cloud ?? {
    status: 'signed_in',
    accountId: 'account-1',
  };
  const sessionStore = new MemoryCloudSessionStore();
  const seed = options.session === undefined ? storedSession() : options.session;
  // MemoryCloudSessionStore.save commits synchronously before returning its
  // promise, so this seeds the record without counting as a store operation.
  if (seed) void sessionStore.save(seed);
  const saveSpy = jest.spyOn(sessionStore, 'save');
  const clearSpy = jest.spyOn(sessionStore, 'clear');
  const loadSession = jest.fn(() => sessionStore.load());
  const client: WhoYouMcpClientLike & { load: jest.Mock } = {
    load: options.client ?? jest.fn(async () => snapshot),
  };
  const store = createWhoYouStore({
    loadSession,
    getCloudAccount: () => cloud,
    client,
    now: () => NOW,
  });
  return {
    store,
    client,
    loadSession,
    saveSpy,
    clearSpy,
    setCloud: (next: WhoYouCloudSnapshot) => {
      cloud = next;
    },
  };
};

describe('Who You store lifecycle', () => {
  it('publishes only the read snapshot and never keeps a credential token in state', async () => {
    const { store } = setup();
    await store.getState().refresh();

    const state = store.getState();
    expect(state.status).toBe('ready');
    expect(state.identity?.scopes).toEqual(['whoyou.read']);
    expect(state.mailboxes).toEqual([mailbox]);
    expect(JSON.stringify(state)).not.toContain('mcs_v1');
    expect(JSON.stringify(state)).not.toContain('who-you-read-token');
  });

  it('reports a true empty state when the account has no mailbox identities', async () => {
    const { store } = setup({
      client: jest.fn(async () => ({ ...snapshot, mailboxes: [] })),
    });
    await store.getState().refresh();
    expect(store.getState().status).toBe('empty');
    expect(store.getState().mailboxes).toEqual([]);
  });

  it('requires a signed-in Cloud account before reading secure storage', async () => {
    const { store, loadSession, client } = setup({
      cloud: { status: 'signed_out', accountId: null },
    });
    await store.getState().refresh();
    expect(store.getState().status).toBe('signed_out');
    expect(loadSession).not.toHaveBeenCalled();
    expect(client.load).not.toHaveBeenCalled();
  });

  it('rejects an expired or different-account stored session without calling Who You', async () => {
    const expired = setup({
      session: storedSession({ expiresAt: '2026-11-21T23:59:59.000Z' }),
    });
    await expired.store.getState().refresh();
    expect(expired.store.getState().status).toBe('session_rejected');
    expect(expired.client.load).not.toHaveBeenCalled();

    const otherAccount = setup({
      session: storedSession({ account: { id: 'account-2', username: 'bob' } }),
    });
    await otherAccount.store.getState().refresh();
    expect(otherAccount.store.getState().status).toBe('session_rejected');
    expect(otherAccount.client.load).not.toHaveBeenCalled();
  });

  it('never clears the Cloud session when Who You or credential issuance fails', async () => {
    for (const error of [
      new WhoYouError('session_rejected', 'rejected'),
      new WhoYouError('unavailable', 'unavailable'),
      new WhoYouError('invalid_response', 'invalid'),
    ]) {
      const { store, saveSpy, clearSpy } = setup({
        client: jest.fn(async () => {
          throw error;
        }),
      });
      await store.getState().refresh();
      expect(clearSpy).not.toHaveBeenCalled();
      expect(saveSpy).not.toHaveBeenCalled();
      expect(store.getState().mailboxes).toEqual([]);
      expect(['session_rejected', 'unavailable', 'error']).toContain(
        store.getState().status,
      );
    }
  });

  it('refuses to publish an old account result after the Cloud account changes', async () => {
    let resolveLoad!: (value: WhoYouSnapshot) => void;
    const pending = new Promise<WhoYouSnapshot>(resolve => {
      resolveLoad = resolve;
    });
    const { store, client, setCloud } = setup({
      client: jest.fn(() => pending),
    });

    const load = store.getState().refresh();
    while (client.load.mock.calls.length === 0) await Promise.resolve();
    setCloud({ status: 'signed_in', accountId: 'account-2' });
    resolveLoad(snapshot);
    await load;

    expect(store.getState().status).toBe('signed_out');
    expect(store.getState().mailboxes).toEqual([]);
  });

  it('invalidates an in-flight result immediately on logout or account removal', async () => {
    let resolveLoad!: (value: WhoYouSnapshot) => void;
    const pending = new Promise<WhoYouSnapshot>(resolve => {
      resolveLoad = resolve;
    });
    const { store, client } = setup({
      client: jest.fn(() => pending),
    });

    const load = store.getState().refresh();
    while (client.load.mock.calls.length === 0) await Promise.resolve();
    store.getState().invalidate();
    resolveLoad(snapshot);
    await load;

    expect(store.getState().status).toBe('idle');
    expect(store.getState().identity).toBeNull();
    expect(store.getState().mailboxes).toEqual([]);
  });
});
