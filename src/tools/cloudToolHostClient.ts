import {
  isCloudRelayHostOfflineError,
  isCloudRelayTransportError,
  openCloudRelayPostSse,
  requestCloudRelayJson,
} from '../api/cloudRelay';
import { RemoteHostError, type RemoteJsonRequest } from '../api/remoteHttp';
import type { PostSseSession } from '../api/postSse';
import {
  cloudRelayEntry,
  type CloudRelayAccess,
  type CloudRelayEntry,
} from '../cloud/cloudRelayEntry';
import {
  parseRemoteManifest,
  parseRemoteToolGatewayStreamEvent,
  parseRemoteToolInvocationProjection,
  parseRemoteToolManifest,
  type RemoteDeviceScope,
  type RemoteManifest,
  type RemoteToolGatewayStreamEvent,
  type RemoteToolInvocationProjection,
  type RemoteToolManifest,
} from '../protocol/remoteHostV1';

const REMOTE_TOOL_ROUTES = {
  list: 'GET /remote/v1/tools',
  invoke: 'POST /remote/v1/tool-invocations/stream',
  approval: 'POST /remote/v1/tool-invocations/:invocationId/approval',
  cancel: 'POST /remote/v1/tool-invocations/:invocationId/cancel',
} as const;

const TOOL_SCOPES: Record<keyof typeof REMOTE_TOOL_ROUTES, RemoteDeviceScope> = {
  list: 'tools:read',
  invoke: 'tools:invoke',
  approval: 'tools:approve',
  cancel: 'tools:control',
};

type ToolRoute = keyof typeof REMOTE_TOOL_ROUTES;

type CloudToolEntry = Pick<
  CloudRelayEntry,
  'discoverSingleHost' | 'assertCurrentAccess' | 'reset'
>;

type CloudJsonTransport = typeof requestCloudRelayJson;
type CloudSseTransport = typeof openCloudRelayPostSse;

const parseRemoteToolList = (value: unknown): RemoteToolManifest[] => {
  if (!Array.isArray(value)) {
    throw new Error('remoteTools must be an array');
  }
  return value.map(parseRemoteToolManifest);
};

const parseCancellation = (
  value: unknown,
): { invocationId: string; accepted: boolean; status: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool cancellation response must be an object');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.invocationId !== 'string' ||
    typeof record.accepted !== 'boolean' ||
    typeof record.status !== 'string'
  ) {
    throw new Error('Tool cancellation response is incomplete');
  }
  return {
    invocationId: record.invocationId,
    accepted: record.accepted,
    status: record.status,
  };
};

const hostChanged = (): RemoteHostError =>
  new RemoteHostError(
    'CLOUD_TOOL_HOST_CHANGED',
    'The authorized Cloud Host changed during the Agent run',
    403,
  );

const assertToolGrant = (
  manifest: RemoteManifest,
  route: ToolRoute,
): void => {
  const scope = TOOL_SCOPES[route];
  if (!manifest.device.scopes.includes(scope)) {
    throw new RemoteHostError(
      'CLOUD_TOOL_GRANT_REQUIRED',
      `Mira Desktop has not granted this Cloud device the ${scope} scope`,
      403,
    );
  }
  if (!manifest.routes.tools.includes(REMOTE_TOOL_ROUTES[route])) {
    throw new RemoteHostError(
      'CLOUD_TOOL_ROUTE_UNAVAILABLE',
      `Mira Desktop does not advertise the ${REMOTE_TOOL_ROUTES[route]} tool route`,
      403,
    );
  }
};

/**
 * Cloud identity/transport counterpart of the paired Remote Host tool client.
 *
 * It exposes only the four methods `RemoteToolGatewayClient` consumes, keeps
 * Relay tickets inside the shared Cloud transport, and never sends the Legacy
 * `mira_device_*` credential or a Host Provider key. Every operation re-checks
 * the same Cloud account/Host/access binding before touching Host state.
 */
export class CloudToolHostClient {
  private boundAccess: CloudRelayAccess | null = null;

  constructor(
    private readonly accountId: string,
    private readonly entry: CloudToolEntry = cloudRelayEntry,
    private readonly json: CloudJsonTransport = requestCloudRelayJson,
    private readonly sse: CloudSseTransport = openCloudRelayPostSse,
    private readonly accountIsCurrent: (accountId: string) => boolean = () => true,
  ) {}

  private assertOwner(): void {
    if (!this.accountIsCurrent(this.accountId)) throw hostChanged();
  }

  private async currentAccess(): Promise<CloudRelayAccess> {
    this.assertOwner();
    const access = await this.entry.discoverSingleHost();
    this.assertOwner();
    this.entry.assertCurrentAccess(access);
    if (access.accountId !== this.accountId) throw hostChanged();
    if (this.boundAccess && this.boundAccess !== access) throw hostChanged();
    this.boundAccess = access;
    return access;
  }

  private async requestJson<T>(
    access: CloudRelayAccess,
    operation: Omit<RemoteJsonRequest<T>, 'hostUrl' | 'allowInsecureDevelopment'>,
  ): Promise<T> {
    this.assertOwner();
    this.entry.assertCurrentAccess(access);
    const result = await this.json(access.target, access.tickets, {
      ...operation,
      hostUrl: access.target.endpoint,
      allowInsecureDevelopment: false,
    });
    this.assertOwner();
    this.entry.assertCurrentAccess(access);
    return result;
  }

  private async manifest(access: CloudRelayAccess): Promise<RemoteManifest> {
    return this.requestJson(access, {
      path: '/remote/v1/manifest',
      parse: parseRemoteManifest,
    });
  }

  async listRemoteTools(): Promise<RemoteToolManifest[]> {
    const access = await this.currentAccess();
    assertToolGrant(await this.manifest(access), 'list');
    return this.requestJson(access, {
      path: '/remote/v1/tools',
      parse: parseRemoteToolList,
    });
  }

  async openToolInvocation(input: {
    toolId: string;
    args?: Record<string, unknown>;
  }): Promise<PostSseSession<RemoteToolGatewayStreamEvent>> {
    const access = await this.currentAccess();
    assertToolGrant(await this.manifest(access), 'invoke');
    this.entry.assertCurrentAccess(access);

    const session = this.sse(access.target, access.tickets, {
      hostUrl: access.target.endpoint,
      allowInsecureDevelopment: false,
      // Cloud Host authority comes from the verified Cloud grant, not a
      // business bearer token. Relay admission is handled by the ticket source.
      credential: '',
      path: '/remote/v1/tool-invocations/stream',
      body: {
        toolId: input.toolId,
        args: input.args ?? {},
      },
      parse: parseRemoteToolGatewayStreamEvent,
    });

    const entry = this.entry;
    const assertOwner = () => this.assertOwner();
    return {
      events: (async function* () {
        for await (const event of session.events) {
          assertOwner();
          entry.assertCurrentAccess(access);
          yield event;
        }
      })(),
      abort: () => session.abort(),
    };
  }

  async resolveToolApproval(input: {
    invocationId: string;
    decision: 'approved' | 'rejected';
    toolId: string;
    args?: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<RemoteToolInvocationProjection> {
    const access = await this.currentAccess();
    assertToolGrant(await this.manifest(access), 'approval');
    try {
      return await this.requestJson(access, {
        path: `/remote/v1/tool-invocations/${encodeURIComponent(input.invocationId)}/approval`,
        method: 'POST',
        signal: input.signal,
        body: {
          decision: input.decision,
          toolId: input.toolId,
          args: input.args ?? {},
        },
        parse: parseRemoteToolInvocationProjection,
      });
    } catch (error) {
      // The approval POST can be side-effecting. A Relay loss means the Host
      // may already have acted, so the caller must refresh instead of retrying.
      if (isCloudRelayTransportError(error) || isCloudRelayHostOfflineError(error)) {
        throw new RemoteHostError(
          'TOOL_APPROVAL_UNCERTAIN',
          'Mira Desktop may have accepted the approval; refresh the current state before retrying',
          undefined,
          error,
        );
      }
      throw error;
    }
  }

  async cancelToolInvocation(
    invocationId: string,
  ): Promise<{ invocationId: string; accepted: boolean; status: string }> {
    const access = await this.currentAccess();
    assertToolGrant(await this.manifest(access), 'cancel');
    try {
      return await this.requestJson(access, {
        path: `/remote/v1/tool-invocations/${encodeURIComponent(invocationId)}/cancel`,
        method: 'POST',
        parse: parseCancellation,
      });
    } catch (error) {
      if (isCloudRelayTransportError(error) || isCloudRelayHostOfflineError(error)) {
        throw new RemoteHostError(
          'TOOL_CANCEL_UNCERTAIN',
          'Mira Desktop may still be running the tool; refresh before retrying',
          undefined,
          error,
        );
      }
      throw error;
    }
  }
}
