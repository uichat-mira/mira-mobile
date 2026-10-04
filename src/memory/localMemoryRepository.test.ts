import {
  LocalMemoryRepository,
  MEMORY_STATE_KEY,
  MEMORY_STORAGE_KEYS,
  MemoryStorageCorruptionError,
  type MemoryAuthorityState,
} from './localMemoryRepository';
import { validateMemoryPatchProposals } from './memoryPolicy';
import { FakeLocalKeyValueStore } from './testSupport/fakeLocalKeyValueStore';
import type { ConversationMemorySource } from './types';

const source: ConversationMemorySource = {
  type: 'conversation',
  threadId: 'thread-1',
  userMessageId: 'user-1',
  assistantMessageId: 'assistant-1',
};

const buildCreatePatch = (
  content: string,
  id: string,
  recordSource: ConversationMemorySource = source,
) => {
  const patches = validateMemoryPatchProposals({
    existing: [],
    source: recordSource,
    now: '2026-08-01T00:00:00.000Z',
    generateId: () => id,
    proposals: [
      {
        operation: 'create',
        kind: 'preference',
        content,
        confidence: 0.99,
        reason: 'explicit',
      },
    ],
  });
  return patches;
};

const readState = (store: FakeLocalKeyValueStore): MemoryAuthorityState => {
  const raw = store.raw(MEMORY_STATE_KEY);
  if (!raw) throw new Error('state document was not written');
  return JSON.parse(raw) as MemoryAuthorityState;
};

describe('LocalMemoryRepository', () => {
  it('persists records, tombstones and journal to dedicated keys', async () => {
    const store = new FakeLocalKeyValueStore();
    const repository = new LocalMemoryRepository(store);

    const created = await repository.apply(
      buildCreatePatch('用户偏好先看结论。', 'mem_1'),
    );
    expect(created).toEqual({ created: 1, replaced: 0, deleted: 0 });
    expect(await repository.list()).toHaveLength(1);

    expect(store.raw(MEMORY_STATE_KEY)).toContain('mem_1');
    expect(store.raw(MEMORY_STORAGE_KEYS.journal)).toContain('create');

    const deleted = await repository.apply([
      { operation: 'delete', targetId: 'mem_1', reason: 'user deleted' },
    ]);
    expect(deleted).toEqual({ created: 0, replaced: 0, deleted: 1 });
    expect(await repository.list()).toEqual([]);

    const state = readState(store);
    expect(state.records).toEqual([]);
    expect(state.tombstones.map(tombstone => tombstone.id)).toEqual(['mem_1']);
  });

  it('replaces a record in place without appending a duplicate', async () => {
    const store = new FakeLocalKeyValueStore();
    const repository = new LocalMemoryRepository(store);

    await repository.apply(buildCreatePatch('用户使用 macOS。', 'mem_1'));
    const existing = await repository.list();

    const patches = validateMemoryPatchProposals({
      existing,
      source,
      now: '2026-08-02T00:00:00.000Z',
      proposals: [
        {
          operation: 'replace',
          targetId: 'mem_1',
          kind: 'fact',
          content: '用户改用 Windows 11。',
          confidence: 0.99,
          reason: 'user corrected',
        },
      ],
    });
    const result = await repository.apply(patches);

    expect(result).toEqual({ created: 0, replaced: 1, deleted: 0 });
    const records = await repository.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe('mem_1');
    expect(records[0]?.content).toBe('用户改用 Windows 11。');
    expect(records[0]?.updatedAt).toBe('2026-08-02T00:00:00.000Z');
  });

  it('blocks resurrecting a record from the same old evidence after delete', async () => {
    const store = new FakeLocalKeyValueStore();
    const repository = new LocalMemoryRepository(store);

    await repository.apply(buildCreatePatch('用户偏好深色主题。', 'mem_1'));
    await repository.apply([
      { operation: 'delete', targetId: 'mem_1', reason: 'user deleted' },
    ]);

    // Replaying the identical content from the identical conversation source
    // must not recreate the record.
    const replay = await repository.apply(
      buildCreatePatch('用户偏好深色主题。', 'mem_2', source),
    );
    expect(replay).toEqual({ created: 0, replaced: 0, deleted: 0 });
    expect(await repository.list()).toEqual([]);
  });

  it('allows a fresh source to re-confirm the same content after delete', async () => {
    const store = new FakeLocalKeyValueStore();
    const repository = new LocalMemoryRepository(store);

    await repository.apply(buildCreatePatch('用户偏好深色主题。', 'mem_1'));
    await repository.apply([
      { operation: 'delete', targetId: 'mem_1', reason: 'user deleted' },
    ]);

    const freshSource: ConversationMemorySource = {
      type: 'conversation',
      threadId: 'thread-9',
      userMessageId: 'user-9',
      assistantMessageId: 'assistant-9',
    };
    const recreated = await repository.apply(
      buildCreatePatch('用户偏好深色主题。', 'mem_2', freshSource),
    );

    expect(recreated).toEqual({ created: 1, replaced: 0, deleted: 0 });
    const records = await repository.list();
    expect(records.map(record => record.id)).toEqual(['mem_2']);
  });

  it('skips a patch whose target no longer exists', async () => {
    const store = new FakeLocalKeyValueStore();
    const repository = new LocalMemoryRepository(store);

    const result = await repository.apply([
      { operation: 'delete', targetId: 'missing', reason: 'no target' },
    ]);
    expect(result).toEqual({ created: 0, replaced: 0, deleted: 0 });
    expect(store.raw(MEMORY_STATE_KEY)).toBeNull();
  });

  it('fails loudly on corrupt state instead of overwriting it', async () => {
    const store = new FakeLocalKeyValueStore();
    store.seed(MEMORY_STATE_KEY, '{ not valid json');
    const repository = new LocalMemoryRepository(store);

    await expect(repository.list()).rejects.toBeInstanceOf(
      MemoryStorageCorruptionError,
    );
    // The corrupt document remains untouched for manual recovery.
    expect(store.raw(MEMORY_STATE_KEY)).toBe('{ not valid json');
    await expect(repository.apply(buildCreatePatch('新记忆。', 'mem_1'))).rejects.toBeInstanceOf(
      MemoryStorageCorruptionError,
    );
    expect(store.raw(MEMORY_STATE_KEY)).toBe('{ not valid json');
  });

  it('fails loudly on a structurally invalid record', async () => {
    const store = new FakeLocalKeyValueStore();
    store.seed(
      MEMORY_STATE_KEY,
      JSON.stringify({ records: [{ id: 'mem_1' }], tombstones: [] }),
    );
    const repository = new LocalMemoryRepository(store);

    await expect(repository.list()).rejects.toBeInstanceOf(
      MemoryStorageCorruptionError,
    );
  });

  it('fails loudly on corrupt settings', async () => {
    const store = new FakeLocalKeyValueStore();
    store.seed(MEMORY_STORAGE_KEYS.settings, JSON.stringify({ enabled: 'yes' }));
    const repository = new LocalMemoryRepository(store);

    await expect(repository.getSettings()).rejects.toBeInstanceOf(
      MemoryStorageCorruptionError,
    );
  });

  it('serializes concurrent writes so no record is lost', async () => {
    const store = new FakeLocalKeyValueStore();
    const repository = new LocalMemoryRepository(store);

    const contents = Array.from({ length: 12 }, (_, index) => `并发条目 ${index}。`);
    await Promise.all(
      contents.map((content, index) =>
        repository.apply(buildCreatePatch(content, `mem_${index}`)),
      ),
    );

    const records = await repository.list();
    expect(records).toHaveLength(contents.length);
    const seen = new Set(records.map(record => record.content));
    for (const content of contents) {
      expect(seen.has(content)).toBe(true);
    }
  });

  it('does not write any document when every patch is skipped', async () => {
    const store = new FakeLocalKeyValueStore();
    const repository = new LocalMemoryRepository(store);

    await repository.apply([
      { operation: 'delete', targetId: 'missing', reason: 'no target' },
    ]);

    expect(store.raw(MEMORY_STATE_KEY)).toBeNull();
    expect(store.raw(MEMORY_STORAGE_KEYS.journal)).toBeNull();
  });

  it('keeps delete evidence beyond the former 500-tombstone threshold', async () => {
    const store = new FakeLocalKeyValueStore();
    const repository = new LocalMemoryRepository(store);

    // Create and delete far more than the old 500-entry retention window. Each
    // record carries its own conversation source so the earliest tombstone keeps
    // exact evidence to compare against on replay.
    const total = 520;
    const sourceFor = (index: number): ConversationMemorySource => ({
      type: 'conversation',
      threadId: `thread-${index}`,
      userMessageId: `user-${index}`,
      assistantMessageId: `assistant-${index}`,
    });
    for (let index = 0; index < total; index += 1) {
      await repository.apply(
        buildCreatePatch(`待删除条目 ${index}。`, `mem_${index}`, sourceFor(index)),
      );
    }
    for (let index = 0; index < total; index += 1) {
      await repository.apply([
        { operation: 'delete', targetId: `mem_${index}`, reason: 'cleanup' },
      ]);
    }

    const state = readState(store);
    expect(state.tombstones).toHaveLength(total);

    // The earliest delete must still block the same old evidence forever.
    const replay = await repository.apply(
      buildCreatePatch('待删除条目 0。', 'mem_revive', sourceFor(0)),
    );
    expect(replay).toEqual({ created: 0, replaced: 0, deleted: 0 });
    expect(await repository.list()).toEqual([]);
  });

  it('commits records and tombstones atomically with a single state write', async () => {
    const store = new FakeLocalKeyValueStore();
    const repository = new LocalMemoryRepository(store);

    await repository.apply(buildCreatePatch('用户偏好简洁回复。', 'mem_1'));

    const setSpy = jest.spyOn(store, 'set');
    await repository.apply([
      { operation: 'delete', targetId: 'mem_1', reason: 'user deleted' },
    ]);
    const stateWrites = setSpy.mock.calls.filter(
      ([key]) => key === MEMORY_STATE_KEY,
    );
    setSpy.mockRestore();

    expect(stateWrites).toHaveLength(1);
    const state = readState(store);
    expect(state.records).toEqual([]);
    expect(state.tombstones.map(tombstone => tombstone.id)).toEqual(['mem_1']);
  });

  it('does not leave a records/tombstone half-commit when the core write fails', async () => {
    const store = new FakeLocalKeyValueStore();
    const repository = new LocalMemoryRepository(store);

    await repository.apply(buildCreatePatch('用户偏好深色主题。', 'mem_1'));
    const before = store.raw(MEMORY_STATE_KEY);

    // Fail the authoritative state write itself; the delete must not be
    // partially applied (record removed but tombstone missing, or vice versa).
    const originalSet = store.set.bind(store);
    jest.spyOn(store, 'set').mockImplementation(async (key: string, value: string) => {
      if (key === MEMORY_STATE_KEY) {
        throw new Error('simulated core state write failure');
      }
      await originalSet(key, value);
    });

    await expect(
      repository.apply([
        { operation: 'delete', targetId: 'mem_1', reason: 'user deleted' },
      ]),
    ).rejects.toThrow('simulated core state write failure');

    // The authoritative document is exactly what it was before the failed
    // write: the record is still present and no tombstone exists.
    expect(store.raw(MEMORY_STATE_KEY)).toBe(before);
    const records = await repository.list();
    expect(records.map(record => record.id)).toEqual(['mem_1']);
  });

  it('keeps authoritative state durable when the journal write fails', async () => {
    const store = new FakeLocalKeyValueStore();
    const repository = new LocalMemoryRepository(store);

    const originalSet = store.set.bind(store);
    jest.spyOn(store, 'set').mockImplementation(async (key: string, value: string) => {
      if (key === MEMORY_STORAGE_KEYS.journal) {
        throw new Error('simulated journal write failure');
      }
      await originalSet(key, value);
    });

    // A journal failure is non-authoritative and must not fail the commit.
    const result = await repository.apply(
      buildCreatePatch('用户偏好简短回复。', 'mem_1'),
    );
    expect(result).toEqual({ created: 1, replaced: 0, deleted: 0 });
    expect(await repository.list()).toHaveLength(1);
  });
});
