import type { OpenAiCompatibleMessage } from '../provider/openAiCompatibleClient';
import type { RuntimeEvent } from '../runtime/conversationRuntime';
import type {
  ConsolidationInput,
  MemoryKind,
  MemoryPatchProposal,
  MemoryRecord,
} from './types';

// Mobile Local Memory consolidator.
//
// Mirrors the semantics of Mira Desktop Memory V1's `LlmMemoryConsolidator`:
// a single model call turns one completed conversation turn plus the existing
// memory records into a bounded list of `MemoryPatchProposal`s. The model has
// proposal authority only — the deterministic Memory Policy remains the sole
// writer — so this module never touches storage.
//
// Provider usage follows the Local Memory contract: the call is made with the
// exact same Local Provider client / model / credential boundary as the chat
// request. There is no separate "Memory Provider" setting.

export type ConsolidatorChat = (request: {
  model: string;
  messages: OpenAiCompatibleMessage[];
}) => Promise<AsyncIterable<RuntimeEvent>>;

const MAX_EXISTING_IN_PROMPT = 40;

const SYSTEM_PROMPT = [
  'You extract durable memory from a single conversation turn between a user and an assistant.',
  'Return STRICT JSON only, with this exact shape:',
  '{"patches":[{"operation":"create"|"replace"|"delete","kind":"preference"|"fact"|"decision"|"constraint","content":"...","targetId":"...","confidence":0.0,"reason":"..."}]}',
  'Rules:',
  '- Only record a stable user preference the user explicitly expressed.',
  '- Only record a long-term fact the user explicitly confirmed.',
  '- Only record a long-term decision or constraint the user explicitly made.',
  '- Only record a correction/withdrawal the user explicitly made about existing memory.',
  '- Never record something the assistant merely suggested but the user did not confirm.',
  '- Never record psychological, personality or motive speculation.',
  '- Never record temporary mood, one-off tasks or short-term todos.',
  '- Never treat tool, web or third-party content as a user fact.',
  '- Never invent memory just to produce output.',
  '- `targetId` is required for replace/delete and must be an existing memory id.',
  '- `confidence` is a number from 0.85 to 1.',
  '- If nothing qualifies, return {"patches":[]}.',
  'Output JSON only, no prose and no code fences.',
].join('\n');

const KIND_VALUES: readonly MemoryKind[] = [
  'preference',
  'fact',
  'decision',
  'constraint',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const asConfidence = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const parseProposal = (value: unknown): MemoryPatchProposal | null => {
  if (!isRecord(value)) return null;
  const operation = asString(value.operation);
  const reason = asString(value.reason);
  const confidence = asConfidence(value.confidence);
  if (!operation || reason === null || confidence === null) return null;

  if (operation === 'delete') {
    const targetId = asString(value.targetId);
    if (!targetId) return null;
    return { operation: 'delete', targetId, confidence, reason };
  }

  const kind = asString(value.kind);
  const content = asString(value.content);
  if (!kind || !KIND_VALUES.includes(kind as MemoryKind) || content === null) {
    return null;
  }
  const memoryKind = kind as MemoryKind;

  if (operation === 'create') {
    return {
      operation: 'create',
      kind: memoryKind,
      content,
      confidence,
      reason,
    };
  }

  if (operation === 'replace') {
    const targetId = asString(value.targetId);
    if (!targetId) return null;
    return {
      operation: 'replace',
      targetId,
      kind: memoryKind,
      content,
      confidence,
      reason,
    };
  }

  return null;
};

const stripCodeFence = (value: string): string => {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
};

/**
 * Parse the provider's consolidated JSON into proposals.
 *
 * Any malformed payload (invalid JSON, wrong shape, non-array patches) returns
 * `null` so the caller treats the whole consolidation as a failure rather than
 * committing a partial or fabricated result.
 */
export function parseConsolidationProposals(
  raw: string,
): MemoryPatchProposal[] | null {
  const candidate = stripCodeFence(raw);
  if (!candidate) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.patches)) return null;

  const proposals: MemoryPatchProposal[] = [];
  for (const item of parsed.patches) {
    const proposal = parseProposal(item);
    if (!proposal) return null;
    proposals.push(proposal);
  }
  return proposals;
}

const renderExistingMemories = (records: MemoryRecord[]): string => {
  if (records.length === 0) return '(none)';
  return records
    .slice(0, MAX_EXISTING_IN_PROMPT)
    .map(record => `- id=${record.id} kind=${record.kind}: ${record.content}`)
    .join('\n');
};

interface ConsolidatorOptions {
  model: string;
  chat: ConsolidatorChat;
}

/**
 * A `MemoryConsolidator` backed by the Local Provider.
 *
 * `propose` is deterministic in shape but performs one model call. When the
 * provider fails, returns no text, or returns an unparseable payload, it
 * returns `null` so the Memory Service can keep the turn unprocessed for a
 * later retry instead of recording a false success.
 */
export const createLocalProviderConsolidator = (
  options: ConsolidatorOptions,
): {
  propose(input: ConsolidationInput): Promise<MemoryPatchProposal[] | null>;
} => ({
  async propose(input) {
    const messages: OpenAiCompatibleMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          'Existing memory:',
          renderExistingMemories(input.existing),
          '',
          'Conversation turn:',
          `User: ${input.userText}`,
          `Assistant: ${input.assistantText}`,
        ].join('\n'),
      },
    ];

    let text = '';
    try {
      for await (const event of await options.chat({
        model: options.model,
        messages,
      })) {
        if (event.type === 'text-delta') text += event.delta;
      }
    } catch {
      return null;
    }
    if (!text.trim()) return null;
    return parseConsolidationProposals(text);
  },
});
