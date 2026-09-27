import {
  remoteMiraHostClient,
  type RemoteMiraHostClient,
} from '../api/remoteMiraHost';
import { RemoteHostError } from '../api/remoteHttp';
import type { RemoteToolInvocationProjection } from '../protocol/remoteHostV1';
import {
  ToolApprovalRequiredError,
  ToolGatewayError,
  type ToolApprovalDecision,
  type ToolApprovalRequest,
  type ToolApprovalResolution,
  type ToolCallRequest,
  type ToolCallResult,
  type ToolGatewayClient,
  type ToolManifest,
} from './toolGatewayClient';

type RemoteToolHostClient = Pick<
  RemoteMiraHostClient,
  | 'listRemoteTools'
  | 'openToolInvocation'
  | 'resolveToolApproval'
  | 'cancelToolInvocation'
>;

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

const projectFailure = (
  invocation: RemoteToolInvocationProjection,
): ToolGatewayError =>
  new ToolGatewayError(
    invocation.error?.code ?? 'TOOL_' + invocation.status.toUpperCase(),
    invocation.error?.message ??
      (invocation.status === 'cancelled'
        ? 'Remote tool invocation was cancelled'
        : 'Remote tool invocation failed'),
    invocation.error?.retryable,
    invocation.error?.suggestedAction,
  );

const approvalFrom = (
  invocation: RemoteToolInvocationProjection,
  request: ToolCallRequest,
): ToolApprovalRequiredError =>
  new ToolApprovalRequiredError({
    invocationId: invocation.invocationId,
    callId: request.callId,
    name: request.name,
    arguments: request.arguments,
    message:
      invocation.approval?.message ??
      'Remote tool execution requires approval',
    ...(invocation.approval?.scope
      ? { scope: invocation.approval.scope }
      : {}),
  });

export class RemoteToolGatewayClient implements ToolGatewayClient {
  private canonicalToolIds = new Map<string, string>();

  constructor(
    private readonly hostClient: RemoteToolHostClient = remoteMiraHostClient,
  ) {}

  async listTools(): Promise<readonly ToolManifest[]> {
    const remoteTools = await this.hostClient.listRemoteTools();
    const nextToolIds = new Map<string, string>();

    const manifests = remoteTools.map(tool => {
      if (nextToolIds.has(tool.name)) {
        throw new ToolGatewayError(
          'TOOL_ALIAS_CONFLICT',
          'Remote tool alias is not unique: ' + tool.name,
        );
      }
      nextToolIds.set(tool.name, tool.id);
      return {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        destructive: tool.destructive,
        requiresApproval: tool.requiresApproval,
      };
    });

    this.canonicalToolIds = nextToolIds;
    return manifests;
  }

  async callTool(
    request: ToolCallRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<ToolCallResult> {
    const toolId = await this.resolveCanonicalToolId(request.name);
    const args = parseArguments(request.arguments);
    if (options.signal?.aborted) {
      throw new ToolGatewayError(
        'TOOL_CANCELLED',
        'Remote tool invocation was cancelled',
      );
    }

    const session = await this.hostClient.openToolInvocation({ toolId, args });
    let invocationId: string | null = null;
    let completion: RemoteToolInvocationProjection | null = null;
    let approvalEvent:
      | { message: string; scope?: string }
      | null = null;
    let cancellationRequested = false;
    let abortRequested = false;
    let fallbackAbortTimer: ReturnType<typeof setTimeout> | null = null;

    const clearFallbackAbort = () => {
      if (!fallbackAbortTimer) return;
      clearTimeout(fallbackAbortTimer);
      fallbackAbortTimer = null;
    };

    const requestRemoteCancellation = () => {
      if (cancellationRequested || !invocationId) return false;
      cancellationRequested = true;
      void this.hostClient.cancelToolInvocation(invocationId).catch(() => {
        // The Host also binds SSE disconnect to Harness cancellation.
      });
      return true;
    };

    const closeLocalStream = () => {
      clearFallbackAbort();
      session.abort();
    };

    const abort = () => {
      abortRequested = true;
      if (requestRemoteCancellation()) {
        closeLocalStream();
        return;
      }

      if (!fallbackAbortTimer) {
        fallbackAbortTimer = setTimeout(() => {
          // If tool:start never arrives, closing SSE is the bounded fallback.
          // Host V1 binds that disconnect to the running Harness AbortSignal.
          session.abort();
        }, 750);
      }
    };

    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) {
      abort();
    }

    try {
      for await (const event of session.events) {
        if (event.type === 'tool:start') {
          invocationId = event.invocationId;
          if (abortRequested || options.signal?.aborted) {
            requestRemoteCancellation();
            closeLocalStream();
          }
        } else if (event.type === 'tool:approval_required') {
          invocationId = event.invocationId;
          approvalEvent = {
            message: event.message,
            ...(event.scope ? { scope: event.scope } : {}),
          };
          if (abortRequested || options.signal?.aborted) {
            requestRemoteCancellation();
            closeLocalStream();
          }
        } else if (event.type === 'tool:error') {
          throw new ToolGatewayError(event.code, event.message);
        } else if (event.type === 'tool:complete') {
          completion =
            event.invocation.status === 'awaiting_approval' &&
            !event.invocation.approval &&
            approvalEvent
              ? { ...event.invocation, approval: approvalEvent }
              : event.invocation;
          invocationId = event.invocation.invocationId;
          if (abortRequested || options.signal?.aborted) {
            requestRemoteCancellation();
          }
        }
      }
    } catch (error) {
      if (options.signal?.aborted) {
        throw new ToolGatewayError(
          'TOOL_CANCELLED',
          'Remote tool invocation was cancelled',
        );
      }
      throw error;
    } finally {
      clearFallbackAbort();
      options.signal?.removeEventListener('abort', abort);
    }

    if (!completion) {
      if (abortRequested || options.signal?.aborted) {
        throw new ToolGatewayError(
          'TOOL_CANCELLED',
          'Remote tool invocation was cancelled',
        );
      }
      throw new ToolGatewayError(
        'TOOL_STREAM_INCOMPLETE',
        'Remote tool stream ended without a final result',
      );
    }

    return this.resolveCompletion(completion, request);
  }

  async resolveApproval(
    approval: ToolApprovalRequest,
    decision: ToolApprovalDecision,
    options: { signal?: AbortSignal } = {},
  ): Promise<ToolApprovalResolution> {
    const toolId = await this.resolveCanonicalToolId(approval.name);
    const args = parseArguments(approval.arguments);
    let invocation: RemoteToolInvocationProjection;
    try {
      invocation = await this.hostClient.resolveToolApproval({
        invocationId: approval.invocationId,
        decision,
        toolId,
        args,
        signal: options.signal,
      });
    } catch (error) {
      if (
        error instanceof RemoteHostError &&
        error.code === 'TOOL_APPROVAL_UNCERTAIN'
      ) {
        throw new ToolGatewayError(error.code, error.message);
      }
      throw error;
    }

    if (decision === 'rejected' && invocation.status === 'cancelled') {
      return { status: 'rejected' };
    }
    if (invocation.status === 'completed') {
      return {
        status: 'completed',
        result: { content: invocation.content ?? '' },
      };
    }
    if (invocation.status === 'awaiting_approval') {
      throw approvalFrom(invocation, {
        callId: approval.callId,
        name: approval.name,
        arguments: approval.arguments,
      });
    }
    throw projectFailure(invocation);
  }

  private async resolveCanonicalToolId(name: string): Promise<string> {
    let toolId = this.canonicalToolIds.get(name);
    if (!toolId) {
      await this.listTools();
      toolId = this.canonicalToolIds.get(name);
    }
    if (!toolId) {
      throw new ToolGatewayError(
        'TOOL_NOT_AVAILABLE',
        'Remote tool is not available: ' + name,
      );
    }
    return toolId;
  }

  private resolveCompletion(
    invocation: RemoteToolInvocationProjection,
    request: ToolCallRequest,
  ): ToolCallResult {
    if (invocation.status === 'completed') {
      return { content: invocation.content ?? '' };
    }
    if (invocation.status === 'awaiting_approval') {
      throw approvalFrom(invocation, request);
    }
    throw projectFailure(invocation);
  }
}

export const remoteToolGatewayClient = new RemoteToolGatewayClient();
