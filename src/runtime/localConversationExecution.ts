import type { ChatMessage, Session } from '../types';
import {
  DEFAULT_LOCAL_SESSION_TITLE,
  LocalSessionRepository,
} from '../local/localSessionRepository';
import type { LocalMemoryService } from '../memory';
import type { LocalProviderConfig } from '../provider/providerConfigStore';
import type { RuntimeEvent } from './conversationRuntime';
import type { LocalAgentRunController, LocalAgentRun } from './localAgentRunController';
import type {
  LocalProviderExecutionController,
  LocalProviderExecutionRun,
  LocalProviderExecutor,
} from './localProviderExecution';
import type { LocalRequestContext } from './localRequestContext';
import { consolidateLocalTurn, isCompletedTurn } from './localTurnConsolidation';

// Canonical Local conversation turn execution.
//
// This boundary owns the complete canonical turn lifecycle:
// user-message dedup/persistence -> request assembly -> Provider/Agent stream ->
// Assistant persistence -> completed-turn post processing. LocalProviderRuntime
// resolves session/provider/credential facts and delegates here.

let localMessageIdSequence = 0;
const createMessageId = () => {
  localMessageIdSequence += 1;
  return `local-message-${Date.now()}-${localMessageIdSequence.toString(36)}`;
};

const MAX_SESSION_TITLE_LENGTH = 30;

const deriveSessionTitle = (input: string): string => {
  const normalized = input.replace(/\s+/gu, ' ').trim();
  if (!normalized) return DEFAULT_LOCAL_SESSION_TITLE;
  return normalized.length > MAX_SESSION_TITLE_LENGTH
    ? `${normalized.slice(0, MAX_SESSION_TITLE_LENGTH)}…`
    : normalized;
};

export interface LocalConversationTurnInput {
  session: Session;
  input: string;
  messageId?: string;
  agentEnabled?: boolean;
}

export interface LocalConversationExecutionDependencies {
  repository: LocalSessionRepository;
  executor: LocalProviderExecutor;
  providerExecution: LocalProviderExecutionController;
  agentRun: LocalAgentRunController | null;
  assembleRequest(
    canonicalMessages: readonly ChatMessage[],
  ): Promise<LocalRequestContext>;
  memoryService: LocalMemoryService;
  config: LocalProviderConfig;
}

export async function executeLocalConversationTurn(
  turn: LocalConversationTurnInput,
  dependencies: LocalConversationExecutionDependencies,
): Promise<AsyncIterable<RuntimeEvent>> {
  const {
    repository,
    executor,
    providerExecution,
    agentRun,
    assembleRequest,
    memoryService,
    config,
  } = dependencies;

  const userMessage: ChatMessage = {
    id: turn.messageId?.trim() || createMessageId(),
    role: 'user',
    content: turn.input,
    timestamp: new Date(),
  };
  const previous = await repository.getMessages(turn.session.id);
  const alreadyRecorded = previous.some((message) => message.id === userMessage.id);
  if (!alreadyRecorded) {
    await repository.appendMessages(turn.session.id, [userMessage]);
  }
  const canonicalMessages = alreadyRecorded ? previous : [...previous, userMessage];

  if (turn.session.title === DEFAULT_LOCAL_SESSION_TITLE) {
    const firstUserMessage = canonicalMessages.find(
      (message) => message.role === 'user' && message.content.trim().length > 0,
    );
    if (firstUserMessage) {
      await repository.rename(
        turn.session.id,
        deriveSessionTitle(firstUserMessage.content),
      );
    }
  }

  const request = await assembleRequest(canonicalMessages);
  const useAgent = Boolean(turn.agentEnabled && agentRun);

  // Preserve existing replacement semantics: a newer Agent turn supersedes the
  // current Agent's Provider request before starting its own execution.
  if (useAgent && agentRun?.active) {
    providerExecution.cancelActiveRun();
  }

  const providerRun: LocalProviderExecutionRun =
    providerExecution.beginRun(executor);
  let agentRunHandle: LocalAgentRun | null = null;
  let stream: AsyncIterable<RuntimeEvent>;

  try {
    if (useAgent && agentRun) {
      agentRunHandle = await agentRun.beginRun({
        executor,
        initialMessages: request.messages,
        shouldPause: () => providerExecution.executionSuspended,
      });
      stream = agentRunHandle.stream;
    } else {
      stream = await executor.streamMessages(request.messages);
    }
  } catch (error) {
    providerExecution.finishRun(providerRun);
    throw error;
  }

  const assistantId = createMessageId();
  const threadId = turn.session.id;
  const canonicalUserMessageId = userMessage.id;
  const userText = turn.input;

  return (async function* () {
    let content = '';
    let sawError = false;
    let paused = false;
    let finished = false;
    let finishReason: string | null = null;
    let completedTurn = false;

    try {
      for await (const event of stream) {
        if (event.type === 'text-delta') content += event.delta;
        if (event.type === 'error') sawError = true;
        if (event.type === 'run-paused') paused = true;
        if (event.type === 'finish') {
          finished = true;
          finishReason = event.reason;
        }
        yield event;
      }

      if (content) {
        await repository.appendMessages(threadId, [
          { id: assistantId, role: 'assistant', content, timestamp: new Date() },
        ]);
      }

      completedTurn = isCompletedTurn({
        content,
        sawError,
        paused,
        finished,
        finishReason,
      });
    } finally {
      if (agentRun && agentRunHandle) {
        agentRun.finishRun(agentRunHandle);
      }
      providerExecution.finishRun(providerRun);
    }

    if (completedTurn) {
      consolidateLocalTurn(
        {
          threadId,
          userMessageId: canonicalUserMessageId,
          assistantMessageId: assistantId,
          userText,
          assistantText: content,
        },
        { service: memoryService, executor, config },
      ).catch(() => undefined);
    }
  })();
}
