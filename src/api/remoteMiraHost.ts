import { Platform } from 'react-native';
import {
  parsePairingClaimResponse,
  parsePairingPollResponse,
  parseRemoteAgentRun,
  parseRemoteChatStreamEvent,
  parseRemoteManifest,
  parseRemoteMessage,
  parseRemoteThread,
  parseRemoteToolGatewayStreamEvent,
  parseRemoteToolInvocationProjection,
  parseRemoteToolManifest,
  type PairingClaimResponse,
  type PairingPollResponse,
  type RemoteAgentRun,
  type RemoteChatStreamEvent,
  type RemoteDeviceScope,
  type RemoteManifest,
  type RemoteMessage,
  type RemoteThread,
  type RemoteToolGatewayStreamEvent,
  type RemoteToolInvocationProjection,
  type RemoteToolManifest,
} from '../protocol/remoteHostV1';
import {
  parsePairingUriV1,
  type PairingDescriptorV1,
  type RemoteRelayEndpoint,
} from '../protocol/remotePairingV1';
import {
  deviceCredentialStore,
  type DeviceCredentialStore,
  type StoredDeviceCredential,
} from '../security/deviceCredentialStore';
import { openPostSse, type PostSseRequest, type PostSseSession } from './postSse';
import {
  RemoteHostError,
  requestRemoteJson,
  type RemoteJsonRequest,
} from './remoteHttp';
import {
  closeRelayConnections,
  isRelayTransportError,
  openRelayPostSse,
  requestRelayJson,
} from './remoteRelay';

export interface MobileDeviceIdentity {
  name: string;
  platform?: string;
  publicKey?: string;
  requestedScopes?: RemoteDeviceScope[];
}

export type RemoteTransportKind = 'direct' | 'relay';

export interface RemoteTransportAttemptDiagnostic {
  transport: RemoteTransportKind;
  code: string;
  status?: number;
  hostResponded: boolean;
  authoritativeHostOffline: boolean;
}

export interface PendingPairing {
  descriptor: PairingDescriptorV1;
  transport: RemoteTransportKind;
  claimId: string;
  pollToken: string;
  expiresAt: string;
}

export interface RestoredRemoteConnection {
  credential: StoredDeviceCredential;
  manifest: RemoteManifest;
}

export interface RemoteToolInvocationInput {
  toolId: string;
  args?: Record<string, unknown>;
}

export interface RemoteToolApprovalInput {
  invocationId: string;
  decision: 'approved' | 'rejected';
  toolId: string;
  args?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface SendRemoteMessageInput {
  threadId: string;
  messageId: string;
  content: string;
  messages?: Array<{
    id?: string;
    role: 'system' | 'user' | 'assistant';
    parts: RemoteMessage['parts'];
  }>;
  agentEnabled?: boolean;
  requestedToolGroupIds?: string[];
}

type RemoteJsonTransport = <T>(request: RemoteJsonRequest<T>) => Promise<T>;
type RemoteSseTransport = typeof openPostSse;
type RemoteRelayJsonTransport = typeof requestRelayJson;
type RemoteRelaySseTransport = typeof openRelayPostSse;
type JsonOperation<T> = Omit<
  RemoteJsonRequest<T>,
  'hostUrl' | 'allowInsecureDevelopment'
>;
type SseOperation<T> = Omit<
  PostSseRequest<T>,
  'hostUrl' | 'allowInsecureDevelopment'
>;
type RemoteEndpoints = {
  hostUrl: string | null;
  relay: RemoteRelayEndpoint | null;
};

type PairingClaimWithTransport = PairingClaimResponse & {
  transport: RemoteTransportKind;
};

const DIRECT_RETRY_COOLDOWN_MS = 30_000;

const parseArray = <T>(
  value: unknown,
  itemParser: (item: unknown) => T,
  context: string,
): T[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }
  return value.map(itemParser);
};

const normalizeDeviceName = (value: string) => {
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, 80);
  return normalized || 'Mira Mobile';
};

const isDirectNetworkError = (error: unknown) =>
  error instanceof RemoteHostError && error.code === 'NETWORK_ERROR';

const snapshotTransportAttempt = (
  transport: RemoteTransportKind,
  error: unknown,
): RemoteTransportAttemptDiagnostic => {
  if (error instanceof RemoteHostError) {
    return {
      transport,
      code: error.code,
      ...(error.status === undefined ? {} : { status: error.status }),
      hostResponded:
        error.status !== undefined && error.code !== 'RELAY_HOST_OFFLINE',
      authoritativeHostOffline: error.code === 'RELAY_HOST_OFFLINE',
    };
  }
  return {
    transport,
    code: 'UNKNOWN_REMOTE_FAILURE',
    hostResponded: false,
    authoritativeHostOffline: false,
  };
};

const attachTransportAttempts = (
  error: unknown,
  transportAttempts: RemoteTransportAttemptDiagnostic[],
): unknown => {
  if (!(error instanceof RemoteHostError) || transportAttempts.length === 0) {
    return error;
  }
  return new RemoteHostError(error.code, error.message, error.status, {
    transportAttempts,
    causeDetails: error.details,
  });
};

const REMOTE_TOOL_ROUTES = {
  list: 'GET /remote/v1/tools',
  invoke: 'POST /remote/v1/tool-invocations/stream',
  approval: 'POST /remote/v1/tool-invocations/:invocationId/approval',
  cancel: 'POST /remote/v1/tool-invocations/:invocationId/cancel',
} as const;

export class RemoteMiraHostClient {
  private activeCredential: StoredDeviceCredential | null = null;
  private directRetryAfter = 0;

  constructor(
    private readonly credentialStore: DeviceCredentialStore = deviceCredentialStore,
    private readonly jsonTransport: RemoteJsonTransport = requestRemoteJson,
    private readonly sseTransport: RemoteSseTransport = openPostSse,
    private readonly relayJsonTransport: RemoteRelayJsonTransport = requestRelayJson,
    private readonly relaySseTransport: RemoteRelaySseTransport = openRelayPostSse,
  ) {}

  isSecureStorageAvailable() {
    return this.credentialStore.isAvailable();
  }

  async getStoredHostUrl(): Promise<string | null> {
    const stored = await this.credentialStore.load();
    return stored?.hostUrl ?? null;
  }

  async claimPairingUri(
    pairingUri: string,
    identity: MobileDeviceIdentity,
  ): Promise<PendingPairing> {
    const descriptor = parsePairingUriV1(pairingUri);
    const claim = await this.claimPairing(descriptor, identity);
    return {
      descriptor,
      transport: claim.transport,
      claimId: claim.claimId,
      pollToken: claim.pollToken,
      expiresAt: claim.expiresAt,
    };
  }

  async claimPairing(
    descriptor: PairingDescriptorV1,
    identity: MobileDeviceIdentity,
  ): Promise<PairingClaimWithTransport> {
    const transport = await this.selectPairingTransport(descriptor);
    let claim: PairingClaimResponse;
    try {
      claim = await this.claimPairingOnTransport(descriptor, identity, transport);
    } catch (error) {
      if (
        isDirectNetworkError(error) ||
        (transport === 'relay' && isRelayTransportError(error))
      ) {
        throw new RemoteHostError(
          'PAIRING_CLAIM_UNCERTAIN',
          'Mira Desktop may have received the pairing request; do not retry through another transport',
          undefined,
          error,
        );
      }
      throw error;
    }
    return { ...claim, transport };
  }

  async pollPairing(pending: PendingPairing): Promise<PairingPollResponse> {
    const result = await this.requestJsonOnTransport(
      pending.descriptor,
      pending.transport,
      {
        path: `/remote/pairing/claims/${encodeURIComponent(pending.claimId)}/poll`,
        method: 'POST',
        body: { pollToken: pending.pollToken },
        parse: parsePairingPollResponse,
      },
    );

    if (!result.credential) {
      return result;
    }
    if (!result.deviceId) {
      throw new RemoteHostError(
        'INVALID_PAIRING_RESPONSE',
        'Mira Host returned a credential without a device id',
      );
    }

    const stored: StoredDeviceCredential = {
      hostUrl: pending.descriptor.hostUrl,
      relay: pending.descriptor.relay,
      credential: result.credential,
      deviceId: result.deviceId,
      scopes: result.scopes,
      savedAt: new Date().toISOString(),
    };
    await this.credentialStore.save(stored);
    this.activeCredential = stored;

    try {
      const manifest = await this.getManifestWithCredential(stored);
      if (manifest.device.id !== result.deviceId) {
        await this.credentialStore.clear();
        this.activeCredential = null;
        throw new RemoteHostError(
          'DEVICE_ID_MISMATCH',
          'Paired device identity does not match the Host manifest',
        );
      }

      const verified: StoredDeviceCredential = {
        ...stored,
        scopes: manifest.device.scopes,
      };
      await this.credentialStore.save(verified);
      this.activeCredential = verified;
      return result;
    } catch (error) {
      if (
        error instanceof RemoteHostError &&
        (error.status === 401 || error.status === 403)
      ) {
        await this.credentialStore.clear();
        this.activeCredential = null;
      }
      throw error;
    }
  }

  async restoreConnection(): Promise<RestoredRemoteConnection | null> {
    const stored = await this.credentialStore.load();
    if (!stored) {
      this.activeCredential = null;
      return null;
    }

    try {
      const manifest = await this.getManifestWithCredential(stored);
      const refreshed: StoredDeviceCredential = {
        ...stored,
        deviceId: manifest.device.id,
        scopes: manifest.device.scopes,
      };
      this.activeCredential = refreshed;
      return { credential: refreshed, manifest };
    } catch (error) {
      if (
        error instanceof RemoteHostError &&
        (error.status === 401 || error.status === 403)
      ) {
        await this.credentialStore.clear();
        this.activeCredential = null;
      }
      throw error;
    }
  }

  async disconnect() {
    this.activeCredential = null;
    this.directRetryAfter = 0;
    closeRelayConnections();
    await this.credentialStore.clear();
  }

  /** Drop stale Relay sockets after the app returns from the background. */
  refreshRelayConnection() {
    closeRelayConnections();
  }

  async getManifest(signal?: AbortSignal): Promise<RemoteManifest> {
    const credential = await this.requireCredential();
    return this.getManifestWithCredential(credential, signal);
  }

  async listThreads(): Promise<RemoteThread[]> {
    return this.withCredential(credential =>
      this.requestCredentialJson(credential, {
        path: '/threads?status=active&sortBy=updatedAt&sortOrder=desc',
        credential: credential.credential,
        parse: value => parseArray(value, parseRemoteThread, 'threads'),
      }),
    );
  }

  async getThread(threadId: string): Promise<RemoteThread> {
    return this.withCredential(credential =>
      this.requestCredentialJson(credential, {
        path: `/threads/${encodeURIComponent(threadId)}`,
        credential: credential.credential,
        parse: parseRemoteThread,
      }),
    );
  }

  async getMessages(threadId: string): Promise<RemoteMessage[]> {
    return this.withCredential(credential =>
      this.requestCredentialJson(credential, {
        path: `/threads/${encodeURIComponent(threadId)}/messages`,
        credential: credential.credential,
        parse: value => parseArray(value, parseRemoteMessage, 'messages'),
      }),
    );
  }

  async createThread(title?: string): Promise<RemoteThread> {
    return this.withCredential(async credential => {
      const operation: JsonOperation<RemoteThread> = {
        path: '/threads',
        method: 'POST',
        credential: credential.credential,
        body: title ? { title } : {},
        parse: parseRemoteThread,
      };
      const order = this.transportOrder(credential);
      let lastError: unknown = new RemoteHostError(
        'REMOTE_ENDPOINT_UNAVAILABLE',
        'No Mira remote endpoint is available for creating a thread',
      );

      // Pick a reachable transport using an idempotent manifest probe first.
      // Once POST /threads is dispatched we never replay it through another
      // transport because a lost response cannot prove the Host did not create it.
      for (let index = 0; index < order.length; index += 1) {
        const transport = order[index];
        try {
          await this.requestJsonOnTransport(credential, transport, {
            path: '/remote/v1/manifest',
            credential: credential.credential,
            parse: parseRemoteManifest,
          });
          if (transport === 'direct') this.directRetryAfter = 0;
        } catch (error) {
          lastError = error;
          const hasNext = index + 1 < order.length;
          if (!hasNext) throw error;
          if (transport === 'direct' && isDirectNetworkError(error)) {
            this.directRetryAfter = Date.now() + DIRECT_RETRY_COOLDOWN_MS;
            continue;
          }
          if (transport === 'relay' && isRelayTransportError(error)) {
            continue;
          }
          throw error;
        }

        try {
          return await this.requestJsonOnTransport(
            credential,
            transport,
            operation,
          );
        } catch (error) {
          if (
            (transport === 'direct' && isDirectNetworkError(error)) ||
            (transport === 'relay' && isRelayTransportError(error))
          ) {
            throw new RemoteHostError(
              'THREAD_CREATE_UNCERTAIN',
              'Mira Host may have created the conversation; refresh the conversation list before retrying',
              undefined,
              error,
            );
          }
          throw error;
        }
      }

      throw lastError;
    });
  }

  async renameThread(threadId: string, title: string): Promise<RemoteThread> {
    return this.withCredential(credential =>
      this.requestCredentialJson(credential, {
        path: `/threads/${encodeURIComponent(threadId)}`,
        method: 'PATCH',
        credential: credential.credential,
        body: { title },
        parse: parseRemoteThread,
      }),
    );
  }

  async deleteThread(threadId: string): Promise<void> {
    return this.withCredential(credential =>
      this.requestCredentialJson(credential, {
        path: `/threads/${encodeURIComponent(threadId)}`,
        method: 'DELETE',
        credential: credential.credential,
        parse: () => undefined,
      }),
    );
  }

  async sendMessage(
    input: SendRemoteMessageInput,
  ): Promise<PostSseSession<RemoteChatStreamEvent>> {
    const content = input.content.trim();
    if (!content) {
      throw new RemoteHostError('EMPTY_MESSAGE', 'Message content cannot be empty');
    }
    if (!input.messageId.trim()) {
      throw new RemoteHostError(
        'MESSAGE_ID_REQUIRED',
        'A stable message id is required for reconnect-safe sending',
      );
    }

    const messages = input.messages?.length
      ? input.messages
      : [
          {
            id: input.messageId,
            role: 'user' as const,
            parts: [{ type: 'text' as const, text: content }],
          },
        ];

    return this.withCredential(async credential => {
      const sseOperation: SseOperation<RemoteChatStreamEvent> = {
        path: '/proxy/chat/default',
        credential: credential.credential,
        body: {
          id: input.threadId,
          messageId: input.messageId,
          messages,
          ...(typeof input.agentEnabled === 'boolean'
            ? { agentEnabled: input.agentEnabled }
            : {}),
          ...(input.requestedToolGroupIds
            ? { requestedToolGroupIds: input.requestedToolGroupIds }
            : {}),
        },
        parse: parseRemoteChatStreamEvent,
      };

      // Probe with an idempotent manifest read before opening the side-effecting
      // chat stream. This chooses Direct or Relay without blindly replaying POST.
      // If the selected transport fails between the probe and the SSE open, retry
      // with the other transport.
      const order = this.transportOrder(credential);
      let lastError: unknown = new RemoteHostError(
        'REMOTE_ENDPOINT_UNAVAILABLE',
        'No Mira remote endpoint is available for sending a message',
      );

      for (let index = 0; index < order.length; index += 1) {
        const transport = order[index];
        try {
          // Probe — idempotent, safe to retry.
          await this.requestJsonOnTransport(credential, transport, {
            path: '/remote/v1/manifest',
            credential: credential.credential,
            parse: parseRemoteManifest,
          });
          if (transport === 'direct') this.directRetryAfter = 0;
          // Open SSE on the confirmed transport.
          return this.openSseOnTransport(credential, transport, sseOperation);
        } catch (error) {
          lastError = error;
          const hasNext = index + 1 < order.length;
          if (!hasNext) throw error;

          if (transport === 'direct' && isDirectNetworkError(error)) {
            this.directRetryAfter = Date.now() + DIRECT_RETRY_COOLDOWN_MS;
            continue;
          }
          if (transport === 'relay' && isRelayTransportError(error)) {
            continue;
          }
          throw error;
        }
      }

      throw lastError;
    });
  }

  async listRemoteTools(): Promise<RemoteToolManifest[]> {
    return this.withCredentialScope('tools:read', async credential => {
      const manifest = await this.getManifestWithCredential(credential);
      this.assertRemoteToolRoute(manifest, REMOTE_TOOL_ROUTES.list);
      return this.requestCredentialJson(credential, {
        path: '/remote/v1/tools',
        credential: credential.credential,
        parse: value => parseArray(value, parseRemoteToolManifest, 'remoteTools'),
      });
    });
  }

  async openToolInvocation(
    input: RemoteToolInvocationInput,
  ): Promise<PostSseSession<RemoteToolGatewayStreamEvent>> {
    return this.withCredentialScope('tools:invoke', async credential => {
      const operation: SseOperation<RemoteToolGatewayStreamEvent> = {
        path: '/remote/v1/tool-invocations/stream',
        credential: credential.credential,
        body: {
          toolId: input.toolId,
          args: input.args ?? {},
        },
        parse: parseRemoteToolGatewayStreamEvent,
      };

      const order = this.transportOrder(credential);
      let lastError: unknown = new RemoteHostError(
        'REMOTE_ENDPOINT_UNAVAILABLE',
        'No Mira remote endpoint is available for tool execution',
      );

      for (let index = 0; index < order.length; index += 1) {
        const transport = order[index];
        try {
          const manifest = await this.requestJsonOnTransport(credential, transport, {
            path: '/remote/v1/manifest',
            credential: credential.credential,
            parse: parseRemoteManifest,
          });
          this.assertRemoteToolRoute(manifest, REMOTE_TOOL_ROUTES.invoke);
          if (transport === 'direct') this.directRetryAfter = 0;
          return this.openSseOnTransport(credential, transport, operation);
        } catch (error) {
          lastError = error;
          const hasNext = index + 1 < order.length;
          if (!hasNext) throw error;

          if (transport === 'direct' && isDirectNetworkError(error)) {
            this.directRetryAfter = Date.now() + DIRECT_RETRY_COOLDOWN_MS;
            continue;
          }
          if (transport === 'relay' && isRelayTransportError(error)) {
            continue;
          }
          throw error;
        }
      }

      throw lastError;
    });
  }

  async resolveToolApproval(
    input: RemoteToolApprovalInput,
  ): Promise<RemoteToolInvocationProjection> {
    return this.withCredentialScope('tools:approve', async credential =>
      this.dispatchCredentialJsonMutationOnce(credential, {
        path: `/remote/v1/tool-invocations/${encodeURIComponent(input.invocationId)}/approval`,
        method: 'POST',
        credential: credential.credential,
        signal: input.signal,
        body: {
          decision: input.decision,
          toolId: input.toolId,
          args: input.args ?? {},
        },
        parse: parseRemoteToolInvocationProjection,
      }, 'TOOL_APPROVAL_UNCERTAIN', REMOTE_TOOL_ROUTES.approval),
    );
  }

  async cancelToolInvocation(
    invocationId: string,
  ): Promise<{ invocationId: string; accepted: boolean; status: string }> {
    return this.withCredentialScope('tools:control', async credential => {
      const manifest = await this.getManifestWithCredential(credential);
      this.assertRemoteToolRoute(manifest, REMOTE_TOOL_ROUTES.cancel);
      return this.requestCredentialJson(credential, {
        path: `/remote/v1/tool-invocations/${encodeURIComponent(invocationId)}/cancel`,
        method: 'POST',
        credential: credential.credential,
        parse: value => {
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
        },
      });
    });
  }

  async getAgentRun(runId: string, signal?: AbortSignal): Promise<RemoteAgentRun> {
    return this.agentRequest(runId, 'GET', '', signal);
  }

  async approveAgentRun(runId: string): Promise<RemoteAgentRun> {
    return this.agentRequest(runId, 'POST', '/approve');
  }

  async rejectAgentRun(runId: string): Promise<RemoteAgentRun> {
    return this.agentRequest(runId, 'POST', '/reject');
  }

  async cancelAgentRun(runId: string): Promise<RemoteAgentRun> {
    return this.agentRequest(runId, 'POST', '/cancel');
  }

  getThreadMediaRequest(threadId: string, mediaId: string) {
    return this.requireCredential().then(credential => {
      if (!credential.hostUrl) {
        throw new RemoteHostError(
          'DIRECT_MEDIA_ENDPOINT_REQUIRED',
          'This media request currently requires a Direct Mira Host endpoint',
        );
      }
      return {
        url: `${credential.hostUrl}/threads/${encodeURIComponent(threadId)}/media/${encodeURIComponent(mediaId)}/content`,
        headers: { Authorization: `Bearer ${credential.credential}` },
      };
    });
  }

  private async selectPairingTransport(
    descriptor: PairingDescriptorV1,
  ): Promise<RemoteTransportKind> {
    if (descriptor.relay) {
      try {
        await this.requestJsonOnTransport(descriptor, 'relay', {
          path: '/health',
          raw: true,
          parse: value => value,
        });
        return 'relay';
      } catch (error) {
        if (!isRelayTransportError(error) || !descriptor.hostUrl) throw error;
      }
    }

    if (!descriptor.hostUrl) {
      throw new RemoteHostError(
        'PAIRING_ENDPOINT_UNAVAILABLE',
        'No Mira pairing endpoint is available',
      );
    }

    await this.jsonTransport({
      hostUrl: descriptor.hostUrl,
      path: '/health',
      allowInsecureDevelopment: __DEV__,
      raw: true,
      parse: value => value,
    });
    this.directRetryAfter = 0;
    return 'direct';
  }

  private async claimPairingOnTransport(
    descriptor: PairingDescriptorV1,
    identity: MobileDeviceIdentity,
    transport: RemoteTransportKind,
  ): Promise<PairingClaimResponse> {
    return this.requestJsonOnTransport(descriptor, transport, {
      path: '/remote/pairing/claim',
      method: 'POST',
      body: {
        challengeId: descriptor.challengeId,
        code: descriptor.code,
        deviceName: normalizeDeviceName(identity.name),
        platform: identity.platform ?? Platform.OS,
        transport,
        ...(identity.publicKey ? { publicKey: identity.publicKey } : {}),
        ...(identity.requestedScopes
          ? { requestedScopes: identity.requestedScopes }
          : {}),
      },
      parse: parsePairingClaimResponse,
    });
  }

  private async getManifestWithCredential(
    credential: StoredDeviceCredential,
    signal?: AbortSignal,
  ): Promise<RemoteManifest> {
    return this.requestCredentialJson(credential, {
      path: '/remote/v1/manifest',
      credential: credential.credential,
      signal,
      parse: parseRemoteManifest,
    });
  }

  private async agentRequest(
    runId: string,
    method: 'GET' | 'POST',
    suffix: string,
    signal?: AbortSignal,
  ): Promise<RemoteAgentRun> {
    return this.withCredential(credential =>
      this.requestCredentialJson(credential, {
        path: `/agent/runs/${encodeURIComponent(runId)}${suffix}`,
        method,
        credential: credential.credential,
        signal,
        parse: parseRemoteAgentRun,
      }),
    );
  }

  private assertRemoteToolRoute(
    manifest: RemoteManifest,
    route: string,
  ) {
    if (!manifest.routes.tools.includes(route)) {
      throw new RemoteHostError(
        'REMOTE_TOOL_ROUTE_UNAVAILABLE',
        `Mira Host does not advertise required tool route: ${route}`,
        undefined,
        { route },
      );
    }
  }

  private async withCredentialScope<T>(
    scope: RemoteDeviceScope,
    operation: (credential: StoredDeviceCredential) => Promise<T>,
  ): Promise<T> {
    const credential = await this.requireCredential();
    if (!credential.scopes.includes(scope)) {
      throw new RemoteHostError(
        'REMOTE_SCOPE_REQUIRED',
        `Paired device is missing required scope: ${scope}`,
        403,
        { scope },
      );
    }

    try {
      return await operation(credential);
    } catch (error) {
      if (
        error instanceof RemoteHostError &&
        error.status === 401
      ) {
        this.activeCredential = null;
        await this.credentialStore.clear();
      }
      throw error;
    }
  }

  private async dispatchCredentialJsonMutationOnce<T>(
    credential: StoredDeviceCredential,
    operation: JsonOperation<T>,
    uncertainCode: string,
    requiredToolRoute?: string,
  ): Promise<T> {
    const order = this.transportOrder(credential);
    let lastError: unknown = new RemoteHostError(
      'REMOTE_ENDPOINT_UNAVAILABLE',
      'No Mira remote endpoint is available',
    );

    for (let index = 0; index < order.length; index += 1) {
      const transport = order[index];
      try {
        const manifest = await this.requestJsonOnTransport(credential, transport, {
          path: '/remote/v1/manifest',
          credential: credential.credential,
          parse: parseRemoteManifest,
        });
        if (requiredToolRoute) {
          this.assertRemoteToolRoute(manifest, requiredToolRoute);
        }
        if (transport === 'direct') this.directRetryAfter = 0;
      } catch (error) {
        lastError = error;
        const hasNext = index + 1 < order.length;
        if (!hasNext) throw error;
        if (transport === 'direct' && isDirectNetworkError(error)) {
          this.directRetryAfter = Date.now() + DIRECT_RETRY_COOLDOWN_MS;
          continue;
        }
        if (transport === 'relay' && isRelayTransportError(error)) {
          continue;
        }
        throw error;
      }

      try {
        return await this.requestJsonOnTransport(credential, transport, operation);
      } catch (error) {
        if (
          (transport === 'direct' && isDirectNetworkError(error)) ||
          (transport === 'relay' && isRelayTransportError(error))
        ) {
          throw new RemoteHostError(
            uncertainCode,
            'Mira Host may have accepted the tool control request; refresh the invocation state before retrying',
            undefined,
            error,
          );
        }
        throw error;
      }
    }

    throw lastError;
  }

  private async requestCredentialJson<T>(
    credential: StoredDeviceCredential,
    operation: JsonOperation<T>,
  ): Promise<T> {
    const result = await this.requestAcrossEndpoints(credential, operation);
    return result.value;
  }

  private async requestAcrossEndpoints<T>(
    endpoints: RemoteEndpoints,
    operation: JsonOperation<T>,
  ): Promise<{ value: T; transport: RemoteTransportKind }> {
    const order = this.transportOrder(endpoints);
    const transportAttempts: RemoteTransportAttemptDiagnostic[] = [];
    let lastError: unknown = new RemoteHostError(
      'REMOTE_ENDPOINT_UNAVAILABLE',
      'No Mira remote endpoint is available',
    );

    for (let index = 0; index < order.length; index += 1) {
      const transport = order[index];
      try {
        const value = await this.requestJsonOnTransport(
          endpoints,
          transport,
          operation,
        );
        if (transport === 'direct') this.directRetryAfter = 0;
        return { value, transport };
      } catch (error) {
        lastError = error;
        transportAttempts.push(snapshotTransportAttempt(transport, error));
        const hasNext = index + 1 < order.length;
        if (!hasNext) {
          throw attachTransportAttempts(error, transportAttempts);
        }

        if (transport === 'direct' && isDirectNetworkError(error)) {
          this.directRetryAfter = Date.now() + DIRECT_RETRY_COOLDOWN_MS;
          continue;
        }
        if (transport === 'relay' && isRelayTransportError(error)) {
          continue;
        }
        throw attachTransportAttempts(error, transportAttempts);
      }
    }

    throw attachTransportAttempts(lastError, transportAttempts);
  }

  private transportOrder(endpoints: RemoteEndpoints): RemoteTransportKind[] {
    const hasDirect = Boolean(endpoints.hostUrl);
    const hasRelay = Boolean(endpoints.relay);
    if (hasDirect && hasRelay) {
      return Date.now() >= this.directRetryAfter
        ? ['direct', 'relay']
        : ['relay', 'direct'];
    }
    if (hasDirect) return ['direct'];
    if (hasRelay) return ['relay'];
    return [];
  }

  private requestJsonOnTransport<T>(
    endpoints: RemoteEndpoints,
    transport: RemoteTransportKind,
    operation: JsonOperation<T>,
  ): Promise<T> {
    if (transport === 'direct') {
      if (!endpoints.hostUrl) {
        return Promise.reject(
          new RemoteHostError(
            'DIRECT_ENDPOINT_UNAVAILABLE',
            'Direct Mira Host endpoint is unavailable',
          ),
        );
      }
      return this.jsonTransport({
        ...operation,
        hostUrl: endpoints.hostUrl,
        allowInsecureDevelopment: __DEV__,
      });
    }

    if (!endpoints.relay) {
      return Promise.reject(
        new RemoteHostError(
          'RELAY_ENDPOINT_UNAVAILABLE',
          'Mira Relay endpoint is unavailable',
        ),
      );
    }
    return this.relayJsonTransport(endpoints.relay, {
      ...operation,
      hostUrl: endpoints.relay.endpoint,
      allowInsecureDevelopment: false,
    });
  }

  private openSseOnTransport<T>(
    endpoints: RemoteEndpoints,
    transport: RemoteTransportKind,
    operation: SseOperation<T>,
  ): PostSseSession<T> {
    if (transport === 'direct') {
      if (!endpoints.hostUrl) {
        throw new RemoteHostError(
          'DIRECT_ENDPOINT_UNAVAILABLE',
          'Direct Mira Host endpoint is unavailable',
        );
      }
      return this.sseTransport({
        ...operation,
        hostUrl: endpoints.hostUrl,
        allowInsecureDevelopment: __DEV__,
      });
    }

    if (!endpoints.relay) {
      throw new RemoteHostError(
        'RELAY_ENDPOINT_UNAVAILABLE',
        'Mira Relay endpoint is unavailable',
      );
    }
    return this.relaySseTransport(endpoints.relay, {
      ...operation,
      hostUrl: endpoints.relay.endpoint,
      allowInsecureDevelopment: false,
    });
  }

  private async withCredential<T>(
    operation: (credential: StoredDeviceCredential) => Promise<T>,
  ): Promise<T> {
    const credential = await this.requireCredential();
    try {
      return await operation(credential);
    } catch (error) {
      if (
        error instanceof RemoteHostError &&
        (error.status === 401 || error.status === 403)
      ) {
        this.activeCredential = null;
        await this.credentialStore.clear();
      }
      throw error;
    }
  }

  private async requireCredential(): Promise<StoredDeviceCredential> {
    if (this.activeCredential) {
      return this.activeCredential;
    }

    const stored = await this.credentialStore.load();
    if (!stored) {
      throw new RemoteHostError(
        'PAIRING_REQUIRED',
        'This mobile device is not paired with a Mira Host',
      );
    }
    this.activeCredential = stored;
    return stored;
  }
}

export const remoteMiraHostClient = new RemoteMiraHostClient();
