import type { ChatMessage, Session } from '../types';
import type { ToolApprovalDecision } from '../tools/toolGatewayClient';
import type { LocalProviderModelOption } from './localProviderModelSelection';

export type RuntimeKind = 'remote-host' | 'local-provider';

export type RuntimeEvent =
  | { type: 'text-delta'; delta: string }
  | {
      type: 'tool-call';
      callId: string;
      name: string;
      arguments: string;
    }
  | { type: 'finish'; reason: string | null }
  | { type: 'tool-running'; callId: string; name: string }
  | {
      type: 'tool-result';
      callId: string;
      name: string;
      content: string;
      truncated?: boolean;
      failed?: boolean;
    }
  | {
      type: 'approval-required';
      invocationId: string;
      callId: string;
      name: string;
      message: string;
      scope?: string;
    }
  | {
      type: 'approval-resolved';
      invocationId: string;
      callId: string;
      name: string;
      decision: ToolApprovalDecision;
    }
  | {
      type: 'run-paused';
      reason: 'app-suspended' | 'timeout' | 'cancelled' | 'approval-rejected' | 'budget-exhausted';
    }
  /**
   * Non-error, user-visible signal that does not stop the turn. Emitted, for
   * example, when Agent mode proceeds without tools because the approved tool
   * channel is unreachable; the UI must surface it so the skipped tooling is
   * never hidden from the user.
   */
  | {
      type: 'notice';
      code:
        | 'tool-channel-unavailable'
        | 'toolset-degraded'
        | 'cloud-tools-unavailable'
        | 'cloud-tools-unauthorized'
        | 'cloud-tools-session-invalid'
        | 'cloud-tools-host-ambiguous'
        | 'mcp-service-degraded';
    }
  | { type: 'error'; message: string };

export interface ConversationRuntime {
  readonly kind: RuntimeKind;
  /** True only when the runtime has a confirmed tool gateway implementation. */
  readonly supportsAgent?: boolean;
  listSessions(): Promise<Session[]>;
  deleteSession(sessionId: string): Promise<void>;
  getMessages(sessionId: string): Promise<ChatMessage[]>;
  /** Snapshot read used for canonical UI state such as the session title. */
  getSession?(sessionId: string): Promise<Session>;
  /** Server-confirmed message write permission (Cloud Host pilot). */
  canSendMessage?(sessionId?: string): Promise<boolean>;
  sendMessage(
    sessionId: string,
    input: string,
    options?: { messageId?: string },
  ): Promise<AsyncIterable<RuntimeEvent>>;
  cancelActiveRun(): void;
  /** Local Provider thread-level execution-strength APIs. */
  getAgentStrengthOverride?(
    sessionId: string,
  ): Promise<import('../settings/agentExecutionStrength').AgentExecutionStrengthId | null>;
  setAgentStrength?(
    sessionId: string,
    strength: import('../settings/agentExecutionStrength').AgentExecutionStrengthId,
  ): Promise<void>;
  resetAgentStrength?(sessionId: string): Promise<void>;
  getEffectiveAgentStrength?(
    sessionId: string,
  ): Promise<import('../settings/agentExecutionStrength').AgentExecutionStrengthId>;
  /**
   * Local Provider model selection for the conversation composer. Options come
   * only from the user's configured Providers; `selected` reflects the
   * persisted session selection. Selecting persists the Provider/model pair for
   * the next send without recreating the conversation.
   */
  listLocalProviderModels?(
    sessionId: string,
  ): Promise<LocalProviderModelOption[]>;
  getSelectedLocalProviderModel?(
    sessionId: string,
  ): Promise<LocalProviderModelOption | null>;
  selectLocalProviderModel?(
    sessionId: string,
    providerId: string,
  ): Promise<LocalProviderModelOption>;
  resolveToolApproval?(
    invocationId: string,
    decision: ToolApprovalDecision,
  ): void;
  setExecutionSuspended?(suspended: boolean): void;
}
