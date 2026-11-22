import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import {
  cloudRelayEntry,
  type CloudRelayEntry,
} from '../cloud/cloudRelayEntry';
import {
  openCloudRelayPostSse,
  requestCloudRelayJson,
} from '../api/cloudRelay';
import { RemoteHostError } from '../api/remoteHttp';
import { CloudToolHostClient } from './cloudToolHostClient';
import { CompositeToolGatewayClient } from './compositeToolGatewayClient';
import { localToolGatewayClient } from './localToolGatewayClient';
import { mobileToolGatewayClient } from './mobileToolGatewayClient';
import { RemoteToolGatewayClient } from './remoteToolGatewayClient';
import {
  ToolGatewayError,
  type ToolApprovalDecision,
  type ToolApprovalRequest,
  type ToolApprovalResolution,
  type ToolCallRequest,
  type ToolCallResult,
  type ToolDiscoveryNoticeCode,
  type ToolDiscoveryResult,
  type ToolGatewayClient,
  type ToolManifest,
} from './toolGatewayClient';

export interface CloudToolAccountContext {
  accountId: string | null;
  explicitlySignedOut: boolean;
  /** A revoked/rejected Cloud identity is not an intentional switch to pairing. */
  cloudSessionInvalid?: boolean;
}

type CloudToolEntry = Pick<
  CloudRelayEntry,
  'discoverSingleHost' | 'assertCurrentAccess' | 'reset'
>;

export interface LocalAgentToolGatewayOptions {
  local?: ToolGatewayClient;
  /** Existing Local + Legacy paired Host toolset, used only when signed out. */
  paired?: ToolGatewayClient;
  entry?: CloudToolEntry;
  cloudContext?: () => CloudToolAccountContext;
  json?: typeof requestCloudRelayJson;
  sse?: typeof openCloudRelayPostSse;
}

const currentCloudContext = (): CloudToolAccountContext => {
  const state = useCloudAccountStore.getState();
  return {
    accountId: state.account?.id ?? null,
    explicitlySignedOut: state.status === 'signed_out',
    cloudSessionInvalid:
      state.status === 'session_rejected' ||
      state.status === 'device_revoked',
  };
};

const UNAUTHORIZED_CODES = new Set([
  'CLOUD_TOOL_GRANT_REQUIRED',
  'CLOUD_TOOL_ROUTE_UNAVAILABLE',
  'CLOUD_HOST_GRANT_REQUIRED',
  'REMOTE_SCOPE_REQUIRED',
  'REMOTE_TOOL_ROUTE_UNAVAILABLE',
  'HTTP_403',
  'FORBIDDEN',
  'CLOUD_RELAY_TICKET_DENIED',
  'CLOUD_RELAY_TICKET_REJECTED',
]);

/** Only actual transport/Host availability faults may downgrade to local tools. */
const UNAVAILABLE_CODES = new Set([
  'CLOUD_RELAY_HOST_NOT_FOUND',
  'CLOUD_RELAY_HOST_OFFLINE',
  'CLOUD_RELAY_AUTH_UNAVAILABLE',
  'RELAY_HOST_OFFLINE',
  'RELAY_DISCONNECTED',
  'RELAY_NETWORK_ERROR',
  'RELAY_CONNECT_TIMEOUT',
  'RELAY_HANDSHAKE_TIMEOUT',
]);

const cloudNoticeFor = (
  error: unknown,
): ToolDiscoveryNoticeCode | null => {
  if (error instanceof ToolGatewayError) return null;
  if (!(error instanceof RemoteHostError)) return null;
  if (error.code === 'CLOUD_RELAY_HOST_AMBIGUOUS') {
    return 'cloud-tools-host-ambiguous';
  }
  if (
    error.code === 'CLOUD_RELAY_SESSION_REJECTED' ||
    error.code === 'CLOUD_RELAY_SESSION_REQUIRED'
  ) {
    return 'cloud-tools-session-invalid';
  }
  if (UNAUTHORIZED_CODES.has(error.code)) {
    return 'cloud-tools-unauthorized';
  }
  if (UNAVAILABLE_CODES.has(error.code)) {
    return 'cloud-tools-unavailable';
  }
  return null;
};

const discoveryOf = async (
  gateway: ToolGatewayClient,
): Promise<ToolDiscoveryResult> => {
  if (gateway.discoverTools) return gateway.discoverTools();
  return { tools: await gateway.listTools(), notices: [] };
};

/**
 * Resolves the Local Agent toolset once per run.
 *
 * The same instance must not be reused across runs: it captures the Cloud
 * account/Host access that produced the tool aliases, and a later run must
 * discover authority again instead of reusing a stale list or invocation.
 */
export class LocalAgentToolGateway implements ToolGatewayClient {
  private readonly local: ToolGatewayClient;
  private readonly paired: ToolGatewayClient;
  private readonly entry: CloudToolEntry;
  private readonly cloudContext: () => CloudToolAccountContext;
  private readonly json: typeof requestCloudRelayJson;
  private readonly sse: typeof openCloudRelayPostSse;
  private active: ToolGatewayClient | null = null;
  private pendingDiscovery: Promise<ToolDiscoveryResult> | null = null;

  constructor(options: LocalAgentToolGatewayOptions = {}) {
    this.local = options.local ?? localToolGatewayClient;
    this.paired = options.paired ?? mobileToolGatewayClient;
    this.entry = options.entry ?? cloudRelayEntry;
    this.cloudContext = options.cloudContext ?? currentCloudContext;
    this.json = options.json ?? requestCloudRelayJson;
    this.sse = options.sse ?? openCloudRelayPostSse;
  }

  async listTools(): Promise<readonly ToolManifest[]> {
    return (await this.discoverTools()).tools;
  }

  async discoverTools(): Promise<ToolDiscoveryResult> {
    if (this.pendingDiscovery) return this.pendingDiscovery;
    const pending = this.discoverOnce();
    this.pendingDiscovery = pending;
    try {
      return await pending;
    } finally {
      if (this.pendingDiscovery === pending) this.pendingDiscovery = null;
    }
  }

  async callTool(
    request: ToolCallRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ToolCallResult> {
    return this.requireActive().callTool(request, options);
  }

  async resolveApproval(
    approval: ToolApprovalRequest,
    decision: ToolApprovalDecision,
    options?: { signal?: AbortSignal },
  ): Promise<ToolApprovalResolution> {
    const active = this.requireActive();
    const resolve = active.resolveApproval;
    if (!resolve) {
      throw new ToolGatewayError(
        'TOOL_APPROVAL_UNSUPPORTED',
        'The active tool gateway does not support approval',
      );
    }
    return resolve.call(active, approval, decision, options);
  }

  private requireActive(): ToolGatewayClient {
    if (!this.active) {
      throw new ToolGatewayError(
        'TOOL_CHANNEL_UNAVAILABLE',
        'Local Agent tools were not discovered for this run',
      );
    }
    return this.active;
  }

  private async discoverOnce(): Promise<ToolDiscoveryResult> {
    const context = this.cloudContext();
    if (context.explicitlySignedOut) {
      this.active = this.paired;
      return discoveryOf(this.paired);
    }
    if (!context.accountId) {
      this.active = this.local;
      return {
        tools: await this.local.listTools(),
        notices: [{
          code: context.cloudSessionInvalid
            ? 'cloud-tools-session-invalid'
            : 'cloud-tools-unavailable',
        }],
      };
    }

    const accountId = context.accountId;
    try {
      const access = await this.entry.discoverSingleHost();
      if (access.accountId !== accountId) {
        throw new RemoteHostError(
          'CLOUD_TOOL_HOST_CHANGED',
          'The authorized Cloud Host changed during the Agent run',
          403,
        );
      }
      const remote = new RemoteToolGatewayClient(
        new CloudToolHostClient(
          accountId,
          this.entry,
          this.json,
          this.sse,
          changedAccountId => {
            const current = this.cloudContext();
            return (
              !current.explicitlySignedOut &&
              current.accountId === changedAccountId
            );
          },
        ),
      );
      const composite = new CompositeToolGatewayClient(this.local, remote);
      const discovery = await composite.discoverTools();
      this.active = composite;
      return discovery;
    } catch (error) {
      const notice = cloudNoticeFor(error);
      if (!notice) throw error;
      this.active = this.local;
      return {
        tools: await this.local.listTools(),
        notices: [{ code: notice }],
      };
    }
  }
}

/** A fresh gateway per Local Agent run keeps Cloud authority and tool IDs scoped. */
export const createLocalAgentToolGateway = (): ToolGatewayClient =>
  new LocalAgentToolGateway();
