import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import {
  loadLastOpenedSession,
  removeLastOpenedSession,
  saveLastOpenedSession,
} from './lastOpenedSession';

const makeStore = () => new MemoryLocalKeyValueStore();

describe('lastOpenedSession', () => {
  it('returns null when nothing is stored', async () => {
    await expect(loadLastOpenedSession(makeStore())).resolves.toBeNull();
  });

  it('round-trips a saved record', async () => {
    const store = makeStore();
    await saveLastOpenedSession(
      {
        sessionId: 'thread-1',
        title: '  需求评审  ',
        source: 'remote-host',
        providerName: null,
        providerModel: null,
      },
      store,
    );

    await expect(loadLastOpenedSession(store)).resolves.toEqual({
      sessionId: 'thread-1',
      title: '需求评审',
      source: 'remote-host',
      providerName: null,
      providerModel: null,
    });
  });

  it('infers the source from a local session id when omitted', async () => {
    const store = makeStore();
    await saveLastOpenedSession(
      { sessionId: 'local-abc', providerName: 'DeepSeek', providerModel: 'deepseek-chat' },
      store,
    );

    await expect(loadLastOpenedSession(store)).resolves.toMatchObject({
      sessionId: 'local-abc',
      source: 'local-provider',
      providerName: 'DeepSeek',
      providerModel: 'deepseek-chat',
    });
  });

  it('ignores empty session ids', async () => {
    const store = makeStore();
    await saveLastOpenedSession({ sessionId: '   ' }, store);
    await expect(loadLastOpenedSession(store)).resolves.toBeNull();
  });

  it('returns null on malformed stored data', async () => {
    const store = makeStore();
    await store.set('mira.mobile.last-opened-session.v1', '[1,2,3]');
    await expect(loadLastOpenedSession(store)).resolves.toBeNull();
  });

  it('only removes the record for the matching session', async () => {
    const store = makeStore();
    await saveLastOpenedSession({ sessionId: 'thread-1', title: 'A' }, store);

    await removeLastOpenedSession('thread-2', store);
    await expect(loadLastOpenedSession(store)).resolves.toMatchObject({ sessionId: 'thread-1' });

    await removeLastOpenedSession('thread-1', store);
    await expect(loadLastOpenedSession(store)).resolves.toBeNull();
  });
});
