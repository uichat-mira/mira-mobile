import { filterReasoningTagEvents } from '../provider/reasoningTagFilter';
import type { LocalProviderConfig } from '../provider/providerConfigStore';
import {
  createLocalProviderConsolidator,
  type LocalMemoryService,
} from '../memory';
import type { LocalProviderExecutor } from './localProviderExecution';
import type { RuntimeEvent } from './conversationRuntime';

// Completed-turn Memory consolidation for the Local Provider runtime.
//
// This boundary owns the post-turn Memory side effect and the completion
// classification that gates it. Consolidation is best-effort, detached and
// idempotent: it runs only after the canonical Assistant reply is already
// durable, every failure path is swallowed, and the Memory Service decides
// whether a turn was already processed. A Memory problem must never turn a
// successful chat reply into a failed one.

const isCompletedAssistantFinishReason = (reason: string | null): boolean =>
  reason === 'stop' || reason === null;

export interface LocalTurnCompletion {
  content: string;
  sawError: boolean;
  paused: boolean;
  finished: boolean;
  finishReason: string | null;
}

/**
 * A turn is "completed" only when a real final Assistant reply was produced:
 * non-empty content, no error, not paused (suspension / cancel / timeout /
 * approval-rejected, etc.) and a final finish reason. Intermediate tool
 * messages (finish reason `tool_calls`) and truncated replies (`length` /
 * `content_filter`) are not completed turns and are not Memory evidence.
 */
export function isCompletedTurn(turn: LocalTurnCompletion): boolean {
  return (
    turn.content.length > 0 &&
    !turn.sawError &&
    !turn.paused &&
    turn.finished &&
    isCompletedAssistantFinishReason(turn.finishReason)
  );
}

export interface LocalTurnConsolidationInput {
  threadId: string;
  userMessageId: string;
  assistantMessageId: string;
  userText: string;
  assistantText: string;
}

export interface LocalTurnConsolidationDependencies {
  service: LocalMemoryService;
  executor: LocalProviderExecutor;
  config: LocalProviderConfig;
}

/**
 * Consolidate one completed local turn into Memory.
 *
 * The consolidator is built per turn from the exact Local Provider client /
 * model that produced this turn so concurrent sessions can never share or
 * overwrite each other's Provider. It goes through the same provider
 * compatibility normalization (e.g. reasoning-tag stripping) as the chat
 * request, so a reasoning-tag-prefixed JSON payload is still parsed correctly.
 */
export async function consolidateLocalTurn(
  input: LocalTurnConsolidationInput,
  dependencies: LocalTurnConsolidationDependencies,
): Promise<void> {
  const { service, executor, config } = dependencies;
  try {
    const source = {
      type: 'conversation' as const,
      threadId: input.threadId,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
    };
    if (await service.isProcessed(source)) return;
    const consolidator = createLocalProviderConsolidator({
      model: config.model,
      chat: async (request) => {
        const stream: AsyncIterable<RuntimeEvent> = await executor.client.streamChat(
          request,
        );
        return config.compatibility?.reasoningTags === 'strip'
          ? filterReasoningTagEvents(stream)
          : stream;
      },
    });
    await service.commitTurn({
      source,
      userText: input.userText,
      assistantText: input.assistantText,
      consolidator,
    });
  } catch {
    // Memory is an additive capability; it must never fail the chat reply.
  }
}
