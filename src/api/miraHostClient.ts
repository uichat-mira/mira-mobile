import type {
  ChatMessage,
  ConnectionStatus,
  MiraHostConfig,
  Session,
} from '../types';
import { useHostStore } from '../store/hostStore';
import {
  remoteMiraHostClient,
  type RemoteMiraHostClient,
} from './remoteMiraHost';
import type {
  RemoteChatStreamEvent,
  RemoteManifest,
  RemoteMessage,
  RemoteThread,
} from '../protocol/remoteHostV1';
import { RemoteHostError } from './remoteHttp';
import { readThreadMediaText } from './threadMedia';
import type { MiraHostApi } from './miraHost';

const THREAD_CREATE_ROUTE = 'POST /threads';
const THREAD_MEDIA_ROUTE = 'GET /threads/:id/media/:mediaId/content';

// Reasoning models can leak <think> blocks into Host-derived thread titles.
// Normalize at the adapter boundary so list rows and chat headers stay
// readable; the Host-side title itself is never modified.
const sanitizeThreadTitle = (title: string): string => {
  const stripped = title
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/<think(?:ing)?>[\s\S]*$/i, '')
    .replace(/<\/?think(?:ing)?>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || '未命名会话';
};

const threadToSession = (thread: RemoteThread): Session => ({
  id: thread.id,
  title: sanitizeThreadTitle(thread.title),
  updatedAt: new Date(thread.updatedAt),
  source: 'remote-host',
  workspaceId: thread.workspaceId,
  knowledgeBaseId: thread.knowledgeBaseId,
  roleId: thread.roleId,
  agentEnabled: thread.agentEnabled,
  status: thread.status,
  messageCount: thread.messageCount,
});

const messageToChatMessage = (message: RemoteMessage): ChatMessage => ({
  id: message.id,
  role:
    message.role === 'tool' || message.role === 'system'
      ? 'system'
      : message.role,
  content: message.content,
  timestamp: new Date(message.createdAt),
  ...(message.role === 'user' || message.role === 'assistant'
    ? { parts: message.parts }
    : {}),
  metadata: message.metadata,
});

const supportsThreadCreation = (manifest: RemoteManifest): boolean =>
  manifest.device.scopes.includes('messages:write') &&
  manifest.routes.threads.includes(THREAD_CREATE_ROUTE);

const supportsThreadDeletion = (manifest: RemoteManifest): boolean =>
  manifest.device.scopes.includes('messages:write') &&
  manifest.routes.threads.includes('DELETE /threads/:id');

const supportsThreadMediaRead = (manifest: RemoteManifest): boolean =>
  manifest.device.scopes.includes('artifacts:read') &&
  manifest.routes.artifacts.includes(THREAD_MEDIA_ROUTE);

const unsupportedMutation = (operation: string): never => {
  throw new Error(
    `${operation} is not available to a paired mobile device in Remote Host V1`,
  );
};

const createMessageId = () =>
  `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const toContextMessage = (message: RemoteMessage) => {
  if (message.role === 'tool') return null;

  const text =
    message.content.trim() ||
    message.parts
      .filter((part): part is Extract<typeof part, { type: 'text' }> =>
        part.type === 'text',
      )
      .map(part => part.text)
      .join('\n')
      .trim();

  if (!text) return null;

  return {
    id: message.id,
    role: message.role,
    parts: [{ type: 'text' as const, text }],
  };
};

export interface CanonicalMessageSnapshot {
  sessionId: string;
  messages: ChatMessage[];
}

type MessageSnapshotListener = (snapshot: CanonicalMessageSnapshot) => void;

/**
 * Mobile runtime compatibility adapter.
 *
 * The mobile app is a paired remote device. Its business identity is the
 * `mira_device_*` credential issued by Remote Host V1; it must never fall back
 * to a desktop user's username/password or JWT.
 *
 * This adapter preserves the older screen-facing MiraHostApi shape while all
 * supported operations are delegated to RemoteMiraHostClient.
 */
export class PairedRemoteMiraHostClient implements MiraHostApi {
  private currentSendAbort: (() => void) | null = null;
  private lastRuntimeEvents: Array<
    Extract<RemoteChatStreamEvent, { type: 'data-tool-event' | 'data-execution-node' }>
  > = [];
  private readonly messageSnapshotListeners = new Set<MessageSnapshotListener>();

  constructor(private readonly remote: RemoteMiraHostClient) {}

  configure(_config: MiraHostConfig): void {
    // Intentionally ignored. Remote Host V1 connection details are restored
    // from the securely stored device credential, not from a user JWT config.
  }

  getConnectionStatus(): ConnectionStatus {
    return useHostStore.getState().connectionStatus;
  }

  async connect(): Promise<void> {
    useHostStore.getState().setConnectionStatus('connecting');
    try {
      const restored = await this.remote.restoreConnection();
      if (!restored) {
        useHostStore.getState().setConnectionStatus('disconnected');
        throw new Error('This mobile device is not paired with a Mira Host');
      }
      useHostStore.getState().setConnectionStatus('connected');
    } catch (error) {
      useHostStore.getState().setConnectionStatus('disconnected');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.cancelCurrentSend();
    await this.remote.disconnect();
    useHostStore.getState().clearConfig();
    useHostStore.getState().setConnectionStatus('disconnected');
  }

  async listSessions(): Promise<Session[]> {
    return (await this.remote.listThreads()).map(threadToSession);
  }

  async getSession(sessionId: string): Promise<Session> {
    return threadToSession(await this.remote.getThread(sessionId));
  }

  async createSession(title?: string): Promise<Session> {
    const manifest = await this.remote.getManifest();
    if (!supportsThreadCreation(manifest)) {
      throw new RemoteHostError(
        'THREAD_CREATE_UNAVAILABLE',
        '当前 Mira Host 未授权移动端新建会话',
        403,
      );
    }
    return threadToSession(await this.remote.createThread(title));
  }

  async canDeleteSession(): Promise<boolean> {
    try {
      return supportsThreadDeletion(await this.remote.getManifest());
    } catch {
      return false;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const manifest = await this.remote.getManifest();
    if (!supportsThreadDeletion(manifest)) {
      throw new RemoteHostError(
        'THREAD_DELETE_UNAVAILABLE',
        '当前 Mira Host 未授权移动端删除会话',
      );
    }
    await this.remote.deleteThread(sessionId);
  }

  async renameSession(_sessionId: string, _title: string): Promise<Session> {
    return unsupportedMutation('Renaming a thread');
  }

  subscribeMessageSnapshots(listener: MessageSnapshotListener): () => void {
    this.messageSnapshotListeners.add(listener);
    return () => {
      this.messageSnapshotListeners.delete(listener);
    };
  }

  private publishMessageSnapshot(sessionId: string, messages: ChatMessage[]) {
    const snapshot: CanonicalMessageSnapshot = {
      sessionId,
      messages: [...messages],
    };
    for (const listener of this.messageSnapshotListeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.warn('[miraHostClient] message snapshot listener failed', error);
      }
    }
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const messages = (await this.remote.getMessages(sessionId)).map(
      messageToChatMessage,
    );
    this.publishMessageSnapshot(sessionId, messages);
    return messages;
  }

  async getThreadMediaRequest(sessionId: string, mediaId: string) {
    const stableMediaId = mediaId.trim();
    if (!stableMediaId) {
      throw new RemoteHostError(
        'MEDIA_ID_REQUIRED',
        'A canonical media id is required to read an attachment',
      );
    }

    const manifest = await this.remote.getManifest();
    if (!supportsThreadMediaRead(manifest)) {
      throw new RemoteHostError(
        'THREAD_MEDIA_READ_UNAVAILABLE',
        '当前 Mira Host 未授权移动端读取会话附件',
        403,
      );
    }

    return this.remote.getThreadMediaRequest(sessionId, stableMediaId);
  }

  async getThreadMediaText(sessionId: string, mediaId: string): Promise<string> {
    const request = await this.getThreadMediaRequest(sessionId, mediaId);
    return readThreadMediaText(request);
  }

  async sendMessage(
    sessionId: string,
    content: string,
    messageId: string = createMessageId(),
  ): Promise<AsyncIterable<string>> {
    const stableMessageId = messageId.trim();
    if (!stableMessageId) {
      throw new Error('A stable message id is required');
    }

    const canonicalMessages = await this.remote.getMessages(sessionId);
    const contextMessages = canonicalMessages
      .filter(message => message.id !== stableMessageId)
      .map(toContextMessage)
      .filter((message): message is NonNullable<typeof message> => Boolean(message));
    contextMessages.push({
      id: stableMessageId,
      role: 'user',
      parts: [{ type: 'text', text: content }],
    });

    const session = await this.remote.sendMessage({
      threadId: sessionId,
      messageId: stableMessageId,
      content,
      messages: contextMessages,
    });
    this.lastRuntimeEvents = [];
    this.currentSendAbort = session.abort;

    const self = this;
    return (async function* () {
      let sawFinish = false;
      try {
        for await (const event of session.events) {
          if (
            (event.type === 'data-tool-event' || event.type === 'data-execution-node') &&
            event.data &&
            typeof event.data === 'object' &&
            !Array.isArray(event.data)
          ) {
            self.lastRuntimeEvents.push(
              event as Extract<
                RemoteChatStreamEvent,
                { type: 'data-tool-event' | 'data-execution-node' }
              >,
            );
            continue;
          }
          if (event.type === 'finish') {
            sawFinish = true;
            if (event.finishReason === 'error') {
              throw new RemoteHostError(
                'CHAT_FINISHED_WITH_ERROR',
                'Mira Host finished the chat with an error',
              );
            }
            if (event.finishReason !== 'stop') {
              throw new RemoteHostError(
                'INVALID_FINISH_REASON',
                `Mira Host returned unsupported finish reason: ${event.finishReason}`,
              );
            }
            continue;
          }
          if (event.type === 'text-delta' && typeof event.delta === 'string') {
            yield event.delta;
            continue;
          }
          if (event.type === 'error') {
            const errorText =
              'errorText' in event && typeof event.errorText === 'string'
                ? event.errorText
                : 'Mira Host stream failed';
            throw new RemoteHostError('CHAT_STREAM_ERROR', errorText);
          }
        }
        // [DONE] only closes the SSE reader. A successful chat must also have
        // an explicit finish event from the shared Host stream contract.
        if (!sawFinish) {
          throw new RemoteHostError(
            'CHAT_STREAM_INCOMPLETE',
            'Mira Host closed the chat stream before finish was received',
          );
        }
      } finally {
        if (self.currentSendAbort === session.abort) {
          self.currentSendAbort = null;
        }
      }
    })();
  }

  cancelCurrentSend() {
    const abort = this.currentSendAbort;
    this.currentSendAbort = null;
    abort?.();
  }

  /** Structured tool/execution events retained for a compact runtime status UI. */
  getLastRuntimeEvents() {
    return [...this.lastRuntimeEvents];
  }
}

export const miraHostClient = new PairedRemoteMiraHostClient(
  remoteMiraHostClient,
);
