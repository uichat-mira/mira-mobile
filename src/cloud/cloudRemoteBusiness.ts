import {
  parseRemoteChatStreamEvent,
  parseRemoteManifest,
  type RemoteChatStreamEvent,
  type RemoteManifest,
} from '../protocol/remoteHostV1';
import {
  isCloudRelayTransportError,
  openCloudRelayPostSse,
  requestCloudRelayJson,
} from '../api/cloudRelay';
import { RemoteHostError } from '../api/remoteHttp';
import type { PostSseSession } from '../api/postSse';
import {
  CLOUD_HOST_GRANT_POLICY,
  RemoteHostBusinessClient,
  type RemoteHostBusinessChannel,
  type RemoteHostBusinessChatRequest,
  type RemoteHostBusinessJsonRequest,
  type SendRemoteMessageInput,
} from '../api/remoteHostBusiness';
import {
  cloudRelayEntry,
  type CloudRelayAccess,
  type CloudRelayEntry,
} from './cloudRelayEntry';

type CloudJsonTransport = typeof requestCloudRelayJson;
type CloudSseTransport = typeof openCloudRelayPostSse;

/**
 * Cloud-only Remote Host V1 business adapter.
 *
 * Cloud ticket admission and Cloud session identity stay in this adapter. The
 * Thread/Message/Chat behavior itself comes from the shared
 * RemoteHostBusinessClient, so it cannot drift from the paired path again.
 */
export class CloudRemoteBusinessClient {
  private readonly entry: Pick<CloudRelayEntry, 'discover' | 'assertCurrentAccess' | 'reset'>;
  private readonly json: CloudJsonTransport;
  private readonly sse: CloudSseTransport;
  private readonly business: RemoteHostBusinessClient;

  constructor(
    entry: Pick<CloudRelayEntry, 'discover' | 'assertCurrentAccess' | 'reset'> =
      cloudRelayEntry,
    json: CloudJsonTransport = requestCloudRelayJson,
    sse: CloudSseTransport = openCloudRelayPostSse,
  ) {
    this.entry = entry;
    this.json = json;
    this.sse = sse;
    this.business = new RemoteHostBusinessClient(
      { openChannel: () => this.openBusinessChannel() },
      CLOUD_HOST_GRANT_POLICY,
    );
  }

  reset(): void {
    this.entry.reset();
  }

  getManifest(): Promise<RemoteManifest> {
    return this.business.getManifest();
  }

  listThreads() {
    return this.business.listThreads();
  }

  getThread(threadId: string) {
    return this.business.getThread(threadId);
  }

  getMessages(threadId: string) {
    return this.business.getMessages(threadId);
  }

  createThread(title?: string) {
    return this.business.createThread(title);
  }

  deleteThread(threadId: string) {
    return this.business.deleteThread(threadId);
  }

  sendMessage(
    input: SendRemoteMessageInput,
  ): Promise<PostSseSession<RemoteChatStreamEvent>> {
    return this.business.sendMessage(input);
  }

  private async openBusinessChannel(): Promise<RemoteHostBusinessChannel> {
    // One discovered access binds the whole business operation. If the Cloud
    // account switches mid-flight, assertCurrentAccess rejects every later
    // request instead of mixing two accounts' Host state.
    const access = await this.entry.discover();
    return {
      request: <T>(request: RemoteHostBusinessJsonRequest<T>) =>
        this.requestWithAccess(access, request),
      mutateOnce: <T>(
        request: RemoteHostBusinessJsonRequest<T>,
        uncertainCode: string,
        assertManifest: (manifest: RemoteManifest) => void,
      ) => this.mutateWithAccess(access, request, uncertainCode, assertManifest),
      openChatStream: (request: RemoteHostBusinessChatRequest) =>
        this.openChatStreamWithAccess(access, request),
    };
  }

  private async requestWithAccess<T>(
    access: CloudRelayAccess,
    operation: RemoteHostBusinessJsonRequest<T>,
  ): Promise<T> {
    this.entry.assertCurrentAccess(access);
    const result = await this.json(access.target, access.tickets, {
      ...operation,
      hostUrl: access.target.endpoint,
      allowInsecureDevelopment: false,
    });
    this.entry.assertCurrentAccess(access);
    return result;
  }

  private async mutateWithAccess<T>(
    access: CloudRelayAccess,
    operation: RemoteHostBusinessJsonRequest<T>,
    uncertainCode: string,
    assertManifest: (manifest: RemoteManifest) => void,
  ): Promise<T> {
    const manifest = await this.requestWithAccess(access, {
      path: '/remote/v1/manifest',
      parse: parseRemoteManifest,
    });
    assertManifest(manifest);

    try {
      return await this.requestWithAccess(access, operation);
    } catch (error) {
      if (isCloudRelayTransportError(error)) {
        throw new RemoteHostError(
          uncertainCode,
          'Mira Desktop may have accepted the request; refresh the current state before retrying',
          undefined,
          error,
        );
      }
      throw error;
    }
  }

  private async openChatStreamWithAccess(
    access: CloudRelayAccess,
    request: RemoteHostBusinessChatRequest,
  ): Promise<PostSseSession<RemoteChatStreamEvent>> {
    this.entry.assertCurrentAccess(access);
    // PostSseRequest requires a string credential for the Legacy path.
    // Empty here intentionally omits Authorization from the Relay request frame.
    return this.sse(access.target, access.tickets, {
      hostUrl: access.target.endpoint,
      allowInsecureDevelopment: false,
      credential: '',
      path: request.path,
      body: request.body,
      parse: parseRemoteChatStreamEvent,
    });
  }
}

export const cloudRemoteBusinessClient = new CloudRemoteBusinessClient();
