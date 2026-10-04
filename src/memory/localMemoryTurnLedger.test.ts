import {
  LocalMemoryTurnLedger,
  MEMORY_LEDGER_SHARD_COUNT,
  memoryLedgerShardIndex,
  memoryLedgerShardKey,
  memoryLedgerShardKeys,
  memoryTurnKey,
} from './localMemoryTurnLedger';
import { FakeLocalKeyValueStore } from './testSupport/fakeLocalKeyValueStore';
import type { ConversationMemorySource } from './types';

const source: ConversationMemorySource = {
  type: 'conversation',
  threadId: 'thread-1',
  userMessageId: 'user-1',
  assistantMessageId: 'assistant-1',
};

const sourceAt = (index: number): ConversationMemorySource => ({
  type: 'conversation',
  threadId: `thread-${index}`,
  userMessageId: `user-${index}`,
  assistantMessageId: `assistant-${index}`,
});

const shardKeyFor = (turn: ConversationMemorySource): string =>
  memoryLedgerShardKey(memoryLedgerShardIndex(memoryTurnKey(turn)));

const readShard = (store: FakeLocalKeyValueStore, shardKey: string): string[] => {
  const raw = store.raw(shardKey);
  return raw ? (JSON.parse(raw) as string[]) : [];
};

describe('LocalMemoryTurnLedger', () => {
  it('reports processed and unprocessed turns', async () => {
    const store = new FakeLocalKeyValueStore();
    const ledger = new LocalMemoryTurnLedger(store);

    expect(await ledger.has(source)).toBe(false);
    await ledger.mark(source);
    expect(await ledger.has(source)).toBe(true);

    expect(await ledger.has(sourceAt(2))).toBe(false);
  });

  it('stores only the compact key set in a shard', async () => {
    const store = new FakeLocalKeyValueStore();
    const ledger = new LocalMemoryTurnLedger(store);

    await ledger.mark(source);

    const keys = readShard(store, shardKeyFor(source));
    expect(keys).toEqual([memoryTurnKey(source)]);
  });

  it('is idempotent when the same turn is marked repeatedly', async () => {
    const store = new FakeLocalKeyValueStore();
    const ledger = new LocalMemoryTurnLedger(store);

    await Promise.all([ledger.mark(source), ledger.mark(source), ledger.mark(source)]);

    expect(readShard(store, shardKeyFor(source))).toEqual([memoryTurnKey(source)]);
  });

  it('maps different turns to their own shards deterministically', () => {
    const seen = new Map<number, string[]>();
    for (let index = 0; index < 400; index += 1) {
      const key = memoryTurnKey(sourceAt(index));
      const shard = memoryLedgerShardIndex(key);
      expect(shard).toBeGreaterThanOrEqual(0);
      expect(shard).toBeLessThan(MEMORY_LEDGER_SHARD_COUNT);
      // Deterministic: the same key always lands in the same shard.
      expect(memoryLedgerShardIndex(key)).toBe(shard);
      seen.set(shard, [...(seen.get(shard) ?? []), key]);
    }
    // A healthy spread: 400 turns should not all collapse into one shard.
    expect(seen.size).toBeGreaterThan(1);
  });

  it('uses the full fixed shard key space with zero-padded hex names', () => {
    const shardKeys = memoryLedgerShardKeys();
    expect(shardKeys).toHaveLength(MEMORY_LEDGER_SHARD_COUNT);
    expect(shardKeys[0]).toBe('mira.local-memory.processed-turns.v1.00');
    expect(shardKeys[MEMORY_LEDGER_SHARD_COUNT - 1]).toBe(
      'mira.local-memory.processed-turns.v1.3f',
    );
    expect(new Set(shardKeys).size).toBe(MEMORY_LEDGER_SHARD_COUNT);
  });

  it('writes only the target shard when marking', async () => {
    const store = new FakeLocalKeyValueStore();
    const setSpy = jest.spyOn(store, 'set');
    const ledger = new LocalMemoryTurnLedger(store);

    await ledger.mark(source);

    const writtenKeys = setSpy.mock.calls.map(([key]) => key);
    setSpy.mockRestore();

    expect(writtenKeys).toEqual([shardKeyFor(source)]);
  });

  it('reads only the target shard when checking', async () => {
    const store = new FakeLocalKeyValueStore();
    const ledger = new LocalMemoryTurnLedger(store);
    await ledger.mark(source);

    const getSpy = jest.spyOn(store, 'get');
    await ledger.has(source);
    const readKeys = getSpy.mock.calls.map(([key]) => key);
    getSpy.mockRestore();

    expect(readKeys).toEqual([shardKeyFor(source)]);
  });

  it('keeps the earliest processed turn after 1000+ turns', async () => {
    const store = new FakeLocalKeyValueStore();
    const ledger = new LocalMemoryTurnLedger(store);

    const total = 1200;
    for (let index = 0; index < total; index += 1) {
      await ledger.mark(sourceAt(index));
    }

    // The very first turn is still remembered as processed.
    expect(await ledger.has(sourceAt(0))).toBe(true);
    expect(await ledger.has(sourceAt(total - 1))).toBe(true);

    // Every turn is persisted exactly once across the shards.
    const persisted = memoryLedgerShardKeys().flatMap(shardKey =>
      readShard(store, shardKey),
    );
    expect(persisted).toHaveLength(total);
    expect(new Set(persisted).size).toBe(total);
  });

  it('fails loudly on a corrupt ledger shard', async () => {
    const store = new FakeLocalKeyValueStore();
    store.seed(shardKeyFor(source), 'not-valid-json');
    const ledger = new LocalMemoryTurnLedger(store);

    await expect(ledger.has(source)).rejects.toThrow(
      'Stored local memory ledger shard is not valid JSON',
    );
  });

  it('fails loudly on a structurally invalid ledger shard', async () => {
    const store = new FakeLocalKeyValueStore();
    store.seed(shardKeyFor(source), JSON.stringify({ entries: [] }));
    const ledger = new LocalMemoryTurnLedger(store);

    await expect(ledger.has(source)).rejects.toThrow(
      'Stored local memory ledger shard must be a string array',
    );
  });
});
