import type { ChatMessage, Session } from '../types';
import type { ToolApprovalDecision } from '../tools/toolGatewayClient';

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
      reason: 'app-suspended' | 'timeout' | 'cancelled' | 'approval-rejected';
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
  sendMessage(
    sessionId: string,
    input: string,
    options?: { agentEnabled?: boolean; messageId?: string },
  ): Promise<AsyncIterable<RuntimeEvent>>;
  cancelActiveRun(): void;
  getAgentEnabled?(sessionId: string): Promise<boolean>;
  setAgentEnabled?(sessionId: string, enabled: boolean): Promise<void>;
  resolveToolApproval?(
    invocationId: string,
    decision: ToolApprovalDecision,
  ): void;
  setExecutionSuspended?(suspended: boolean): void;
}
