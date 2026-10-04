import type { LocalMemoryRepository } from './localMemoryRepository';
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

  constructor(
    private readonly repository: LocalMemoryRepository,
    private readonly consolidator: MemoryConsolidator,
    private readonly turnLedger: MemoryTurnLedger,
  ) {}

  private runCommitSerialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.commitQueues.get(this.repository) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.commitQueues.set(
      this.repository,
      current.then(
        () => undefined,
        () => undefined,
      ),
    );
    return current;
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
    return this.readOverview();
  }

  setEnabled(enabled: boolean): Promise<MemoryOverview> {
    return this.runCommitSerialized(async () => {
      await this.repository.updateSettings({ enabled });
      return this.readOverview();
    });
  }

  async buildContext(): Promise<MemoryContextSnapshot> {
    if (!(await this.repository.getSettings()).enabled) {
      return { ...EMPTY_CONTEXT };
    }
    return buildSnapshot(
      await this.repository.list(),
      await this.repository.updatedAt(),
    );
  }

  async commitTurn(input: {
    source: ConversationMemorySource;
    userText: string;
    assistantText: string;
  }): Promise<MemoryApplyResult> {
    const userText = input.userText.trim();
    const assistantText = input.assistantText.trim();
    if (!userText || !assistantText) {
      return { ...EMPTY_APPLY_RESULT };
    }

    return this.runCommitSerialized(async () => {
      if (await this.turnLedger.has(input.source)) {
        return { ...EMPTY_APPLY_RESULT };
      }

      if (!(await this.repository.getSettings()).enabled) {
        await this.turnLedger.mark(input.source);
        return { ...EMPTY_APPLY_RESULT };
      }

      const existing = await this.repository.list();
      const proposals = await this.consolidator.propose({
        source: input.source,
        userText,
        assistantText,
        existing,
      });
      const patches = validateMemoryPatchProposals({
        proposals,
        existing,
        source: input.source,
      });
      const result =
        patches.length > 0
          ? await this.repository.apply(patches)
          : { ...EMPTY_APPLY_RESULT };

      await this.turnLedger.mark(input.source);
      return result;
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
