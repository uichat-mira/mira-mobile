import type { LocalKeyValueStore } from '../storage/localKeyValueStore';
import type { ConversationMemorySource, MemoryTurnLedger } from './types';

// Persisted idempotency ledger for processed conversation turns, mirroring
// Desktop Memory V1's `processed-turns.jsonl`.
//
// The ledger must never forget a processed turn: if it did, a later replay of
// the same canonical evidence could be consolidated a second time. Instead of
// one ever-growing document, the ledger is split into a fixed set of shards
// (`processed-turns.v1.00` .. `processed-turns.v1.3f`). A stable hash of the
// turn key picks exactly one shard, so:
// - no old turn is ever evicted;
// - `has()` reads a single shard;
// - `mark()` rewrites a single shard (no linear rewrite of all history);
// - shard count is fixed, so the key space stays bounded and predictable.
//
// Each shard stores only the compact set of processed turn keys — the full
// source and timestamp are not needed, because both `has()` and `mark()` only
// ask whether a key exists. This still uses only LocalKeyValueStore.

export const MEMORY_LEDGER_SHARD_COUNT = 64;
const SHARD_HEX_WIDTH = 2;

// Stable hash (FNV-1a, 32-bit) so a given source always maps to the same shard
// across runs and platforms. Depends only on the canonical key string, never on
// insertion order or process state.
export const hashMemoryTurnKey = (key: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    // FNV prime 16777619, kept in 32-bit unsigned range.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

export const memoryTurnKey = (source: ConversationMemorySource): string =>
  `${source.threadId}:${source.userMessageId}:${source.assistantMessageId}`;

export const memoryLedgerShardIndex = (key: string): number =>
  hashMemoryTurnKey(key) % MEMORY_LEDGER_SHARD_COUNT;

export const MEMORY_LEDGER_SHARD_PREFIX = 'mira.local-memory.processed-turns.v1.';

export const memoryLedgerShardKey = (shardIndex: number): string =>
  `${MEMORY_LEDGER_SHARD_PREFIX}${shardIndex
    .toString(16)
    .padStart(SHARD_HEX_WIDTH, '0')}`;

export const memoryLedgerShardKeys = (): string[] =>
  Array.from({ length: MEMORY_LEDGER_SHARD_COUNT }, (_, index) =>
    memoryLedgerShardKey(index),
  );

const writeQueues = new WeakMap<LocalKeyValueStore, Promise<void>>();

export class LocalMemoryTurnLedger implements MemoryTurnLedger {
  constructor(private readonly store: LocalKeyValueStore) {}

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const previous = writeQueues.get(this.store) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    writeQueues.set(
      this.store,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }

  private async readShard(shardKey: string): Promise<Set<string>> {
    const raw = await this.store.get(shardKey);
    if (!raw) return new Set();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new Error('Stored local memory ledger shard is not valid JSON');
    }
    if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
      throw new Error('Stored local memory ledger shard must be a string array');
    }
    return new Set(parsed as string[]);
  }

  // Reads go through the same serialization queue as writes so a reader can
  // never observe a partially written shard.
  has(source: ConversationMemorySource): Promise<boolean> {
    return this.enqueueWrite(async () => {
      const key = memoryTurnKey(source);
      const shardKey = memoryLedgerShardKey(memoryLedgerShardIndex(key));
      const keys = await this.readShard(shardKey);
      return keys.has(key);
    });
  }

  mark(source: ConversationMemorySource): Promise<void> {
    return this.enqueueWrite(async () => {
      const key = memoryTurnKey(source);
      const shardKey = memoryLedgerShardKey(memoryLedgerShardIndex(key));
      const keys = await this.readShard(shardKey);
      if (keys.has(key)) return;
      keys.add(key);
      await this.store.set(shardKey, JSON.stringify([...keys]));
    });
  }
}
