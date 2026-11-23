import {
  ToolGatewayError,
  ToolApprovalRequiredError,
  type ToolApprovalRequest,
  type ToolApprovalDecision,
  type ToolApprovalResolution,
  type ToolCallRequest,
  type ToolCallResult,
  type ToolGatewayClient,
  type ToolManifest,
} from './toolGatewayClient';
import { weatherToolDefinition } from './localTools/weatherTool';
import { whoYouMailSearchTool, whoYouMailMessageTool, normalizeWhoYouMailSearchArgs } from './localTools/whoYouMailTools';

export interface LocalToolContext {
  signal?: AbortSignal;
}

export interface LocalToolDefinition {
  manifest: ToolManifest;
  /** Consent to send this tool's private result to the user's Local Provider. */
  disclosure?: { message: string; scope: string };
  call: (
    args: Record<string, unknown>,
    context: LocalToolContext,
  ) => Promise<ToolCallResult>;
}

// Consent text is trusted UI. Never interpolate raw model-controlled strings
// as extra lines or display a truncated value different from the executed one.
const disclosureArguments = (
  tool: string,
  args: Record<string, unknown>,
): { args: Record<string, unknown>; detail: string } => {
  if (tool === 'whoyou_mail_search') {
    const { query, limit, cursor } = normalizeWhoYouMailSearchArgs(args);
    const safe = JSON.stringify(query || '最近已同步邮件')
      .replace(/[\u2028\u2029]/gu, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
    return {
      args: { ...(query ? { query } : {}), limit, ...(cursor ? { cursor } : {}) },
      detail: `\n搜索词：${safe}\n本页上限：${limit} 封${cursor ? '\n继续分页：是' : ''}`,
    };
  }
  if (tool === 'whoyou_mail_message_get') {
    if (Object.keys(args).some(key => key !== 'messageId') ||
        typeof args.messageId !== 'string') {
      throw new ToolGatewayError('WHOYOU_ARGUMENT_INVALID', '邮件标识无效');
    }
    const messageId = args.messageId.trim();
    if (!messageId || messageId.length > 80) {
      throw new ToolGatewayError('WHOYOU_ARGUMENT_INVALID', '邮件标识无效');
    }
    const safe = JSON.stringify(messageId)
      .replace(/[\u2028\u2029]/gu, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
    return { args: { messageId }, detail: `\n邮件标识：${safe}` };
  }
  return { args, detail: '' };
};

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

/**
 * Executes a bounded allowlist of tools inside the Mobile app process. It is
 * intentionally not a shell, script runner or MCP host: every tool must be
 * compiled into the app and registered explicitly.
 */
export class LocalToolGatewayClient implements ToolGatewayClient {
  private readonly toolsByName: ReadonlyMap<string, LocalToolDefinition>;
  private nextApprovalId = 0;
  private pendingApproval: {
    approval: ToolApprovalRequest;
    tool: LocalToolDefinition;
    args: Record<string, unknown>;
    expiresAt: number;
  } | null = null;

  constructor(tools: readonly LocalToolDefinition[]) {
    const toolsByName = new Map<string, LocalToolDefinition>();
    for (const tool of tools) {
      if (toolsByName.has(tool.manifest.name)) {
        throw new Error(`Duplicate local tool name: ${tool.manifest.name}`);
      }
      toolsByName.set(tool.manifest.name, tool);
    }
    this.toolsByName = toolsByName;
  }

  async listTools(): Promise<readonly ToolManifest[]> {
    return Array.from(this.toolsByName.values(), (tool) => tool.manifest);
  }

  async callTool(
    request: ToolCallRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ToolCallResult> {
    const tool = this.toolsByName.get(request.name);
    if (!tool) {
      throw new ToolGatewayError(
        'TOOL_NOT_FOUND',
        `Local tool is not registered: ${request.name}`,
      );
    }

    const args = parseArguments(request.arguments);
    if (tool.disclosure) {
      const display = disclosureArguments(request.name, args);
      const approval: ToolApprovalRequest = {
        invocationId: `local-disclosure-${++this.nextApprovalId}`,
        callId: request.callId,
        name: request.name,
        arguments: request.arguments,
        message: tool.disclosure.message + display.detail,
        scope: tool.disclosure.scope,
      };
      // Only one outstanding Local Agent invocation exists per run. A later
      // request revokes the old permission; stale decisions are never reused.
      this.pendingApproval = {
        approval, tool, args: display.args, expiresAt: Date.now() + 5 * 60 * 1000,
      };
      throw new ToolApprovalRequiredError(approval);
    }
    return tool.call(args, {
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }

  async resolveApproval(
    approval: ToolApprovalRequest,
    decision: ToolApprovalDecision,
    options?: { signal?: AbortSignal },
  ): Promise<ToolApprovalResolution> {
    const pending = this.pendingApproval;
    this.pendingApproval = null;
    if (!pending ||
        pending.expiresAt <= Date.now() ||
        pending.approval.invocationId !== approval.invocationId ||
        pending.approval.callId !== approval.callId ||
        pending.approval.name !== approval.name ||
        pending.approval.arguments !== approval.arguments) {
      throw new ToolGatewayError('TOOL_APPROVAL_STALE', '本次邮件授权已失效，请重新请求。');
    }
    if (decision === 'rejected') return { status: 'rejected' };
    if (options?.signal?.aborted) {
      throw new ToolGatewayError('TOOL_CANCELLED', '邮件读取已取消。');
    }
    const result = await pending.tool.call(pending.args, {
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    if (options?.signal?.aborted) {
      throw new ToolGatewayError('TOOL_CANCELLED', '邮件读取已取消。');
    }
    return { status: 'completed', result };
  }
}

export const localToolGatewayClient = new LocalToolGatewayClient([
  weatherToolDefinition,
  whoYouMailSearchTool,
  whoYouMailMessageTool,
]);
