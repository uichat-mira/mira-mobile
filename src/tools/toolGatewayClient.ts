export interface ToolManifest {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  destructive?: boolean;
  requiresApproval?: boolean;
}

export interface ToolCallRequest {
  callId: string;
  name: string;
  arguments: string;
}

export interface ToolCallResult {
  content: string;
}

export interface ToolApprovalRequest {
  invocationId: string;
  callId: string;
  name: string;
  arguments: string;
  message: string;
  scope?: string;
}

export type ToolApprovalDecision = 'approved' | 'rejected';

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
