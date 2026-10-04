import type { LocalKeyValueStore } from '../storage/localKeyValueStore';
import { isSameMemorySource, normalizeMemoryContent } from './memoryPolicy';
import type {
  MemoryApplyResult,
  MemoryJournalEntry,
  MemoryKind,
  MemoryRecord,
  MemorySettings,
  MemorySource,
  MemoryTombstone,
  ValidatedMemoryPatch,
} from './types';

// Mobile Local Memory persistence.
//
// Desktop Memory V1 keeps the record document plus append-only journals under a
// user directory. Mobile has a single key-value primitive, so this repository
// re-implements the same persistence semantics on top of distinct storage keys.
//
// Authoritative state (records + tombstones) lives in ONE document and is
// committed with a single `store.set`. Desktop atomically renames MEMORY.md and
// then appends tombstones; Mobile keeps the same invariant — records and
// tombstones can never diverge — by making them a single atomic unit. The
// journal is a non-authoritative audit log written on a best-effort basis.
//
// Guarantees carried over from Desktop:
// - writes are serialized per store, so concurrent callers cannot interleave;
// - malformed persisted data fails loudly instead of being silently rewritten;
// - a patch whose target / dedupe / tombstone checks fail is skipped, and the
//   authoritative document is left untouched;
// - deletes leave a tombstone so the same old evidence cannot resurrect a
//   record, while a genuinely new source can re-confirm the same content;
// - tombstones are never dropped on a count threshold, so delete evidence does
//   not expire and old conversation evidence can never revive a deleted memory.

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = { enabled: true };

// Authoritative document holding records and tombstones as one atomic unit.
export const MEMORY_STATE_KEY = 'mira.local-memory.state.v1';
export const MEMORY_STORAGE_KEYS = {
  state: MEMORY_STATE_KEY,
  settings: 'mira.local-memory.settings.v1',
  journal: 'mira.local-memory.journal.v1',
} as const;

// The journal is non-authoritative audit data, so a bounded retention window is
// acceptable here: losing old journal entries never changes memory behaviour.
const MAX_JOURNAL_ENTRIES = 500;

export class MemoryStorageCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryStorageCorruptionError';
  }
}

export interface MemoryAuthorityState {
  records: MemoryRecord[];
  tombstones: MemoryTombstone[];
}

const EMPTY_STATE: MemoryAuthorityState = { records: [], tombstones: [] };

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new MemoryStorageCorruptionError(
      'Stored local memory document is not valid JSON',
    );
  }
};

const isMemoryKind = (value: unknown): value is MemoryKind =>
  value === 'preference' ||
  value === 'fact' ||
  value === 'decision' ||
  value === 'constraint';

const parseMemorySource = (value: unknown): MemorySource | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  if (source.type === 'manual') {
    return typeof source.operationId === 'string' && source.operationId.trim()
      ? { type: 'manual', operationId: source.operationId }
      : null;
  }
  if (
    source.type === 'conversation' &&
    typeof source.threadId === 'string' &&
    typeof source.userMessageId === 'string' &&
    typeof source.assistantMessageId === 'string'
  ) {
    return {
      type: 'conversation',
      threadId: source.threadId,
      userMessageId: source.userMessageId,
      assistantMessageId: source.assistantMessageId,
    };
  }
  return null;
};

const parseMemorySources = (value: unknown): MemorySource[] | null => {
  if (!Array.isArray(value)) return null;
  const parsed = value.map(parseMemorySource);
  return parsed.every((source): source is MemorySource => source !== null)
    ? parsed
    : null;
};

const parseMemoryRecord = (value: unknown): MemoryRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const sources = parseMemorySources(record.sources);
  if (
    typeof record.id !== 'string' ||
    !record.id ||
    !isMemoryKind(record.kind) ||
    typeof record.content !== 'string' ||
    !record.content.trim() ||
    !sources ||
    typeof record.createdAt !== 'string' ||
    typeof record.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    id: record.id,
    kind: record.kind,
    content: record.content,
    sources,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
};

const parseTombstone = (value: unknown): MemoryTombstone | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const sources = parseMemorySources(record.sources);
  if (
    typeof record.id !== 'string' ||
    typeof record.content !== 'string' ||
    typeof record.normalizedContent !== 'string' ||
    !sources ||
    typeof record.deletedAt !== 'string'
  ) {
    return null;
  }
  return {
    id: record.id,
    content: record.content,
    normalizedContent: record.normalizedContent,
    sources,
    deletedAt: record.deletedAt,
  };
};

const parseStateDocument = (value: string): MemoryAuthorityState => {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new MemoryStorageCorruptionError(
      'Stored local memory state must be an object',
    );
  }
  const document = parsed as Record<string, unknown>;
  if (!Array.isArray(document.records) || !Array.isArray(document.tombstones)) {
    throw new MemoryStorageCorruptionError(
      'Stored local memory state is incomplete',
    );
  }
  const records = document.records.map((item, index) => {
    const record = parseMemoryRecord(item);
    if (!record) {
      throw new MemoryStorageCorruptionError(
        `Stored local memory record at index ${index} is invalid`,
      );
    }
    return record;
  });
  const tombstones = document.tombstones.map((item, index) => {
    const tombstone = parseTombstone(item);
    if (!tombstone) {
      throw new MemoryStorageCorruptionError(
        `Stored local memory tombstone at index ${index} is invalid`,
      );
    }
    return tombstone;
  });
  return { records, tombstones };
};

const parseSettings = (value: string): MemorySettings => {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new MemoryStorageCorruptionError(
      'Stored local memory settings must be an object',
    );
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.enabled !== 'boolean') {
    throw new MemoryStorageCorruptionError(
      'Stored local memory settings are incomplete',
    );
  }
  return { enabled: record.enabled };
};

const writeQueues = new WeakMap<LocalKeyValueStore, Promise<void>>();

export class LocalMemoryRepository {
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

  private async readState(): Promise<MemoryAuthorityState> {
    const raw = await this.store.get(MEMORY_STATE_KEY);
    if (!raw) return { ...EMPTY_STATE };
    return parseStateDocument(raw);
  }

  getSettings(): Promise<MemorySettings> {
    return this.enqueueWrite(async () => {
      const raw = await this.store.get(MEMORY_STORAGE_KEYS.settings);
      if (!raw) return { ...DEFAULT_MEMORY_SETTINGS };
      return parseSettings(raw);
    });
  }

  updateSettings(update: Partial<MemorySettings>): Promise<MemorySettings> {
    return this.enqueueWrite(async () => {
      const raw = await this.store.get(MEMORY_STORAGE_KEYS.settings);
      const current = raw ? parseSettings(raw) : { ...DEFAULT_MEMORY_SETTINGS };
      const next: MemorySettings = {
        enabled:
          typeof update.enabled === 'boolean' ? update.enabled : current.enabled,
      };
      await this.store.set(
        MEMORY_STORAGE_KEYS.settings,
        JSON.stringify(next),
      );
      return next;
    });
  }

  list(): Promise<MemoryRecord[]> {
    return this.enqueueWrite(async () => (await this.readState()).records);
  }

  async updatedAt(): Promise<string | null> {
    const state = await this.enqueueWrite(() => this.readState());
    let latest: string | null = null;
    for (const record of state.records) {
      if (latest === null || record.updatedAt > latest) latest = record.updatedAt;
    }
    return latest;
  }

  apply(patches: ValidatedMemoryPatch[]): Promise<MemoryApplyResult> {
    return this.enqueueWrite(async () => {
      const state = await this.readState();
      let records = state.records;
      const tombstones = state.tombstones;
      const result: MemoryApplyResult = { created: 0, replaced: 0, deleted: 0 };
      const journalEntries: MemoryJournalEntry[] = [];
      const newTombstones: MemoryTombstone[] = [];

      for (const patch of patches) {
        if (patch.operation === 'create') {
          const normalized = normalizeMemoryContent(patch.record.content);
          const alreadyExists = records.some(
            record => normalizeMemoryContent(record.content) === normalized,
          );
          const replaysDeletedEvidence = tombstones.some(
            tombstone =>
              tombstone.normalizedContent === normalized &&
              patch.record.sources.some(source =>
                tombstone.sources.some(deletedSource =>
                  isSameMemorySource(source, deletedSource),
                ),
              ),
          );
          if (alreadyExists || replaysDeletedEvidence) continue;

          records = [...records, patch.record];
          result.created += 1;
          journalEntries.push({
            operation: patch.operation,
            record: patch.record,
            reason: patch.reason,
            committedAt: new Date().toISOString(),
          });
          continue;
        }

        const target = records.find(record => record.id === patch.targetId);
        if (!target) continue;

        if (patch.operation === 'replace') {
          records = records.map(record =>
            record.id === target.id ? patch.record : record,
          );
          result.replaced += 1;
          journalEntries.push({
            operation: patch.operation,
            previous: target,
            record: patch.record,
            reason: patch.reason,
            committedAt: new Date().toISOString(),
          });
          continue;
        }

        records = records.filter(record => record.id !== target.id);
        newTombstones.push({
          id: target.id,
          content: target.content,
          normalizedContent: normalizeMemoryContent(target.content),
          sources: target.sources,
          deletedAt: new Date().toISOString(),
        });
        result.deleted += 1;
        journalEntries.push({
          operation: patch.operation,
          previous: target,
          reason: patch.reason,
          committedAt: new Date().toISOString(),
        });
      }

      const changed = result.created + result.replaced + result.deleted;
      if (changed === 0) return result;

      // Commit records + tombstones atomically as one document. Tombstones are
      // append-only and deduplicated by id; they are never dropped on a count
      // threshold, so delete evidence never expires.
      const nextState: MemoryAuthorityState = {
        records,
        tombstones: dedupeTombstones([...tombstones, ...newTombstones]),
      };
      await this.store.set(MEMORY_STATE_KEY, JSON.stringify(nextState));

      // Audit log is best-effort: a failure here must not surface as a failed
      // commit, because authoritative state is already durable.
      try {
        await this.appendJournal(journalEntries);
      } catch {
        // Intentionally swallowed; journal is non-authoritative.
      }

      return result;
    });
  }

  private async appendJournal(entries: MemoryJournalEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const raw = await this.store.get(MEMORY_STORAGE_KEYS.journal);
    let current: MemoryJournalEntry[] = [];
    if (raw) {
      const parsed = parseJson(raw);
      if (!Array.isArray(parsed)) {
        throw new MemoryStorageCorruptionError(
          'Stored local memory journal must be an array',
        );
      }
      current = parsed as MemoryJournalEntry[];
    }
    const next = [...current, ...entries].slice(-MAX_JOURNAL_ENTRIES);
    await this.store.set(MEMORY_STORAGE_KEYS.journal, JSON.stringify(next));
  }
}

// Tombstones are keyed by the deleted record id. Re-deleting the same id (only
// possible across separate apply calls) refreshes the entry instead of growing
// a duplicate, keeping the append-only document stable without a count cap.
const dedupeTombstones = (
  tombstones: MemoryTombstone[],
): MemoryTombstone[] => {
  const byId = new Map<string, MemoryTombstone>();
  for (const tombstone of tombstones) {
    byId.set(tombstone.id, tombstone);
  }
  return [...byId.values()];
};
