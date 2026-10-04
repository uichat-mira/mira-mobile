// Mobile Local Memory Kernel V1 domain contract.
//
// This mirrors the platform-independent semantics of Mira Desktop Memory V1
// (`mira-desktop/server/src/memory/types.ts`) so that Mobile and Desktop share
// one Memory contract. Only storage / runtime concerns are re-implemented on
// Mobile; the domain types below intentionally stay isomorphic.
//
// Hard boundary: this memory belongs to the Mobile Local Provider path only.
// It never reads, writes or syncs Remote Host memory.

export type MemoryKind = 'preference' | 'fact' | 'decision' | 'constraint';

export interface ConversationMemorySource {
  type: 'conversation';
  threadId: string;
  userMessageId: string;
  assistantMessageId: string;
}

export interface ManualMemorySource {
  type: 'manual';
  operationId: string;
}

export type MemorySource = ConversationMemorySource | ManualMemorySource;

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  content: string;
  sources: MemorySource[];
  createdAt: string;
  updatedAt: string;
}

export type MemoryPatchProposal =
  | {
      operation: 'create';
      kind: MemoryKind;
      content: string;
      confidence: number;
      reason: string;
    }
  | {
      operation: 'replace';
      targetId: string;
      kind: MemoryKind;
      content: string;
      confidence: number;
      reason: string;
    }
  | {
      operation: 'delete';
      targetId: string;
      confidence: number;
      reason: string;
    };

export type ValidatedMemoryPatch =
  | {
      operation: 'create';
      record: MemoryRecord;
      reason: string;
    }
  | {
      operation: 'replace';
      targetId: string;
      record: MemoryRecord;
      reason: string;
    }
  | {
      operation: 'delete';
      targetId: string;
      reason: string;
    };

export interface ConsolidationInput {
  source: ConversationMemorySource;
  userText: string;
  assistantText: string;
  existing: MemoryRecord[];
}

export interface MemoryConsolidator {
  propose(input: ConsolidationInput): Promise<MemoryPatchProposal[]>;
}

export interface MemoryTurnLedger {
  has(source: ConversationMemorySource): Promise<boolean>;
  mark(source: ConversationMemorySource): Promise<void>;
}

export interface MemorySettings {
  enabled: boolean;
}

export interface MemoryContextSnapshot {
  content: string;
  updatedAt: string | null;
  recordCount: number;
}

export interface MemoryApplyResult {
  created: number;
  replaced: number;
  deleted: number;
}

export interface MemoryOverviewRecord {
  id: string;
  kind: MemoryKind;
  content: string;
  origin: MemorySource['type'];
  createdAt: string;
  updatedAt: string;
}

export interface MemoryOverview {
  enabled: boolean;
  records: MemoryOverviewRecord[];
}

export interface MemoryTombstone {
  id: string;
  content: string;
  normalizedContent: string;
  sources: MemorySource[];
  deletedAt: string;
}

export interface MemoryJournalEntry {
  operation: ValidatedMemoryPatch['operation'];
  reason: string;
  committedAt: string;
  record?: MemoryRecord;
  previous?: MemoryRecord;
}
