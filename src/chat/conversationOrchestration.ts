import type { ChatMessage } from '../types';
import { getChatSendErrorMessage } from '../screens/chatSessionState';
import type {
  ConversationRuntime,
  RuntimeEvent,
  RuntimeKind,
} from '../runtime/conversationRuntime';

export type ConversationStreamPhase =
  | 'idle'
  | 'thinking'
  | 'running-tool'
  | 'continuing'
  | 'waiting-approval'
  | 'paused'
  | 'completed'
  | 'error';

export type ConversationActivityStatus =
  | 'requested'
  | 'running'
  | 'awaiting-approval'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'truncated';

export interface ConversationStreamApproval {
  invocationId: string;
  callId: string;
  name: string;
  message: string;
  scope?: string;
}

export type ConversationStreamPauseReason =
  | 'app-suspended'
  | 'timeout'
  | 'cancelled'
  | 'approval-rejected';

export type ConversationStreamErrorKind =
  | 'provider-or-host'
  | 'cancelled'
  | 'timeout';

export type ConversationLifecycleEvent =
  | { type: 'turn-started'; messageId: string }
  | { type: 'agent-reset' }
  /** Clears only the in-flight approval action, without dropping the pending request. */
  | { type: 'clear-approval-action' }
  /** Clears both the pending approval request and the in-flight approval action. */
  | { type: 'clear-approval' }
  | { type: 'text'; text: string }
  | {
      type: 'activity';
      callId: string;
      name: string;
      status: ConversationActivityStatus;
      detail?: string;
    }
  | { type: 'approval-required'; approval: ConversationStreamApproval }
  | { type: 'approval-resolved'; callId: string; name: string; approved: boolean }
  | { type: 'phase'; phase: ConversationStreamPhase }
  | { type: 'pause'; reason: ConversationStreamPauseReason }
  | { type: 'canonical-reload'; messages: ChatMessage[] }
  | {
      type: 'failure';
      kind: ConversationStreamErrorKind;
      messageId: string;
      message: string;
    };

export interface ConversationLifecycleSink {
  emit(event: ConversationLifecycleEvent): void;
}

export interface ConversationLifecycleOptions {
  runtime: ConversationRuntime;
  /** Canonical read used after completion and after failure so the stream never invents an Assistant message. */
  loadCanonicalMessages(): Promise<ChatMessage[] | null>;
  refreshSessionTitle(): void;
}

export interface ConversationSendInput {
  content: string;
  messageId: string;
  agentEnabled?: boolean;
}

export interface DispatchConversationTurnOptions {
  content: string;
  /** Reuse the same user-message id on retry so an uncertain reconnect cannot duplicate it. */
  messageId?: string;
  agentEnabled?: boolean;
  /**
   * Timestamp (ms) of the user message that started this turn. Used to tell a
   * canonical Assistant reply for *this* turn apart from older history, so a
   * failure is only suppressed when this turn's reply was already persisted.
   */
  userTimestamp: number;
}

export interface ConversationTurnOutcome {
  messageId: string;
  cancelled: boolean;
  /** True when an actionable failure was surfaced (never set for a user cancel). */
  failed: boolean;
}

export class ConversationOrchestrator {
  private abortRequested = false;

  constructor(
    private readonly options: ConversationLifecycleOptions,
    private readonly send: (
      input: ConversationSendInput,
    ) => Promise<AsyncIterable<RuntimeEvent>>,
  ) {}

  async dispatchTurn(
    input: DispatchConversationTurnOptions,
    sink: ConversationLifecycleSink,
    createMessageId: () => string,
  ): Promise<ConversationTurnOutcome> {
    const messageId = input.messageId ?? createMessageId();
    const useLocalAgent = Boolean(input.agentEnabled);

    this.abortRequested = false;
    sink.emit({ type: 'turn-started', messageId });
    if (useLocalAgent) {
      sink.emit({ type: 'agent-reset' });
      sink.emit({ type: 'phase', phase: 'thinking' });
    }

    const userTimestamp = input.userTimestamp;

    let replyText = '';
    let agentPaused = false;
    let sawToolResult = false;
    try {
      const stream = await this.send({
        content: input.content,
        messageId,
        agentEnabled: useLocalAgent,
      });
      for await (const event of stream) {
        if (this.abortRequested) break;
        if (event.type === 'text-delta') {
          replyText += event.delta;
          if (useLocalAgent && sawToolResult) {
            sink.emit({ type: 'phase', phase: 'continuing' });
          }
        } else if (useLocalAgent) {
          switch (event.type) {
            case 'tool-call':
              emitActivity(sink, event.callId, event.name, 'requested');
              break;
            case 'tool-running':
              emitActivity(sink, event.callId, event.name, 'running');
              sink.emit({ type: 'phase', phase: 'running-tool' });
              break;
            case 'approval-required':
              emitActivity(sink, event.callId, event.name, 'awaiting-approval');
              sink.emit({
                type: 'approval-required',
                approval: {
                  invocationId: event.invocationId,
                  callId: event.callId,
                  name: event.name,
                  message: event.message,
                  ...(event.scope ? { scope: event.scope } : {}),
                },
              });
              sink.emit({ type: 'clear-approval-action' });
              sink.emit({ type: 'phase', phase: 'waiting-approval' });
              break;
            case 'approval-resolved':
              emitActivity(
                sink,
                event.callId,
                event.name,
                event.decision === 'approved' ? 'approved' : 'rejected',
              );
              sink.emit({ type: 'clear-approval' });
              sink.emit({
                type: 'approval-resolved',
                callId: event.callId,
                name: event.name,
                approved: event.decision === 'approved',
              });
              sink.emit({
                type: 'phase',
                phase: event.decision === 'approved' ? 'running-tool' : 'paused',
              });
              break;
            case 'tool-result':
              sawToolResult = true;
              emitActivity(
                sink,
                event.callId,
                event.name,
                event.truncated ? 'truncated' : 'completed',
                event.truncated
                  ? `结果超过上下文限制，已截断后继续：${event.content}`
                  : event.content,
              );
              sink.emit({ type: 'phase', phase: 'continuing' });
              break;
            case 'run-paused':
              agentPaused = true;
              sink.emit({ type: 'clear-approval' });
              sink.emit({ type: 'pause', reason: event.reason });
              sink.emit({ type: 'phase', phase: 'paused' });
              break;
            case 'finish':
              if (event.reason !== 'tool_calls' && !agentPaused) {
                sink.emit({ type: 'phase', phase: 'completed' });
              }
              break;
            case 'error':
              sink.emit({ type: 'phase', phase: 'error' });
              throw new Error(event.message);
            default:
              break;
          }
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
        sink.emit({ type: 'text', text: replyText });
      }
      if (useLocalAgent && !agentPaused && !this.abortRequested) {
        sink.emit({ type: 'phase', phase: 'completed' });
      }

      const canonicalMessages = await this.options.loadCanonicalMessages();
      this.options.refreshSessionTitle();
      if (canonicalMessages) {
        sink.emit({ type: 'canonical-reload', messages: canonicalMessages });
      }
      return { messageId, cancelled: this.abortRequested, failed: false };
    } catch (error) {
      const canonicalMessages = await this.options.loadCanonicalMessages();
      this.options.refreshSessionTitle();
      if (canonicalMessages) {
        sink.emit({ type: 'canonical-reload', messages: canonicalMessages });
      }
      if (
        !this.abortRequested &&
        !hasCurrentTurnAssistant(canonicalMessages, messageId, userTimestamp)
      ) {
        const kind = classifyConversationSendError(error, this.options.runtime.kind);
        if (useLocalAgent) {
          sink.emit({ type: 'clear-approval' });
          sink.emit({ type: 'phase', phase: 'error' });
        }
        sink.emit({
          type: 'failure',
          kind,
          messageId,
          message: getChatSendErrorMessage(error, this.options.runtime.kind),
        });
        return { messageId, cancelled: false, failed: true };
      }
      return { messageId, cancelled: this.abortRequested, failed: false };
    }
  }

  cancel(): void {
    this.abortRequested = true;
    this.options.runtime.cancelActiveRun();
  }
}

const emitActivity = (
  sink: ConversationLifecycleSink,
  callId: string,
  name: string,
  status: ConversationActivityStatus,
  detail?: string,
): void => {
  sink.emit({
    type: 'activity',
    callId,
    name,
    status,
    ...(detail ? { detail } : {}),
  });
};

/**
 * True only when the canonical state already contains an Assistant reply that
 * belongs to *this* turn. An Assistant reply from an earlier turn must not
 * suppress a real failure (otherwise the user would silently lose the error and
 * the retry affordance on every turn after the first).
 *
 * The canonical user message is located by `messageId`; the Assistant must sit
 * after it. When the canonical read does not yet contain this turn's user
 * message, fall back to the turn's user timestamp.
 */
const hasCurrentTurnAssistant = (
  messages: ChatMessage[] | null,
  messageId: string,
  userTimestamp: number,
): boolean => {
  if (!messages) return false;
  const userIndex = messages.findIndex((message) => message.id === messageId);
  if (userIndex >= 0) {
    return messages
      .slice(userIndex + 1)
      .some((message) => message.role === 'assistant');
  }
  return messages.some(
    (message) =>
      message.role === 'assistant' &&
      message.timestamp.getTime() >= userTimestamp,
  );
};

export const classifyConversationSendError = (
  error: unknown,
  runtimeKind: RuntimeKind,
): ConversationStreamErrorKind => {
  const code = readErrorCode(error);
  if (code === 'REQUEST_ABORTED' || code === 'TOOL_CANCELLED') {
    return 'cancelled';
  }
  if (code === 'PROVIDER_TIMEOUT' || code === 'TOOL_STREAM_INCOMPLETE') {
    return 'timeout';
  }
  if (runtimeKind === 'local-provider' && isAbortError(error)) {
    return 'cancelled';
  }
  return 'provider-or-host';
};

const readErrorCode = (error: unknown): string | undefined => {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
};

const isAbortError = (error: unknown): boolean => {
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.message.includes('aborted');
  }
  return false;
};
