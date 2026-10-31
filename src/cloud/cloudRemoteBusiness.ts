import {
  parseRemoteChatStreamEvent,
  parseRemoteManifest,
  parseRemoteMessage,
  parseRemoteThread,
  type RemoteChatStreamEvent,
  type RemoteManifest,
  type RemoteMessage,
  type RemoteThread,
} from '../protocol/remoteHostV1';
import {
  isCloudRelayTransportError,
  openCloudRelayPostSse,
  requestCloudRelayJson,
} from '../api/cloudRelay';
import { RemoteHostError, type RemoteJsonRequest } from '../api/remoteHttp';
import type { PostSseSession } from '../api/postSse';
import type { SendRemoteMessageInput } from '../api/remoteMiraHost';
import {
  cloudRelayEntry,
  type CloudRelayAccess,
  type CloudRelayEntry,
} from './cloudRelayEntry';

type CloudJsonOperation<T> = Pick<
  RemoteJsonRequest<T>,
  'path' | 'method' | 'body' | 'signal' | 'parse' | 'raw'
>;
type CloudJsonTransport = typeof requestCloudRelayJson;
type CloudSseTransport = typeof openCloudRelayPostSse;

const parseArray = <T>(
  value: unknown,
  parse: (item: unknown) => T,
  description: string,
): T[] => {
  if (!Array.isArray(value)) throw new Error(description + ' must be an array');
  return value.map(parse);
};

const requireRoute = (
  manifest: RemoteManifest,
  kind: 'threads' | 'messages',
  route: string,
  scope: 'messages:write',
) => {
  if (!manifest.device.scopes.includes(scope) ||
      !manifest.routes[kind].includes(route)) {
    throw new RemoteHostError(
      'CLOUD_HOST_GRANT_REQUIRED',
      'Mira Desktop has not granted this Cloud device the requested operation',
      403,
    );
  }
};

/**
 * Cloud-only Remote Host V1 business path. The Cloud Relay ticket is used by
 * the WebSocket admission code, never by these HTTP-shaped Host requests.
 *
 * This deliberately does not implement Legacy pairing or transport fallback.
 * UI routing and approved endpoint provisioning are separate MOB-080 steps.
 */
export class CloudRemoteBusinessClient {
  constructor(
    private readonly entry: Pick<CloudRelayEntry, 'discover' | 'assertCurrentAccess' | 'reset'> =
      cloudRelayEntry,
    private readonly json: CloudJsonTransport = requestCloudRelayJson,
    private readonly sse: CloudSseTransport = openCloudRelayPostSse,
  ) {}

  reset(): void {
    this.entry.reset();
  }

  private async requestWithAccess<T>(
    access: CloudRelayAccess,
    operation: CloudJsonOperation<T>,
  ): Promise<T> {
    this.entry.assertCurrentAccess(access);
    const result = await this.json(access.target, access.tickets, {
      ...operation,
      hostUrl: access.target.endpoint,
      allowInsecureDevelopment: false,
      // No credential: Cloud business authority comes exclusively from the
      // Relay-provenance-bound Host grant enforced by Desktop Gateway/Harness.
    });
    this.entry.assertCurrentAccess(access);
    return result;
  }

  private async request<T>(operation: CloudJsonOperation<T>): Promise<T> {
    const access = await this.entry.discover();
    return this.requestWithAccess(access, operation);
  }

  private getManifestWithAccess(access: CloudRelayAccess): Promise<RemoteManifest> {
    return this.requestWithAccess(access, {
      path: '/remote/v1/manifest',
      parse: parseRemoteManifest,
    });
  }

  async getManifest(): Promise<RemoteManifest> {
    return this.request({ path: '/remote/v1/manifest', parse: parseRemoteManifest });
  }

  async listThreads(): Promise<RemoteThread[]> {
    return this.request({
      path: '/threads?status=active&sortBy=updatedAt&sortOrder=desc',
      parse: value => parseArray(value, parseRemoteThread, 'threads'),
    });
  }

  async getThread(threadId: string): Promise<RemoteThread> {
    return this.request({
      path: '/threads/' + encodeURIComponent(threadId),
      parse: parseRemoteThread,
    });
  }

  async getMessages(threadId: string): Promise<RemoteMessage[]> {
    return this.request({
      path: '/threads/' + encodeURIComponent(threadId) + '/messages',
      parse: value => parseArray(value, parseRemoteMessage, 'messages'),
    });
  }

  async createThread(title?: string): Promise<RemoteThread> {
    const access = await this.entry.discover();
    const manifest = await this.getManifestWithAccess(access);
    requireRoute(manifest, 'threads', 'POST /threads', 'messages:write');
    try {
      return await this.requestWithAccess(access, {
        path: '/threads',
        method: 'POST',
        body: title ? { title } : {},
        parse: parseRemoteThread,
      });
    } catch (error) {
      if (isCloudRelayTransportError(error)) {
        throw new RemoteHostError(
          'THREAD_CREATE_UNCERTAIN',
          'Desktop may have created this thread; refresh before retrying',
          undefined,
          error,
        );
      }
      throw error;
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    const access = await this.entry.discover();
    const manifest = await this.getManifestWithAccess(access);
    requireRoute(manifest, 'threads', 'DELETE /threads/:id', 'messages:write');
    try {
      await this.requestWithAccess(access, {
        path: '/threads/' + encodeURIComponent(threadId),
        method: 'DELETE',
        parse: () => undefined,
      });
    } catch (error) {
      if (isCloudRelayTransportError(error)) {
        throw new RemoteHostError(
          'THREAD_DELETE_UNCERTAIN',
          'Desktop may have deleted this thread; refresh before retrying',
          undefined,
          error,
        );
      }
      throw error;
    }
  }

  async sendMessage(input: SendRemoteMessageInput): Promise<PostSseSession<RemoteChatStreamEvent>> {
    const content = input.content.trim();
    if (!content) throw new RemoteHostError('EMPTY_MESSAGE', 'Message content cannot be empty');
    if (!input.messageId.trim()) {
      throw new RemoteHostError('MESSAGE_ID_REQUIRED', 'A stable message id is required');
    }

    const access = await this.entry.discover();
    const manifest = await this.getManifestWithAccess(access);
    if (!manifest.device.scopes.includes('messages:write')) {
      throw new RemoteHostError(
        'CLOUD_HOST_GRANT_REQUIRED',
        'Mira Desktop has not granted this Cloud device permission to send messages',
        403,
      );
    }

    const messages = input.messages?.length
      ? input.messages
      : [{
          id: input.messageId,
          role: 'user' as const,
          parts: [{ type: 'text' as const, text: content }],
        }];
    this.entry.assertCurrentAccess(access);
    // PostSseRequest requires a string credential for the Legacy path.
    // Empty here intentionally omits Authorization from the Relay request frame.
    return this.sse(access.target, access.tickets, {
      hostUrl: access.target.endpoint,
      allowInsecureDevelopment: false,
      credential: '',
      path: '/proxy/chat/default',
      body: {
        id: input.threadId,
        messageId: input.messageId,
        messages,
        ...(typeof input.agentEnabled === 'boolean'
          ? { agentEnabled: input.agentEnabled } : {}),
        ...(input.requestedToolGroupIds
          ? { requestedToolGroupIds: input.requestedToolGroupIds } : {}),
      },
      parse: parseRemoteChatStreamEvent,
    });
  }
}

export const cloudRemoteBusinessClient = new CloudRemoteBusinessClient();
