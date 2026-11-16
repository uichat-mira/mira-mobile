import { RemoteHostError } from '../api/remoteHttp';
import {
  ToolGatewayError,
  type ToolApprovalDecision,
  type ToolApprovalRequest,
  type ToolApprovalResolution,
  type ToolCallRequest,
  type ToolCallResult,
  type ToolDiscoveryResult,
  type ToolGatewayClient,
  type ToolManifest,
} from './toolGatewayClient';

const HOST_AVAILABILITY_ERROR_CODES = new Set([
  'PAIRING_REQUIRED',
  'NETWORK_ERROR',
  'REQUEST_ABORTED',
  'REMOTE_ENDPOINT_UNAVAILABLE',
  'REMOTE_TOOL_ROUTE_UNAVAILABLE',
]);

/**
 * Only an unreachable or unpaired Host may be downgraded to a local-only
 * toolset. Scope loss, auth failures, alias conflicts and malformed responses
 * are configuration or protocol defects, and hiding them behind "temporarily
 * unavailable" would leave the user without the re-pair / bug-report guidance.
 */
const isHostAvailabilityError = (error: unknown): boolean => {
  if (!(error instanceof RemoteHostError)) return false;
  if (error.status !== undefined && error.status >= 500) return true;
  return HOST_AVAILABILITY_ERROR_CODES.has(error.code);
};

/**
 * Keeps read-only local tools available even when no paired Mira Host can
 * answer tool discovery, while still exposing Host tools when they are
 * reachable. Local tools win on name collisions so a remote manifest can never
 * take over a compiled-in Mobile tool.
 */
export class CompositeToolGatewayClient implements ToolGatewayClient {
  constructor(
    private readonly local: ToolGatewayClient,
    private readonly remote: ToolGatewayClient,
  ) {}

  async listTools(): Promise<readonly ToolManifest[]> {
    return (await this.discoverTools()).tools;
  }

  async discoverTools(): Promise<ToolDiscoveryResult> {
    const localTools = await this.local.listTools();
    let remoteTools: readonly ToolManifest[] = [];
    let notices: ToolDiscoveryResult['notices'] = [];
    try {
      remoteTools = await this.remote.listTools();
    } catch (error) {
      // Local-only Agent mode is a supported state: an unpaired or temporarily
      // unreachable Host must not hide the local read-only toolset. Everything
      // else is rethrown so the real failure reaches the user-facing mapper.
      if (!isHostAvailabilityError(error)) throw error;
      notices = [{ code: 'toolset-degraded' }];
    }

    const seen = new Set(localTools.map((tool) => tool.name));
    const merged = [...localTools];
    for (const tool of remoteTools) {
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      merged.push(tool);
    }
    return { tools: merged, notices };
  }

  async callTool(
    request: ToolCallRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ToolCallResult> {
    const localTools = await this.local.listTools();
    if (localTools.some((tool) => tool.name === request.name)) {
      return this.local.callTool(request, options);
    }
    return this.remote.callTool(request, options);
  }

  resolveApproval(
    approval: ToolApprovalRequest,
    decision: ToolApprovalDecision,
    options?: { signal?: AbortSignal },
  ): Promise<ToolApprovalResolution> {
    const resolve = this.remote.resolveApproval;
    if (!resolve) {
      return Promise.reject(
        new ToolGatewayError(
          'TOOL_APPROVAL_UNSUPPORTED',
          'The active tool gateway does not support approval',
        ),
      );
    }
    return resolve.call(this.remote, approval, decision, options);
  }
}
