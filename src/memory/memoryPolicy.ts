import type {
  MemoryPatchProposal,
  MemoryRecord,
  MemorySource,
  ValidatedMemoryPatch,
} from './types';

// Deterministic Memory Policy, ported from Mira Desktop Memory V1
// (`mira-desktop/server/src/memory/memory-policy.ts`). The rules below are
// platform independent and must stay semantically identical to Desktop:
// a model may only propose patches, and this policy is the sole authority
// that decides whether a proposal can be committed.

export const MAX_PATCHES_PER_TURN = 6;
export const MIN_CONFIDENCE = 0.85;
export const MAX_CONFIDENCE = 1;
export const MIN_CONTENT_LENGTH = 4;
export const MAX_CONTENT_LENGTH = 500;
export const MAX_REASON_LENGTH = 500;
export const RESERVED_MARKERS = ['<!-- mira:memory', '<!-- /mira:memory -->'];

export const normalizeMemoryContent = (value: string): string =>
  value
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ');

export const isSameMemorySource = (
  left: MemorySource,
  right: MemorySource,
): boolean => {
  if (left.type !== right.type) return false;
  if (left.type === 'manual' && right.type === 'manual') {
    return left.operationId === right.operationId;
  }
  if (left.type === 'conversation' && right.type === 'conversation') {
    return (
      left.threadId === right.threadId &&
      left.userMessageId === right.userMessageId &&
      left.assistantMessageId === right.assistantMessageId
    );
  }
  return false;
};

const mergeSources = (
  sources: MemorySource[],
  source: MemorySource,
): MemorySource[] => {
  const next = [...sources];
  if (!next.some(item => isSameMemorySource(item, source))) {
    next.push(source);
  }
  return next;
};

const isValidContent = (value: string): boolean => {
  const normalized = value.trim();
  return (
    normalized.length >= MIN_CONTENT_LENGTH &&
    normalized.length <= MAX_CONTENT_LENGTH &&
    !RESERVED_MARKERS.some(marker => normalized.includes(marker))
  );
};

export interface ValidateMemoryPatchInput {
  proposals: MemoryPatchProposal[];
  existing: MemoryRecord[];
  source: MemorySource;
  now?: string;
  generateId?: () => string;
}

export const validateMemoryPatchProposals = (
  input: ValidateMemoryPatchInput,
): ValidatedMemoryPatch[] => {
  const now = input.now ?? new Date().toISOString();
  const generateId = input.generateId ?? createMemoryId;
  const existingById = new Map(input.existing.map(record => [record.id, record]));
  const existingContents = new Set(
    input.existing.map(record => normalizeMemoryContent(record.content)),
  );
  const acceptedContents = new Set<string>();
  const touchedIds = new Set<string>();
  const validated: ValidatedMemoryPatch[] = [];

  for (const proposal of input.proposals.slice(0, MAX_PATCHES_PER_TURN)) {
    const reason = proposal.reason.trim();
    if (
      !Number.isFinite(proposal.confidence) ||
      proposal.confidence < MIN_CONFIDENCE ||
      proposal.confidence > MAX_CONFIDENCE ||
      !reason ||
      reason.length > MAX_REASON_LENGTH
    ) {
      continue;
    }

    if (proposal.operation === 'delete') {
      const target = existingById.get(proposal.targetId);
      if (!target || touchedIds.has(target.id)) continue;
      touchedIds.add(target.id);
      validated.push({
        operation: 'delete',
        targetId: target.id,
        reason,
      });
      continue;
    }

    if (!isValidContent(proposal.content)) continue;
    const content = proposal.content.trim();
    const normalizedContent = normalizeMemoryContent(content);

    if (proposal.operation === 'create') {
      if (
        existingContents.has(normalizedContent) ||
        acceptedContents.has(normalizedContent)
      ) {
        continue;
      }
      acceptedContents.add(normalizedContent);
      validated.push({
        operation: 'create',
        record: {
          id: generateId(),
          kind: proposal.kind,
          content,
          sources: [input.source],
          createdAt: now,
          updatedAt: now,
        },
        reason,
      });
      continue;
    }

    const target = existingById.get(proposal.targetId);
    if (!target || touchedIds.has(target.id)) continue;
    if (normalizeMemoryContent(target.content) === normalizedContent) continue;
    if (acceptedContents.has(normalizedContent)) continue;

    touchedIds.add(target.id);
    acceptedContents.add(normalizedContent);
    validated.push({
      operation: 'replace',
      targetId: target.id,
      record: {
        id: target.id,
        kind: proposal.kind,
        content,
        sources: mergeSources(target.sources, input.source),
        createdAt: target.createdAt,
        updatedAt: now,
      },
      reason,
    });
  }

  return validated;
};

// React Native does not guarantee a global Web Crypto implementation, so the
// Memory Kernel keeps its own identifier generator instead of relying on
// `crypto.randomUUID`.
let memoryIdSequence = 0;

export const createMemoryId = (): string => {
  memoryIdSequence += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `mem_${Date.now().toString(36)}_${memoryIdSequence.toString(36)}_${random}`;
};

let operationIdSequence = 0;

export const createManualOperationId = (): string => {
  operationIdSequence += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `manual_${Date.now().toString(36)}_${operationIdSequence.toString(36)}_${random}`;
};
