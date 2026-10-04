import { LocalMemoryRepository, MEMORY_STORAGE_KEYS } from './localMemoryRepository';
import { LocalMemoryService, MAX_CONTEXT_CHARACTERS, MAX_CONTEXT_RECORDS } from './localMemoryService';
import { LocalMemoryTurnLedger } from './localMemoryTurnLedger';
import { noopMemoryConsolidator } from './runtime';
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

const createService = (
  store: FakeLocalKeyValueStore,
  consolidator: MemoryConsolidator = noopMemoryConsolidator,
) =>
  new LocalMemoryService(
    new LocalMemoryRepository(store),
    consolidator,
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
    const service = createService(store, consolidator);
    const turn = {
      source: createSource('1'),
      userText: '以后技术问题先给我结论。',
      assistantText: '记住了。',
    };

    const result = await service.commitTurn(turn);
    const duplicate = await service.commitTurn(turn);

    expect(result).toEqual({ created: 1, replaced: 0, deleted: 0 });
    expect(duplicate).toEqual({ created: 0, replaced: 0, deleted: 0 });
    expect(calls).toBe(1);

    const snapshot = await service.buildContext();
    expect(snapshot.recordCount).toBe(1);
    expect(snapshot.content).toContain('偏好');
    expect(snapshot.content).toContain('先看明确结论');
    expect(snapshot.updatedAt).not.toBeNull();
  });

  it('does not call the consolidator for an incomplete turn', async () => {
    const store = new FakeLocalKeyValueStore();
    let calls = 0;
    const service = createService(store, {
      async propose() {
        calls += 1;
        return [];
      },
    });

    const result = await service.commitTurn({
      source: createSource('1'),
      userText: '',
      assistantText: 'answer',
    });

    expect(calls).toBe(0);
    expect(result).toEqual({ created: 0, replaced: 0, deleted: 0 });
  });

  it('marks a no-op consolidation as processed so it is never retried', async () => {
    const store = new FakeLocalKeyValueStore();
    let calls = 0;
    const service = createService(store, {
      async propose() {
        calls += 1;
        return [];
      },
    });
    const turn = {
      source: createSource('2'),
      userText: '帮我算一下这道题。',
      assistantText: '答案是 42。',
    };

    await service.commitTurn(turn);
    await service.commitTurn(turn);

    expect(calls).toBe(1);
  });

  it('returns an empty snapshot and skips consolidation when disabled', async () => {
    const store = new FakeLocalKeyValueStore();
    let calls = 0;
    const service = createService(store, {
      async propose() {
        calls += 1;
        return [];
      },
    });
    await service.setEnabled(false);

    const turn = {
      source: createSource('disabled'),
      userText: '以后记住这个偏好。',
      assistantText: '好的。',
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
    const service = createService(store, {
      async propose() {
        return invalid;
      },
    });

    const result = await service.commitTurn({
      source: createSource('invalid'),
      userText: '随便聊聊。',
      assistantText: '好的。',
    });

    expect(result).toEqual({ created: 0, replaced: 0, deleted: 0 });
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
    const service = createService(store, {
      async propose() {
        return [
          {
            operation: 'create',
            kind: 'preference',
            content: '用户偏好深色模式。',
            confidence: 0.99,
            reason: 'explicit',
          },
        ];
      },
    });

    store.failNextWrite();
    const turn = {
      source: createSource('failure'),
      userText: '我更喜欢深色模式。',
      assistantText: '好的。',
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
});
