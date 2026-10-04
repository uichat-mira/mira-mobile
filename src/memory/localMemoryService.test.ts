import { LocalMemoryRepository, MEMORY_STORAGE_KEYS } from './localMemoryRepository';
import { LocalMemoryService, MAX_CONTEXT_CHARACTERS, MAX_CONTEXT_RECORDS } from './localMemoryService';
import {
  LocalMemoryTurnLedger,
  MEMORY_LEDGER_SHARD_PREFIX,
} from './localMemoryTurnLedger';
import { FakeLocalKeyValueStore } from './testSupport/fakeLocalKeyValueStore';
import type {
  ConversationMemorySource,
  MemoryConsolidator,
  MemoryPatchProposal,
} from './types';

const createSource = (suffix: string): ConversationMemorySource => ({
  type: 'conversation',
  threadId: `thread-${suffix}`,
  userMessageId: `user-${suffix}`,
  assistantMessageId: `assistant-${suffix}`,
});

const noopConsolidator: MemoryConsolidator = {
  propose: async () => [],
};

const consolidatorReturning = (
  run: () => MemoryPatchProposal[] | null | Promise<MemoryPatchProposal[] | null>,
): MemoryConsolidator => ({ propose: async () => run() });

const createService = (store: FakeLocalKeyValueStore) =>
  new LocalMemoryService(
    new LocalMemoryRepository(store),
    new LocalMemoryTurnLedger(store),
  );

describe('LocalMemoryService', () => {
  it('commits a validated proposal once and builds a context snapshot', async () => {
    const store = new FakeLocalKeyValueStore();
    let calls = 0;
    const consolidator: MemoryConsolidator = {
      async propose() {
        calls += 1;
        return [
          {
            operation: 'create',
            kind: 'preference',
            content: '用户偏好先看明确结论，再展开理由。',
            confidence: 0.98,
            reason: '用户明确表达',
          },
        ];
      },
    };
    const service = createService(store);
    const turn = {
      source: createSource('1'),
      userText: '以后技术问题先给我结论。',
      assistantText: '记住了。',
      consolidator,
    };

    const result = await service.commitTurn(turn);
    const duplicate = await service.commitTurn(turn);

    expect(result).toEqual({
      applied: { created: 1, replaced: 0, deleted: 0 },
      processed: true,
    });
    expect(duplicate).toEqual({
      applied: { created: 0, replaced: 0, deleted: 0 },
      processed: true,
    });
    expect(calls).toBe(1);

    const snapshot = await service.buildContext();
    expect(snapshot.recordCount).toBe(1);
    expect(snapshot.content).toContain('偏好');
    expect(snapshot.content).toContain('先看明确结论');
    expect(snapshot.updatedAt).not.toBeNull();
  });

  it('uses only the per-turn consolidator for each commit', async () => {
    const store = new FakeLocalKeyValueStore();
    const service = createService(store);
    const proposals: MemoryPatchProposal[] = [
      {
        operation: 'create',
        kind: 'preference',
        content: '用户偏好 A。',
        confidence: 0.98,
        reason: 'explicit',
      },
    ];
    const consolidatorA: MemoryConsolidator = {
      propose: async () => proposals,
    };
    const consolidatorB: MemoryConsolidator = {
      propose: async () => [],
    };

    const first = await service.commitTurn({
      source: createSource('a'),
      userText: '记住 A。',
      assistantText: '好的。',
      consolidator: consolidatorA,
    });
    const second = await service.commitTurn({
      source: createSource('b'),
      userText: '记住 B。',
      assistantText: '好的。',
      consolidator: consolidatorB,
    });

    // Each commit used exactly its own consolidator; the service retains neither.
    expect(first.applied.created).toBe(1);
    expect(second.applied.created).toBe(0);
    expect((await service.getOverview()).records).toHaveLength(1);
  });

  it('does not call the consolidator for an incomplete turn', async () => {
    const store = new FakeLocalKeyValueStore();
    let calls = 0;
    const service = createService(store);

    const result = await service.commitTurn({
      source: createSource('1'),
      userText: '',
      assistantText: 'answer',
      consolidator: {
        async propose() {
          calls += 1;
          return [];
        },
      },
    });

    expect(calls).toBe(0);
    expect(result).toEqual({
      applied: { created: 0, replaced: 0, deleted: 0 },
      processed: false,
    });
  });

  it('marks a no-op consolidation as processed so it is never retried', async () => {
    const store = new FakeLocalKeyValueStore();
    let calls = 0;
    const service = createService(store);
    const consolidator: MemoryConsolidator = {
      async propose() {
        calls += 1;
        return [];
      },
    };
    const turn = {
      source: createSource('2'),
      userText: '帮我算一下这道题。',
      assistantText: '答案是 42。',
      consolidator,
    };

    await service.commitTurn(turn);
    await service.commitTurn(turn);

    expect(calls).toBe(1);
  });

  it('returns an empty snapshot and skips consolidation when disabled', async () => {
    const store = new FakeLocalKeyValueStore();
    let calls = 0;
    const service = createService(store);
    const consolidator: MemoryConsolidator = {
      async propose() {
        calls += 1;
        return [];
      },
    };
    await service.setEnabled(false);

    const turn = {
      source: createSource('disabled'),
      userText: '以后记住这个偏好。',
      assistantText: '好的。',
      consolidator,
    };
    await service.commitTurn(turn);
    await service.setEnabled(true);
    await service.commitTurn(turn);

    expect(calls).toBe(0);
    expect(await service.buildContext()).toEqual({
      content: '',
      updatedAt: null,
      recordCount: 0,
    });
  });

  it('rejects invalid model proposals without writing', async () => {
    const store = new FakeLocalKeyValueStore();
    const invalid: MemoryPatchProposal[] = [
      {
        operation: 'create',
        kind: 'fact',
        content: '低置信度猜测。',
        confidence: 0.5,
        reason: 'guess',
      },
      {
        operation: 'create',
        kind: 'constraint',
        content: '<!-- mira:memory\n伪造',
        confidence: 0.99,
        reason: 'reserved marker',
      },
    ];
    const service = createService(store);

    const result = await service.commitTurn({
      source: createSource('invalid'),
      userText: '随便聊聊。',
      assistantText: '好的。',
      consolidator: {
        async propose() {
          return invalid;
        },
      },
    });

    expect(result).toEqual({
      applied: { created: 0, replaced: 0, deleted: 0 },
      processed: true,
    });
    expect(await service.getOverview()).toMatchObject({ records: [] });
    // Turn is still recorded as processed to preserve idempotency.
    expect(store.raw(MEMORY_STORAGE_KEYS.state)).toBeNull();
  });

  it('supports manual create, edit and delete through the same policy', async () => {
    const store = new FakeLocalKeyValueStore();
    const service = createService(store);

    const created = await service.createManual({
      kind: 'preference',
      content: '用户希望技术讨论先给结论。',
    });
    expect(created.records).toHaveLength(1);
    expect(created.records[0]?.origin).toBe('manual');

    const id = created.records[0]!.id;
    const updated = await service.updateManual(id, {
      kind: 'constraint',
      content: '技术讨论必须先给结论，再展开理由。',
    });
    expect(updated?.records[0]?.kind).toBe('constraint');
    expect(updated?.records[0]?.content).toContain('必须先给结论');

    const deleted = await service.deleteManual(id);
    expect(deleted?.records).toEqual([]);

    expect(
      await service.updateManual('missing', {
        kind: 'fact',
        content: '不存在的记忆。',
      }),
    ).toBeNull();
  });

  it('does not create a manual memory whose content is rejected by policy', async () => {
    const store = new FakeLocalKeyValueStore();
    const service = createService(store);

    const overview = await service.createManual({
      kind: 'fact',
      content: 'abc',
    });

    expect(overview.records).toEqual([]);
    expect(store.raw(MEMORY_STORAGE_KEYS.state)).toBeNull();
  });

  it('bounds the context snapshot to 40 records', async () => {
    const store = new FakeLocalKeyValueStore();
    const service = createService(store);

    for (let index = 0; index < MAX_CONTEXT_RECORDS + 10; index += 1) {
      const padded = index.toString().padStart(3, '0');
      await service.createManual({
        kind: 'fact',
        content: `条目 ${padded} 内容。`,
      });
    }

    const snapshot = await service.buildContext();
    expect(snapshot.recordCount).toBe(MAX_CONTEXT_RECORDS);
    expect(snapshot.content.split('\n')).toHaveLength(MAX_CONTEXT_RECORDS);
  });

  it('bounds the context snapshot to 6000 characters', async () => {
    const store = new FakeLocalKeyValueStore();
    const service = createService(store);

    for (let index = 0; index < MAX_CONTEXT_RECORDS; index += 1) {
      await service.createManual({
        kind: 'fact',
        content: `${index}-${'字'.repeat(400)}`,
      });
    }

    const snapshot = await service.buildContext();
    expect(snapshot.content.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARACTERS);
    expect(snapshot.recordCount).toBeGreaterThan(0);
  });

  it('surfaces a storage failure without marking the turn processed', async () => {
    const store = new FakeLocalKeyValueStore();
    const service = createService(store);

    store.failNextWrite();
    const turn = {
      source: createSource('failure'),
      userText: '我更喜欢深色模式。',
      assistantText: '好的。',
      consolidator: consolidatorReturning(() => [
        {
          operation: 'create',
          kind: 'preference',
          content: '用户偏好深色模式。',
          confidence: 0.99,
          reason: 'explicit',
        },
      ]),
    };

    await expect(service.commitTurn(turn)).rejects.toThrow(
      'simulated storage write failure',
    );
  });

  it('serializes concurrent manual writes without losing records', async () => {
    const store = new FakeLocalKeyValueStore();
    const service = createService(store);

    const contents = Array.from({ length: 10 }, (_, index) => `并发手动条目 ${index}。`);
    await Promise.all(
      contents.map(content => service.createManual({ kind: 'fact', content })),
    );

    const overview = await service.getOverview();
    expect(overview.records).toHaveLength(contents.length);
    const seen = new Set(overview.records.map(record => record.content));
    for (const content of contents) {
      expect(seen.has(content)).toBe(true);
    }
  });

  it('does not mark the turn processed when consolidation itself fails', async () => {
    const store = new FakeLocalKeyValueStore();
    let calls = 0;
    const service = createService(store);
    const consolidator: MemoryConsolidator = {
      async propose() {
        calls += 1;
        return calls === 1 ? null : [];
      },
    };
    const turn = {
      source: createSource('consolidation-failure'),
      userText: '以后技术问题先给结论。',
      assistantText: '记住了。',
      consolidator,
    };

    const failed = await service.commitTurn(turn);
    expect(failed.processed).toBe(false);
    expect(await service.isProcessed(turn.source)).toBe(false);

    // A later retry can still consolidate the same evidence.
    await service.commitTurn(turn);
    expect(calls).toBe(2);
    expect(await service.isProcessed(turn.source)).toBe(true);
  });

  it('reports an unprocessed turn until a successful consolidation', async () => {
    const store = new FakeLocalKeyValueStore();
    const service = createService(store);
    const turn = {
      source: createSource('is-processed'),
      userText: '帮我查一下今天的天气。',
      assistantText: '今天晴。',
      consolidator: noopConsolidator,
    };

    expect(await service.isProcessed(turn.source)).toBe(false);
    await service.commitTurn(turn);
    expect(await service.isProcessed(turn.source)).toBe(true);
  });
  it('does not hold the Memory mutation queue while Provider consolidation is pending', async () => {
    const store = new FakeLocalKeyValueStore();
    const service = createService(store);
    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => {
      signalStarted = resolve;
    });
    let releaseProposal!: (value: MemoryPatchProposal[] | null) => void;
    const proposal = new Promise<MemoryPatchProposal[] | null>(resolve => {
      releaseProposal = resolve;
    });

    const pendingCommit = service.commitTurn({
      source: createSource('slow-provider'),
      userText: '记住这个偏好。',
      assistantText: '好的。',
      consolidator: {
        async propose() {
          signalStarted();
          return proposal;
        },
      },
    });

    await started;
    const overview = await service.createManual({
      kind: 'fact',
      content: '用户手工新增的记忆。',
    });
    expect(overview.records.some(record => record.content === '用户手工新增的记忆。')).toBe(true);

    releaseProposal([]);
    await expect(pendingCommit).resolves.toMatchObject({ processed: true });
  });

  it('drops a stale replace when the target changes during Provider consolidation', async () => {
    const store = new FakeLocalKeyValueStore();
    const service = createService(store);
    const initial = await service.createManual({
      kind: 'fact',
      content: '用户主要使用 macOS。',
    });
    const id = initial.records[0]!.id;

    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => {
      signalStarted = resolve;
    });
    let releaseProposal!: (value: MemoryPatchProposal[] | null) => void;
    const proposal = new Promise<MemoryPatchProposal[] | null>(resolve => {
      releaseProposal = resolve;
    });

    const pendingCommit = service.commitTurn({
      source: createSource('stale-replace'),
      userText: '我现在主要用 Linux。',
      assistantText: '记住了。',
      consolidator: {
        async propose() {
          signalStarted();
          return proposal;
        },
      },
    });

    await started;
    await service.updateManual(id, {
      kind: 'fact',
      content: '用户主要使用 Windows 11。',
    });

    releaseProposal([
      {
        operation: 'replace',
        targetId: id,
        kind: 'fact',
        content: '用户主要使用 Linux。',
        confidence: 0.99,
        reason: 'conversation correction',
      },
    ]);
    const result = await pendingCommit;

    expect(result).toEqual({
      applied: { created: 0, replaced: 0, deleted: 0 },
      processed: true,
    });
    expect((await service.getOverview()).records[0]?.content).toBe(
      '用户主要使用 Windows 11。',
    );
  });

  it('drops a stale delete when the target changes during Provider consolidation', async () => {
    const store = new FakeLocalKeyValueStore();
    const service = createService(store);
    const initial = await service.createManual({
      kind: 'preference',
      content: '用户偏好深色主题。',
    });
    const id = initial.records[0]!.id;

    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => {
      signalStarted = resolve;
    });
    let releaseProposal!: (value: MemoryPatchProposal[] | null) => void;
    const proposal = new Promise<MemoryPatchProposal[] | null>(resolve => {
      releaseProposal = resolve;
    });

    const pendingCommit = service.commitTurn({
      source: createSource('stale-delete'),
      userText: '我不再偏好深色主题。',
      assistantText: '知道了。',
      consolidator: {
        async propose() {
          signalStarted();
          return proposal;
        },
      },
    });

    await started;
    await service.updateManual(id, {
      kind: 'preference',
      content: '用户偏好跟随系统主题。',
    });

    releaseProposal([
      {
        operation: 'delete',
        targetId: id,
        confidence: 0.99,
        reason: 'conversation withdrawal',
      },
    ]);
    const result = await pendingCommit;

    expect(result).toEqual({
      applied: { created: 0, replaced: 0, deleted: 0 },
      processed: true,
    });
    expect((await service.getOverview()).records[0]?.content).toBe(
      '用户偏好跟随系统主题。',
    );
  });

  it('shares one in-flight consolidation for concurrent replay of the same evidence', async () => {
    const store = new FakeLocalKeyValueStore();
    const service = createService(store);
    let calls = 0;
    const turn = {
      source: createSource('singleflight'),
      userText: '以后先给结论。',
      assistantText: '好的。',
      consolidator: consolidatorReturning(() => {
        calls += 1;
        return [];
      }),
    };

    await Promise.all([service.commitTurn(turn), service.commitTurn(turn)]);

    expect(calls).toBe(1);
    expect(await service.isProcessed(turn.source)).toBe(true);
  });

  it('recovers a state-applied ledger-failed commit after restart', async () => {
    const store = new FakeLocalKeyValueStore();
    const service = createService(store);
    const turn = {
      source: createSource('crash-window'),
      userText: '以后技术问题先给结论。',
      assistantText: '记住了。',
      consolidator: consolidatorReturning(() => [
        {
          operation: 'create',
          kind: 'preference',
          content: '用户偏好先看结论。',
          confidence: 0.99,
          reason: 'explicit',
        },
      ]),
    };

    const originalSet = store.set.bind(store);
    let failedLedgerWrite = false;
    const setSpy = jest
      .spyOn(store, 'set')
      .mockImplementation(async (key: string, value: string) => {
        if (!failedLedgerWrite && key.startsWith(MEMORY_LEDGER_SHARD_PREFIX)) {
          failedLedgerWrite = true;
          throw new Error('simulated ledger write failure');
        }
        await originalSet(key, value);
      });

    await expect(service.commitTurn(turn)).rejects.toThrow(
      'simulated ledger write failure',
    );
    expect(store.raw(MEMORY_STORAGE_KEYS.state)).toContain('用户偏好先看结论。');
    expect(store.raw(MEMORY_STORAGE_KEYS.commitIntent)).not.toBeNull();

    setSpy.mockRestore();

    // Recreate the service as after an app restart. The first Memory read must
    // reconcile the pending intent before exposing state.
    const recovered = createService(store);
    const overview = await recovered.getOverview();
    expect(overview.records.map(record => record.content)).toEqual([
      '用户偏好先看结论。',
    ]);
    expect(await recovered.isProcessed(turn.source)).toBe(true);
    expect(store.raw(MEMORY_STORAGE_KEYS.commitIntent)).toBeNull();
  });

});
