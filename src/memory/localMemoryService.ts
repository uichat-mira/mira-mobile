import type { LocalMemoryRepository } from './localMemoryRepository';
import { memoryTurnKey } from './localMemoryTurnLedger';
import {
  createManualOperationId,
  validateMemoryPatchProposals,
} from './memoryPolicy';
import type {
  ConversationMemorySource,
  MemoryApplyResult,
  MemoryConsolidator,
  MemoryContextSnapshot,
  MemoryKind,
  MemoryOverview,
  MemoryOverviewRecord,
  MemoryRecord,
  MemoryTurnCommitResult,
  MemoryTurnLedger,
} from './types';

// Mobile Local Memory service. Orchestration semantics are ported from Desktop
// Memory V1 (`mira-desktop/server/src/memory/memory.service.ts`):
// - the repository is the single source of truth;
// - the model may only propose patches, validated by the deterministic policy;
// - manual CRUD flows through the exact same policy and repository path;
// - commits are serialized so concurrent writers cannot interleave;
// - a processed-turn ledger makes per-turn consolidation idempotent.

export const MAX_CONTEXT_RECORDS = 40;
export const MAX_CONTEXT_CHARACTERS = 6000;

const EMPTY_APPLY_RESULT: MemoryApplyResult = {
  created: 0,
  replaced: 0,
  deleted: 0,
};

const EMPTY_CONTEXT: MemoryContextSnapshot = {
  content: '',
  updatedAt: null,
  recordCount: 0,
};

const KIND_LABELS: Record<MemoryKind, string> = {
  preference: '偏好',
  fact: '长期事实',
  decision: '决定',
  constraint: '约束',
};

const buildSnapshot = (
  records: MemoryRecord[],
  updatedAt: string | null,
): MemoryContextSnapshot => {
  const sorted = [...records].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  const lines: string[] = [];
  let length = 0;

  for (const record of sorted.slice(0, MAX_CONTEXT_RECORDS)) {
    const line = `- [${KIND_LABELS[record.kind]}] ${record.content}`;
    const nextLength = length + line.length + (lines.length > 0 ? 1 : 0);
    if (nextLength > MAX_CONTEXT_CHARACTERS) break;
    lines.push(line);
    length = nextLength;
  }

  return {
    content: lines.join('\n'),
    updatedAt,
    recordCount: lines.length,
  };
};

const toOverviewRecord = (record: MemoryRecord): MemoryOverviewRecord => ({
  id: record.id,
  kind: record.kind,
  content: record.content,
  origin: record.sources.some(source => source.type === 'manual')
    ? 'manual'
    : 'conversation',
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

export class LocalMemoryService {
  private readonly commitQueues = new WeakMap<
    LocalMemoryRepository,
    Promise<void>
  >();
  private readonly inFlightTurnCommits = new Map<
    string,
    Promise<MemoryTurnCommitResult>
  >();

  constructor(
    private readonly repository: LocalMemoryRepository,
    private readonly turnLedger: MemoryTurnLedger,
  ) {}

  private runCommitSerialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.commitQueues.get(this.repository) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      await this.recoverPendingCommit();
      return operation();
    });
    this.commitQueues.set(
      this.repository,
      current.then(
        () => undefined,
        () => undefined,
      ),
    );
    return current;
  }

  private async recoverPendingCommit(): Promise<void> {
    const pending = await this.repository.getPendingCommitIntent();
    if (!pending) return;

    if (!(await this.turnLedger.has(pending.source))) {
      if (pending.patches.length > 0) {
        await this.repository.apply(pending.patches);
      }
      await this.turnLedger.mark(pending.source);
    }
    await this.repository.clearPendingCommitIntent();
  }

  private async readOverview(): Promise<MemoryOverview> {
    const [settings, records] = await Promise.all([
      this.repository.getSettings(),
      this.repository.list(),
    ]);
    return {
      enabled: settings.enabled,
      records: records
        .map(toOverviewRecord)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    };
  }

  getOverview(): Promise<MemoryOverview> {
    return this.runCommitSerialized(() => this.readOverview());
  }

  /** Whether this canonical turn was already consolidated (successfully). */
  isProcessed(source: ConversationMemorySource): Promise<boolean> {
    return this.runCommitSerialized(() => this.turnLedger.has(source));
  }

  setEnabled(enabled: boolean): Promise<MemoryOverview> {
    return this.runCommitSerialized(async () => {
      await this.repository.updateSettings({ enabled });
      return this.readOverview();
    });
  }

  buildContext(): Promise<MemoryContextSnapshot> {
    return this.runCommitSerialized(async () => {
      if (!(await this.repository.getSettings()).enabled) {
        return { ...EMPTY_CONTEXT };
      }
      return buildSnapshot(
        await this.repository.list(),
        await this.repository.updatedAt(),
      );
    });
  }

  /**
   * Consolidate one completed turn.
   *
   * The `consolidator` is a per-turn, scoped dependency: the caller supplies the
   * Provider-backed consolidator bound to the exact Local Provider client /
   * model that produced this turn. The service never retains it, so concurrent
   * commits from different sessions can never observe each other's Provider.
   *
   * Returns `{ applied, processed }`. `processed` is false when consolidation
   * itself failed (provider error / invalid JSON / empty output), which leaves
   * the turn eligible for a later retry.
   */
  async commitTurn(input: {
    source: ConversationMemorySource;
    userText: string;
    assistantText: string;
    consolidator: MemoryConsolidator;
  }): Promise<MemoryTurnCommitResult> {
    const userText = input.userText.trim();
    const assistantText = input.assistantText.trim();
    if (!userText || !assistantText) {
      return { applied: { ...EMPTY_APPLY_RESULT }, processed: false };
    }

    const key = memoryTurnKey(input.source);
    const existingCommit = this.inFlightTurnCommits.get(key);
    if (existingCommit) return existingCommit;

    const commit = this.commitTurnOnce({
      ...input,
      userText,
      assistantText,
    });
    this.inFlightTurnCommits.set(key, commit);
    try {
      return await commit;
    } finally {
      if (this.inFlightTurnCommits.get(key) === commit) {
        this.inFlightTurnCommits.delete(key);
      }
    }
  }

  private async commitTurnOnce(input: {
    source: ConversationMemorySource;
    userText: string;
    assistantText: string;
    consolidator: MemoryConsolidator;
  }): Promise<MemoryTurnCommitResult> {
    const preflight = await this.runCommitSerialized(async () => {
      if (await this.turnLedger.has(input.source)) {
        return { kind: 'processed' as const };
      }

      if (!(await this.repository.getSettings()).enabled) {
        await this.turnLedger.mark(input.source);
        return { kind: 'processed' as const };
      }

      return {
        kind: 'propose' as const,
        existing: await this.repository.list(),
      };
    });

    if (preflight.kind === 'processed') {
      return { applied: { ...EMPTY_APPLY_RESULT }, processed: true };
    }

    // The Provider/model call is intentionally outside the Memory mutation
    // critical section. A slow consolidation must not block manual Memory CRUD,
    // settings changes, or unrelated turn commits.
    const proposals = await input.consolidator.propose({
      source: input.source,
      userText: input.userText,
      assistantText: input.assistantText,
      existing: preflight.existing,
    });
    if (proposals === null) {
      return { applied: { ...EMPTY_APPLY_RESULT }, processed: false };
    }

    return this.runCommitSerialized(async () => {
      if (await this.turnLedger.has(input.source)) {
        return { applied: { ...EMPTY_APPLY_RESULT }, processed: true };
      }

      // Memory may have been disabled or manually edited while the Provider was
      // consolidating. Re-check settings and revalidate against current state.
      if (!(await this.repository.getSettings()).enabled) {
        await this.turnLedger.mark(input.source);
        return { applied: { ...EMPTY_APPLY_RESULT }, processed: true };
      }

      const existing = await this.repository.list();
      const patches = validateMemoryPatchProposals({
        proposals,
        existing,
        source: input.source,
      });

      // Persist the exact validated commit intent before touching authoritative
      // Memory state. If the process dies between state apply and ledger mark,
      // the next Memory access replays this idempotent intent, marks the ledger,
      // then clears it. No half-written state is exposed after recovery.
      await this.repository.setPendingCommitIntent({
        source: input.source,
        patches,
      });

      const applied =
        patches.length > 0
          ? await this.repository.apply(patches)
          : { ...EMPTY_APPLY_RESULT };
      await this.turnLedger.mark(input.source);
      await this.repository.clearPendingCommitIntent();
      return { applied, processed: true };
    });
  }

  async createManual(input: {
    kind: MemoryKind;
    content: string;
  }): Promise<MemoryOverview> {
    return this.runCommitSerialized(async () => {
      const existing = await this.repository.list();
      const patches = validateMemoryPatchProposals({
        existing,
        source: { type: 'manual', operationId: createManualOperationId() },
        proposals: [
          {
            operation: 'create',
            kind: input.kind,
            content: input.content,
            confidence: 1,
            reason: '用户通过 Mobile 记忆设置明确新增记忆',
          },
        ],
      });
      if (patches.length > 0) {
        await this.repository.apply(patches);
      }
      return this.readOverview();
    });
  }

  async updateManual(
    id: string,
    input: { kind: MemoryKind; content: string },
  ): Promise<MemoryOverview | null> {
    return this.runCommitSerialized(async () => {
      const existing = await this.repository.list();
      if (!existing.some(record => record.id === id)) return null;

      const patches = validateMemoryPatchProposals({
        existing,
        source: { type: 'manual', operationId: createManualOperationId() },
        proposals: [
          {
            operation: 'replace',
            targetId: id,
            kind: input.kind,
            content: input.content,
            confidence: 1,
            reason: '用户通过 Mobile 记忆设置明确修改记忆',
          },
        ],
      });
      if (patches.length > 0) {
        await this.repository.apply(patches);
      }
      return this.readOverview();
    });
  }

  async deleteManual(id: string): Promise<MemoryOverview | null> {
    return this.runCommitSerialized(async () => {
      const existing = await this.repository.list();
      if (!existing.some(record => record.id === id)) return null;

      const patches = validateMemoryPatchProposals({
        existing,
        source: { type: 'manual', operationId: createManualOperationId() },
        proposals: [
          {
            operation: 'delete',
            targetId: id,
            confidence: 1,
            reason: '用户通过 Mobile 记忆设置明确删除记忆',
          },
        ],
      });
      if (patches.length > 0) {
        await this.repository.apply(patches);
      }
      return this.readOverview();
    });
  }
}
