import {
  ToolGatewayError,
  ToolApprovalRequiredError,
  type ToolApprovalDecision,
  type ToolApprovalRequest,
  type ToolApprovalResolution,
  type ToolCallRequest,
  type ToolCallResult,
  type ToolDiscoveryResult,
  type ToolDisclosureRequest,
  type ToolDisclosureResult,
  type ToolGatewayClient,
  type ToolManifest,
  type ToolServiceDescriptor,
} from './toolGatewayClient';
import { resolveToolDisclosureTarget } from './toolDisclosure';
import { McpProtocolError } from '../mcp/mcpProtocolClient';
import type { McpServiceDegradation } from '../mcp/mcpServiceCapabilities';

export interface McpServiceSnapshot {
  service: ToolServiceDescriptor;
  /** Every real, locally permitted tool with its authoritative schema. */
  tools: readonly ToolManifest[];
  catalogRevision: string;
  /**
   * Tools already visible without disclosure. Defaults to `tools`; pass an
   * empty list to require on-demand disclosure for this service.
   */
  visibleTools?: readonly ToolManifest[];
  degradation?: McpServiceDegradation;
  /** Revalidates the account/credential/identity binding before any use. */
  assertCurrent?: () => void;
}

export interface McpServiceToolGatewayOptions {
  snapshot: McpServiceSnapshot;
  /**
   * Executes an already-authorized tool call. Who You delegates this to the
   * existing MailStage/approval gateway so untrusted-content handling and user
   * consent are not reimplemented here.
   */
  executeTool(
    request: ToolCallRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ToolCallResult>;
  resolveToolApproval?(
    approval: ToolApprovalRequest,
    decision: ToolApprovalDecision,
    options?: { signal?: AbortSignal },
  ): Promise<ToolApprovalResolution>;
}

const parseArguments = (value: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || '{}') as unknown;
  } catch {
    throw new ToolGatewayError(
      'TOOL_ARGUMENTS_INVALID',
      'Tool arguments are not valid JSON',
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ToolGatewayError(
      'TOOL_ARGUMENTS_INVALID',
      'Tool arguments must be a JSON object',
    );
  }
  return parsed as Record<string, unknown>;
};

const asGatewayError = (error: unknown): never => {
  if (error instanceof ToolGatewayError) throw error;
  if (error instanceof ToolApprovalRequiredError) throw error;
  if (error instanceof McpProtocolError) {
    if (error.kind === 'cancelled') {
      throw new ToolGatewayError('TOOL_CANCELLED', 'MCP tool call was cancelled');
    }
    if (error.kind === 'unauthorized') {
      throw new ToolGatewayError(
        'MCP_SERVICE_UNAUTHORIZED',
        'The MCP service no longer accepts this run credential',
      );
    }
    if (error.kind === 'unavailable' || error.kind === 'network') {
      throw new ToolGatewayError(
        'MCP_SERVICE_UNAVAILABLE',
        'The MCP service is temporarily unavailable',
        true,
      );
    }
    throw new ToolGatewayError(
      'MCP_SERVICE_REJECTED',
      'The MCP service rejected the tool call',
    );
  }
  throw error;
};

/**
 * MOB-094 Tool Gateway adapter for one trusted MCP service.
 *
 * Discovery and schema authority come from the real MCP `tools/list`; the
 * optional capability resource only groups already-permitted real tools. A
 * call is rechecked against the bound account/credential and can only target a
 * tool that this adapter declared. It never fabricates a tool from model text
 * or a description.
 */
export class McpServiceToolGateway implements ToolGatewayClient {
  private readonly snapshot: McpServiceSnapshot;
  private readonly executeTool: McpServiceToolGatewayOptions['executeTool'];
  private readonly resolveToolApproval?: McpServiceToolGatewayOptions['resolveToolApproval'];
  private readonly byName: ReadonlyMap<string, ToolManifest>;
  private readonly callableNames: ReadonlySet<string>;

  constructor(options: McpServiceToolGatewayOptions) {
    this.snapshot = options.snapshot;
    this.executeTool = options.executeTool;
    this.resolveToolApproval = options.resolveToolApproval;
    this.byName = new Map(options.snapshot.tools.map((tool) => [tool.name, tool]));
    this.callableNames = new Set(options.snapshot.service.toolNames);
  }

  get serviceId(): string {
    return this.snapshot.service.id;
  }

  get service(): ToolServiceDescriptor {
    return this.snapshot.service;
  }

  get catalogRevision(): string {
    return this.snapshot.catalogRevision;
  }

  get ownedToolNames(): ReadonlySet<string> {
    return this.callableNames;
  }

  private assertCurrent(): void {
    this.snapshot.assertCurrent?.();
  }

  async listTools(): Promise<readonly ToolManifest[]> {
    this.assertCurrent();
    return this.snapshot.visibleTools ?? this.snapshot.tools;
  }

  async discoverTools(): Promise<ToolDiscoveryResult> {
    this.assertCurrent();
    const degraded = this.snapshot.degradation !== undefined &&
      this.snapshot.degradation !== 'none' &&
      this.snapshot.degradation !== 'no-resource';
    return {
      tools: this.snapshot.visibleTools ?? this.snapshot.tools,
      services: [this.snapshot.service],
      notices: degraded ? [{ code: 'mcp-service-degraded' }] : [],
      catalogRevision: this.snapshot.catalogRevision,
    };
  }

  async discloseTools(
    request: ToolDisclosureRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ToolDisclosureResult> {
    try {
      this.assertCurrent();
      if (options?.signal?.aborted) {
        throw new ToolGatewayError('TOOL_CANCELLED', 'MCP disclosure was cancelled');
      }
      if (request.catalogRevision !== undefined &&
          request.catalogRevision !== this.snapshot.catalogRevision) {
        throw new ToolGatewayError(
          'TOOL_DISCLOSURE_STALE',
          'The trusted MCP catalog changed before disclosure',
        );
      }
      const target = resolveToolDisclosureTarget([this.snapshot.service], request);
      const tools = target.toolNames.map((name) => {
        const tool = this.byName.get(name);
        if (!tool) {
          throw new ToolGatewayError(
            'TOOL_DISCLOSURE_NOT_AVAILABLE',
            'A declared MCP tool schema is no longer available',
          );
        }
        return tool;
      });
      return { tools, catalogRevision: this.snapshot.catalogRevision };
    } catch (error) {
      return asGatewayError(error);
    }
  }

  async callTool(
    request: ToolCallRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ToolCallResult> {
    try {
      this.assertCurrent();
      if (!this.callableNames.has(request.name)) {
        throw new ToolGatewayError(
          'TOOL_NOT_DECLARED',
          `MCP tool is not declared for this run: ${request.name}`,
        );
      }
      const args = parseArguments(request.arguments);
      return await this.executeTool(
        { ...request, arguments: JSON.stringify(args) },
        options,
      );
    } catch (error) {
      return asGatewayError(error);
    }
  }

  async resolveApproval(
    approval: ToolApprovalRequest,
    decision: ToolApprovalDecision,
    options?: { signal?: AbortSignal },
  ): Promise<ToolApprovalResolution> {
    if (!this.resolveToolApproval) {
      throw new ToolGatewayError(
        'TOOL_APPROVAL_UNSUPPORTED',
        'The MCP service gateway does not own this approval',
      );
    }
    if (!this.callableNames.has(approval.name)) {
      throw new ToolGatewayError(
        'TOOL_APPROVAL_STALE',
        'This approval does not belong to the MCP service binding',
      );
    }
    return this.resolveToolApproval(approval, decision, options);
  }
}
