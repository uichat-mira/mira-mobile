import type { ChatMessage, Session } from '../types';
import { RemoteHostError } from '../api/remoteHttp';
import { assertDesktopConnectionActive } from '../connectivity/desktopConnectionAuthority';
import {
  messageToChatMessage,
  threadToSession,
} from '../api/miraHostClient';
import {
  remoteManifestSupportsChat,
  remoteManifestSupportsThreadDelete,
} from '../api/remoteHostBusiness';
import {
  cloudRemoteBusinessClient,
  type CloudRemoteBusinessClient,
} from '../cloud/cloudRemoteBusiness';
import type { ConversationRuntime, RuntimeEvent } from './conversationRuntime';
import { mapRemoteChatStream } from './remoteChatStream';

const createMessageId = () =>
  `mobile-cloud-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * An explicit Cloud Relay remote runtime. It must never touch the paired
 * Remote V1 device credential or switch to Tailscale on transport failure.
 * The Thread/Message/Chat payload and stream contracts come from the shared
 * Remote Host business client; this runtime only maps them for Cloud UI.
 */
export class CloudHostRuntime implements ConversationRuntime {
  readonly kind = 'remote-host' as const;
  // This describes Mobile's local Agent loop, not Host-owned Agent execution.
  // The canonical Host thread may run Agent with an isolated private workspace.
  readonly supportsAgent = false;
  private currentAbort: (() => void) | null = null;

  constructor(private readonly cloud: Pick<CloudRemoteBusinessClient,
    'listThreads' | 'getThread' | 'getMessages' | 'getManifest' |
    'deleteThread' | 'sendMessage'> = cloudRemoteBusinessClient) {}

  async listSessions(): Promise<Session[]> {
    return (await this.cloud.listThreads()).map(thread => ({
      ...threadToSession(thread), source: 'cloud-host' as const,
    }));
  }

  async getSession(sessionId: string): Promise<Session> {
    return {
      ...threadToSession(await this.cloud.getThread(sessionId)),
      source: 'cloud-host',
    };
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    return (await this.cloud.getMessages(sessionId)).map(messageToChatMessage);
  }

  async canDeleteSession(): Promise<boolean> {
    return remoteManifestSupportsThreadDelete(await this.cloud.getManifest());
  }

  async canSendMessage(sessionId?: string): Promise<boolean> {
    if (!sessionId) return false;
    if (!remoteManifestSupportsChat(await this.cloud.getManifest())) return false;
    const thread = await this.cloud.getThread(sessionId);
    // Host may own a valid private Agent workspace while workspaceId is null.
    return thread.status === 'active';
  }

  async deleteSession(sessionId: string): Promise<void> {
    assertDesktopConnectionActive('cloud');
    if (!await this.canDeleteSession()) {
      throw new RemoteHostError('CLOUD_HOST_GRANT_REQUIRED',
        'Mira Desktop has not granted permission to delete threads', 403);
    }
    await this.cloud.deleteThread(sessionId);
  }

  async sendMessage(
    sessionId: string,
    input: string,
    options?: { agentEnabled?: boolean; messageId?: string },
  ): Promise<AsyncIterable<RuntimeEvent>> {
    assertDesktopConnectionActive('cloud');
    const thread = await this.cloud.getThread(sessionId);
    if (thread.status !== 'active') {
      throw new RemoteHostError('CLOUD_THREAD_NOT_ACTIVE',
        'The Desktop thread is not active', 409);
    }
    const messageId = options?.messageId ?? createMessageId();
    // Host owns the transcript, append cursor and Agent execution. The shared
    // business client reads the canonical tail immediately before sending.
    const session = await this.cloud.sendMessage({
      threadId: sessionId,
      messageId,
      content: input,
      agentEnabled: thread.agentEnabled === true,
    });
    this.currentAbort = session.abort;
    const self = this;
    return (async function* () {
      try {
        for await (const event of mapRemoteChatStream(session)) {
          yield event;
        }
      } finally {
        if (self.currentAbort === session.abort) self.currentAbort = null;
      }
    })();
  }

  cancelActiveRun(): void {
    const abort = this.currentAbort;
    this.currentAbort = null;
    abort?.();
  }
}
