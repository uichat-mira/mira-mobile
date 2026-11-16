import type { ChatMessage, Session } from '../types';
import { RemoteHostError } from '../api/remoteHttp';
import {
  messageToChatMessage,
  threadToSession,
} from '../api/miraHostClient';
import {
  cloudRemoteBusinessClient,
  type CloudRemoteBusinessClient,
} from '../cloud/cloudRemoteBusiness';
import type { ConversationRuntime, RuntimeEvent } from './conversationRuntime';

const createMessageId = () =>
  `mobile-cloud-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * An explicit Cloud Relay remote runtime. It must never touch the paired
 * Remote V1 device credential or switch to Tailscale on transport failure.
 */
export class CloudHostRuntime implements ConversationRuntime {
  readonly kind = 'remote-host' as const;
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
    const manifest = await this.cloud.getManifest();
    return manifest.device.scopes.includes('messages:write') &&
      manifest.routes.threads.includes('DELETE /threads/:id');
  }

  async canSendMessage(): Promise<boolean> {
    const manifest = await this.cloud.getManifest();
    return manifest.device.scopes.includes('messages:write') &&
      manifest.routes.messages.includes('POST /proxy/chat/default');
  }

  async deleteSession(sessionId: string): Promise<void> {
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
    const messageId = options?.messageId ?? createMessageId();
    const session = await this.cloud.sendMessage({
      threadId: sessionId,
      messageId,
      content: input,
      ...(typeof options?.agentEnabled === 'boolean'
        ? { agentEnabled: options.agentEnabled } : {}),
    });
    this.currentAbort = session.abort;
    const self = this;
    return (async function* () {
      let sawFinish = false;
      try {
        for await (const event of session.events) {
          if (event.type === 'text-delta' && typeof event.delta === 'string') {
            yield { type: 'text-delta' as const, delta: event.delta };
          } else if (event.type === 'finish') {
            sawFinish = true;
            if (event.finishReason !== 'stop') {
              throw new RemoteHostError('CHAT_FINISHED_WITH_ERROR',
                'Mira Desktop returned a non-success chat finish');
            }
          } else if (event.type === 'error') {
            throw new RemoteHostError('CHAT_STREAM_ERROR',
              typeof event.errorText === 'string' ? event.errorText : 'Cloud Host chat failed');
          }
        }
        if (!sawFinish) throw new RemoteHostError('CHAT_STREAM_INCOMPLETE',
          'Cloud Host chat closed without a finish event');
        yield { type: 'finish' as const, reason: 'stop' };
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
