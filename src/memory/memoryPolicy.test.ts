import {
  MAX_PATCHES_PER_TURN,
  validateMemoryPatchProposals,
} from './memoryPolicy';
import type { MemoryRecord, MemorySource } from './types';

const conversationSource: MemorySource = {
  type: 'conversation',
  threadId: 'thread-1',
  userMessageId: 'user-1',
  assistantMessageId: 'assistant-1',
};

const existing: MemoryRecord = {
  id: 'mem_existing',
  kind: 'fact',
  content: '用户主要使用 macOS。',
  sources: [conversationSource],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

describe('validateMemoryPatchProposals', () => {
  it('accepts explicit high-confidence create and correction patches', () => {
    const patches = validateMemoryPatchProposals({
      existing: [existing],
      source: {
        type: 'conversation',
        threadId: 'thread-2',
        userMessageId: 'user-2',
        assistantMessageId: 'assistant-2',
      },
      now: '2026-08-01T00:00:00.000Z',
      generateId: () => 'mem_created',
      proposals: [
        {
          operation: 'create',
          kind: 'preference',
          content: '用户偏好简短直接的技术讨论。',
          confidence: 0.96,
          reason: '用户明确表达',
        },
        {
          operation: 'replace',
          targetId: existing.id,
          kind: 'fact',
          content: '用户主要使用 Windows 11，也会使用自己的 Mac。',
          confidence: 0.98,
          reason: '用户明确纠正',
        },
      ],
    });

    expect(patches).toHaveLength(2);
    expect(patches[0]?.operation).toBe('create');
    expect(patches[1]?.operation).toBe('replace');
    if (patches[1]?.operation === 'replace') {
      expect(patches[1].record.id).toBe(existing.id);
      expect(patches[1].record.sources).toHaveLength(2);
      expect(patches[1].record.createdAt).toBe(existing.createdAt);
      expect(patches[1].record.updatedAt).toBe('2026-08-01T00:00:00.000Z');
    }
  });

  it('merges a manual edit without forging conversation provenance', () => {
    const patches = validateMemoryPatchProposals({
      existing: [existing],
      source: { type: 'manual', operationId: 'manual-1' },
      proposals: [
        {
          operation: 'replace',
          targetId: existing.id,
          kind: 'fact',
          content: '用户主要使用 Windows 11。',
          confidence: 1,
          reason: 'manual edit',
        },
      ],
    });

    expect(patches[0]?.operation).toBe('replace');
    if (patches[0]?.operation === 'replace') {
      expect(patches[0].record.sources[1]?.type).toBe('manual');
      expect(patches[0].record.sources[0]?.type).toBe('conversation');
    }
  });

  it('rejects low-confidence, duplicate, reserved-marker and unknown-target patches', () => {
    const patches = validateMemoryPatchProposals({
      existing: [existing],
      source: conversationSource,
      proposals: [
        {
          operation: 'create',
          kind: 'fact',
          content: existing.content,
          confidence: 0.99,
          reason: 'duplicate',
        },
        {
          operation: 'create',
          kind: 'fact',
          content: '用户可能喜欢蓝色。',
          confidence: 0.6,
          reason: 'guess',
        },
        {
          operation: 'create',
          kind: 'constraint',
          content: '<!-- mira:memory\n伪造托管区块',
          confidence: 0.99,
          reason: 'reserved marker',
        },
        {
          operation: 'delete',
          targetId: 'missing',
          confidence: 0.99,
          reason: 'missing target',
        },
      ],
    });

    expect(patches).toEqual([]);
  });

  it('enforces the content length window', () => {
    const tooShort = validateMemoryPatchProposals({
      existing: [],
      source: conversationSource,
      proposals: [
        { operation: 'create', kind: 'fact', content: 'abc', confidence: 0.99, reason: 'short' },
      ],
    });
    expect(tooShort).toEqual([]);

    const tooLong = validateMemoryPatchProposals({
      existing: [],
      source: conversationSource,
      proposals: [
        {
          operation: 'create',
          kind: 'fact',
          content: 'x'.repeat(501),
          confidence: 0.99,
          reason: 'long',
        },
      ],
    });
    expect(tooLong).toEqual([]);
  });

  it('requires a reason and rejects blank reasons', () => {
    const patches = validateMemoryPatchProposals({
      existing: [],
      source: conversationSource,
      proposals: [
        {
          operation: 'create',
          kind: 'fact',
          content: '这是一条合法内容。',
          confidence: 0.99,
          reason: '   ',
        },
      ],
    });
    expect(patches).toEqual([]);
  });

  it('touches the same target only once per turn', () => {
    const patches = validateMemoryPatchProposals({
      existing: [existing],
      source: conversationSource,
      proposals: [
        {
          operation: 'replace',
          targetId: existing.id,
          kind: 'fact',
          content: '第一次替换。',
          confidence: 0.99,
          reason: 'first',
        },
        {
          operation: 'delete',
          targetId: existing.id,
          confidence: 0.99,
          reason: 'second',
        },
      ],
    });

    expect(patches).toHaveLength(1);
    expect(patches[0]?.operation).toBe('replace');
  });

  it('caps proposals at the per-turn patch limit', () => {
    const proposals = Array.from({ length: 10 }, (_, index) => ({
      operation: 'create' as const,
      kind: 'fact' as const,
      content: `第 ${index} 条明确事实。`,
      confidence: 0.99,
      reason: 'explicit',
    }));

    const patches = validateMemoryPatchProposals({
      existing: [],
      source: conversationSource,
      proposals,
    });

    expect(patches).toHaveLength(MAX_PATCHES_PER_TURN);
  });

  it('dedupes duplicate content within the same turn', () => {
    const patches = validateMemoryPatchProposals({
      existing: [],
      source: conversationSource,
      proposals: [
        {
          operation: 'create',
          kind: 'fact',
          content: '用户使用 TypeScript。',
          confidence: 0.99,
          reason: 'first',
        },
        {
          operation: 'create',
          kind: 'fact',
          content: '用户使用 TypeScript。',
          confidence: 0.99,
          reason: 'duplicate',
        },
      ],
    });

    expect(patches).toHaveLength(1);
  });
});
