import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';

class DelayedLocalKeyValueStore extends MemoryLocalKeyValueStore {
  async set(key: string, value: string) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    await super.set(key, value);
  }
}

class FailAfterPersistLocalKeyValueStore extends MemoryLocalKeyValueStore {
  failNextSetAfterPersist = false;

  async set(key: string, value: string) {
    await super.set(key, value);
    if (this.failNextSetAfterPersist) {
      this.failNextSetAfterPersist = false;
      throw new Error('simulated write acknowledgement failure');
    }
  }
}

class FailCascadeAndRestoreLocalKeyValueStore extends MemoryLocalKeyValueStore {
  failuresRemaining = 0;

  async set(key: string, value: string) {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error('simulated persistent storage failure');
    }
    await super.set(key, value);
  }
}
import { LocalSessionRepository } from './localSessionRepository';

describe('LocalSessionRepository', () => {
  it('stores provider ownership and appends canonical chat messages', async () => {
    const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());
    const session = await repository.create('provider-a', 'Local chat');

    await repository.appendMessages(session.id, [
      { id: 'user-1', role: 'user', content: 'hello', timestamp: new Date('2026-09-05T00:00:00Z') },
      { id: 'assistant-1', role: 'assistant', content: 'hi', timestamp: new Date('2026-09-05T00:00:01Z') },
    ]);

    await expect(repository.getProviderId(session.id)).resolves.toBe('provider-a');
    await expect(repository.getMessages(session.id)).resolves.toMatchObject([
      { id: 'user-1', role: 'user', content: 'hello' },
      { id: 'assistant-1', role: 'assistant', content: 'hi' },
    ]);
  });

  it('filters sessions by provider and rejects unknown sessions', async () => {
    const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());
    await repository.create('provider-a', 'A');
    await repository.create('provider-b', 'B');

    await expect(repository.list('provider-a')).resolves.toHaveLength(1);
    await expect(repository.getMessages('missing')).rejects.toThrow('not found');
  });

  it('deletes only the requested local session', async () => {
    const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());
    const first = await repository.create('provider-a', 'A1');
    const second = await repository.create('provider-a', 'A2');
    const otherProvider = await repository.create('provider-b', 'B1');

    await repository.delete(first.id);

    await expect(repository.get(first.id)).rejects.toThrow('not found');
    await expect(repository.list('provider-a')).resolves.toMatchObject([
      { id: second.id, title: 'A2' },
    ]);
    await expect(repository.list('provider-b')).resolves.toMatchObject([
      { id: otherProvider.id, title: 'B1' },
    ]);
  });

  it('deletes only sessions owned by the requested provider and returns their ids', async () => {
    const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());
    const first = await repository.create('provider-a', 'A1');
    const second = await repository.create('provider-a', 'A2');
    const otherProvider = await repository.create('provider-b', 'B1');

    await expect(repository.deleteByProvider('provider-a')).resolves.toEqual([
      second.id,
      first.id,
    ]);

    await expect(repository.list('provider-a')).resolves.toEqual([]);
    await expect(repository.list('provider-b')).resolves.toMatchObject([
      { id: otherProvider.id, title: 'B1' },
    ]);
  });

  it('rejects a cascade when the frozen Provider session ids changed', async () => {
    const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());
    const first = await repository.create('provider-a', 'A1');
    const second = await repository.create('provider-a', 'A2');

    await expect(
      repository.deleteByProvider('provider-a', [first.id, 'local-stale']),
    ).rejects.toMatchObject({
      actualSessionIds: [second.id, first.id],
    });

    await expect(repository.list('provider-a')).resolves.toHaveLength(2);
  });

  it('restores the full canonical session snapshot when cascade persistence fails after writing', async () => {
    const storage = new FailAfterPersistLocalKeyValueStore();
    const repository = new LocalSessionRepository(storage);
    const first = await repository.create('provider-a', 'A1');
    const second = await repository.create('provider-b', 'B1');

    storage.failNextSetAfterPersist = true;

    await expect(
      repository.deleteByProvider('provider-a', [first.id]),
    ).rejects.toThrow('simulated write acknowledgement failure');

    await expect(repository.list()).resolves.toMatchObject([
      { id: second.id, title: 'B1' },
      { id: first.id, title: 'A1' },
    ]);
  });

  it('surfaces incomplete canonical-session rollback when the snapshot cannot be restored', async () => {
    const storage = new FailCascadeAndRestoreLocalKeyValueStore();
    const repository = new LocalSessionRepository(storage);
    const first = await repository.create('provider-a', 'A1');

    storage.failuresRemaining = 2;

    await expect(
      repository.deleteByProvider('provider-a', [first.id]),
    ).rejects.toMatchObject({
      name: 'LocalProviderSessionRollbackIncompleteError',
      originalError: expect.any(Error),
    });
  });

  it('treats provider cascade deletion with no owned sessions as a no-op', async () => {
    const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());
    const otherProvider = await repository.create('provider-b', 'B1');

    await expect(repository.deleteByProvider('provider-a')).resolves.toEqual([]);
    await expect(repository.list()).resolves.toMatchObject([
      { id: otherProvider.id, title: 'B1' },
    ]);
  });

  it('rejects deleting an unknown session without changing stored sessions', async () => {
    const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());
    const session = await repository.create('provider-a', 'Keep me');

    await expect(repository.delete('missing')).rejects.toThrow('not found');
    await expect(repository.list()).resolves.toMatchObject([
      { id: session.id, title: 'Keep me' },
    ]);
  });

  it('serializes delete with concurrent create so neither update is lost', async () => {
    const repository = new LocalSessionRepository(new DelayedLocalKeyValueStore());
    const obsolete = await repository.create('provider-a', 'Delete me');

    const [, created] = await Promise.all([
      repository.delete(obsolete.id),
      repository.create('provider-a', 'Keep me'),
    ]);

    await expect(repository.get(obsolete.id)).rejects.toThrow('not found');
    await expect(repository.list('provider-a')).resolves.toMatchObject([
      { id: created.id, title: 'Keep me' },
    ]);
  });

  it('does not append the same message id twice during a retry', async () => {
    const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());
    const session = await repository.create('provider-a', 'Retryable');
    const message = {
      id: 'retry-user-1',
      role: 'user' as const,
      content: 'hello',
      timestamp: new Date('2026-09-05T00:00:00Z'),
    };

    await repository.appendMessages(session.id, [message]);
    await repository.appendMessages(session.id, [message]);

    await expect(repository.getMessages(session.id)).resolves.toEqual([message]);
  });

  it('renames only the requested session', async () => {
    const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());
    const session = await repository.create('provider-a');
    const other = await repository.create('provider-a', 'Other');

    await repository.rename(session.id, 'Renamed title');

    await expect(repository.get(session.id)).resolves.toMatchObject({ title: 'Renamed title' });
    await expect(repository.get(other.id)).resolves.toMatchObject({ title: 'Other' });
  });

  it('rejects renaming an unknown session', async () => {
    const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());

    await expect(repository.rename('missing', 'Nope')).rejects.toThrow('not found');
  });
});
