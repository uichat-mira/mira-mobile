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
  RemoteManifest,
  RemoteMemoryKind,
  RemoteMemoryOverview,
  RemoteMessage,
  RemoteThread,
} from '../protocol/remoteHostV1';
import { RemoteHostError } from './remoteHttp';
import {
  remoteManifestSupportsThreadCreate,
  remoteManifestSupportsThreadDelete,
} from './remoteHostBusiness';
import { readThreadMediaText } from './threadMedia';
import type { MiraHostApi } from './miraHost';
import {
  mapRemoteChatStream,
  type RemoteRuntimeToolEvent,
} from '../runtime/remoteChatStream';

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

export const threadToSession = (thread: RemoteThread): Session => ({
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

export const messageToChatMessage = (message: RemoteMessage): ChatMessage => ({
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
  private lastRuntimeEvents: RemoteRuntimeToolEvent[] = [];
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

  async createSession(
    title?: string,
    options?: { agentEnabled?: boolean },
  ): Promise<Session> {
    const manifest = await this.remote.getManifest();
    if (!remoteManifestSupportsThreadCreate(manifest)) {
      throw new RemoteHostError(
        'THREAD_CREATE_UNAVAILABLE',
        '当前 Mira Host 未授权移动端新建会话',
        403,
      );
    }
    return threadToSession(await this.remote.createThread(title, options));
  }

  async canDeleteSession(): Promise<boolean> {
    try {
      return remoteManifestSupportsThreadDelete(await this.remote.getManifest());
    } catch {
      return false;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const manifest = await this.remote.getManifest();
    if (!remoteManifestSupportsThreadDelete(manifest)) {
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

  // ─── Memory (canonical Host /memory surface) ───────────────
  // Capability gating (device scope + advertised manifest route) already
  // happens in RemoteMiraHostClient; screens surface REMOTE_SCOPE_REQUIRED /
  // REMOTE_MEMORY_ROUTE_UNAVAILABLE as a truthful "Host has not opened
  // memory yet" state instead of local fake data.

  async getMemoryOverview(): Promise<RemoteMemoryOverview> {
    return this.remote.getMemoryOverview();
  }

  async updateMemorySettings(enabled: boolean): Promise<RemoteMemoryOverview> {
    return this.remote.updateMemorySettings(enabled);
  }

  async createMemory(
    kind: RemoteMemoryKind,
    content: string,
  ): Promise<RemoteMemoryOverview> {
    return this.remote.createMemory(kind, content);
  }

  async updateMemory(
    id: string,
    kind: RemoteMemoryKind,
    content: string,
  ): Promise<RemoteMemoryOverview> {
    return this.remote.updateMemory(id, kind, content);
  }

  async deleteMemory(id: string): Promise<RemoteMemoryOverview> {
    return this.remote.deleteMemory(id);
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

    // The shared business client reads the Host-owned canonical transcript and
    // builds the append cursor. This wrapper only adapts the stream for the
    // legacy screen-facing MiraHostApi surface.
    const session = await this.remote.sendMessage({
      threadId: sessionId,
      messageId: stableMessageId,
      content,
    });
    this.lastRuntimeEvents = [];
    this.currentSendAbort = session.abort;

    const self = this;
    return (async function* () {
      try {
        for await (const event of mapRemoteChatStream(
          session,
          (runtimeEvent: RemoteRuntimeToolEvent) => {
            self.lastRuntimeEvents.push(runtimeEvent);
          },
        )) {
          if (event.type === 'text-delta') yield event.delta;
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
