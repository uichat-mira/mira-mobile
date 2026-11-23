export interface ToolManifest {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  destructive?: boolean;
  requiresApproval?: boolean;
  /** Private data: restrict subsequent tool exposure after it reaches a model. */
  sensitiveResult?: 'mail-search' | 'mail-body';
}

export interface ToolCallRequest {
  callId: string;
  name: string;
  arguments: string;
}

export interface ToolCallResult {
  content: string;
  /** An Agent-requested Host discovery is shown as a deterministic clarification. */
  hostSelectionRequired?: boolean;
  /** Fresh, authorized candidates, re-checked when the model requests discovery. */
  hostCandidates?: readonly ToolDiscoveryHostCandidate[];
  /** Verified run-bound tools exposed only after the model explicitly discovers a single Host. */
  refreshedTools?: readonly ToolManifest[];
}

/** Model-visible, read-only entry for finding an authorized Mira Desktop. */
export const DESKTOP_HOST_DISCOVERY_TOOL = 'mira_desktop_hosts';

export interface ToolApprovalRequest {
  invocationId: string;
  callId: string;
  name: string;
  arguments: string;
  message: string;
  scope?: string;
}

export type ToolApprovalDecision = 'approved' | 'rejected';

/**
 * Non-fatal findings from tool discovery. These must be user-visible so a
 * partially available toolset is never presented as complete.
 */
export type ToolDiscoveryNoticeCode =
  | 'toolset-degraded'
  | 'cloud-tools-unavailable'
  | 'cloud-tools-unauthorized'
  | 'cloud-tools-session-invalid'
  | 'cloud-tools-host-ambiguous';

export interface ToolDiscoveryNotice {
  code: ToolDiscoveryNoticeCode;
}

/**
 * Real, server-owned Cloud Desktop Host identities exposed to the Local Agent
 * only when a tool run must ask the user to choose a target. Transport rooms,
 * tickets and credentials are never part of this projection.
 */
export interface ToolDiscoveryHostCandidate {
  hostId: string;
  name: string | null;
  toolNames: readonly string[];
}

export interface ToolDiscoveryResult {
  tools: readonly ToolManifest[];
  notices: readonly ToolDiscoveryNotice[];
  /**
   * Present only when multiple usable Hosts remain after real reachability and
   * grant checks. The Local Agent must ask instead of guessing.
   */
  hostCandidates?: readonly ToolDiscoveryHostCandidate[];
}

export type ToolApprovalResolution =
  | { status: 'completed'; result: ToolCallResult }
  | { status: 'rejected' };

export class ToolApprovalRequiredError extends Error {
  constructor(public readonly approval: ToolApprovalRequest) {
    super(approval.message);
    this.name = 'ToolApprovalRequiredError';
  }
}

export class ToolGatewayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable?: boolean,
    public readonly suggestedAction?: string | null,
  ) {
    super(message);
    this.name = 'ToolGatewayError';
  }
}

/**
 * Protocol-neutral boundary for approved remote tools. The concrete transport
 * stays behind an adapter; model/provider credentials never enter this contract.
 */
export interface ToolGatewayClient {
  listTools(): Promise<readonly ToolManifest[]>;
  /**
   * Discovery with partial-availability information. Gateways that can degrade
   * (for example local tools staying usable while the Host is unreachable)
   * implement this; callers fall back to `listTools()` when absent.
   */
  discoverTools?(): Promise<ToolDiscoveryResult>;
  callTool(
    request: ToolCallRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ToolCallResult>;
  resolveApproval?(
    approval: ToolApprovalRequest,
    decision: ToolApprovalDecision,
    options?: { signal?: AbortSignal },
  ): Promise<ToolApprovalResolution>;
}
