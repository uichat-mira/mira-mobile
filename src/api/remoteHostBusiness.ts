import {
  parseRemoteManifest,
  parseRemoteMessage,
  parseRemoteThread,
  type RemoteChatStreamEvent,
  type RemoteManifest,
  type RemoteMessage,
  type RemoteThread,
} from '../protocol/remoteHostV1';
import type { PostSseSession } from './postSse';
import { RemoteHostError } from './remoteHttp';

export const REMOTE_THREAD_CREATE_ROUTE = 'POST /threads';
export const REMOTE_THREAD_DELETE_ROUTE = 'DELETE /threads/:id';
export const REMOTE_CHAT_PATH = '/proxy/chat/default';
export const REMOTE_CHAT_ROUTE = 'POST ' + REMOTE_CHAT_PATH;

export interface RemoteHostBusinessJsonRequest<T> {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  parse: (value: unknown) => T;
}

export interface RemoteHostBusinessChatRequest {
  path: string;
  body: unknown;
}

export interface RemoteHostBusinessChannel {
  request<T>(request: RemoteHostBusinessJsonRequest<T>): Promise<T>;
  /**
   * Dispatches a side-effecting mutation at most once. Implementations may
   * probe an idempotent manifest on another transport first, but must never
   * replay the mutation itself after it has been sent.
   */
  mutateOnce<T>(
    request: RemoteHostBusinessJsonRequest<T>,
    uncertainCode: string,
    assertManifest: (manifest: RemoteManifest) => void,
  ): Promise<T>;
  openChatStream(
    request: RemoteHostBusinessChatRequest,
  ): Promise<PostSseSession<RemoteChatStreamEvent>>;
}

/**
 * Narrow transport boundary. Identity, credential storage, Cloud ticket
 * admission and endpoint selection stay inside each adapter; the returned
 * channel must keep one identity context for the whole business operation.
 */
export interface RemoteHostBusinessTransport {
  openChannel(): Promise<RemoteHostBusinessChannel>;
}

export interface SendRemoteMessageInput {
  threadId: string;
  messageId: string;
  content: string;
  agentEnabled?: boolean;
  requestedToolGroupIds?: string[];
}

export interface RemoteHostBusinessGrantPolicy {
  threadCreateUnavailable(): RemoteHostError;
  threadDeleteUnavailable(): RemoteHostError;
  messageWriteUnavailable(): RemoteHostError;
}

const pairedGrantPolicy: RemoteHostBusinessGrantPolicy = {
  threadCreateUnavailable: () =>
    new RemoteHostError(
      'THREAD_CREATE_UNAVAILABLE',
      '当前 Mira Host 未授权移动端新建会话',
      403,
    ),
  threadDeleteUnavailable: () =>
    new RemoteHostError(
      'THREAD_DELETE_UNAVAILABLE',
      '当前 Mira Host 未授权移动端删除会话',
      403,
    ),
  messageWriteUnavailable: () =>
    new RemoteHostError(
      'MESSAGES_WRITE_UNAVAILABLE',
      '当前 Mira Host 未授权移动端发送消息',
      403,
    ),
};

export const CLOUD_HOST_GRANT_POLICY: RemoteHostBusinessGrantPolicy = {
  threadCreateUnavailable: () =>
    new RemoteHostError(
      'CLOUD_HOST_GRANT_REQUIRED',
      'Mira Desktop has not granted this Cloud device the requested operation',
      403,
    ),
  threadDeleteUnavailable: () =>
    new RemoteHostError(
      'CLOUD_HOST_GRANT_REQUIRED',
      'Mira Desktop has not granted this Cloud device the requested operation',
      403,
    ),
  messageWriteUnavailable: () =>
    new RemoteHostError(
      'CLOUD_HOST_GRANT_REQUIRED',
      'Mira Desktop has not granted this Cloud device permission to send messages',
      403,
    ),
};

export const remoteManifestSupportsThreadCreate = (
  manifest: RemoteManifest,
): boolean =>
  manifest.device.scopes.includes('messages:write') &&
  manifest.routes.threads.includes(REMOTE_THREAD_CREATE_ROUTE);

export const remoteManifestSupportsThreadDelete = (
  manifest: RemoteManifest,
): boolean =>
  manifest.device.scopes.includes('messages:write') &&
  manifest.routes.threads.includes(REMOTE_THREAD_DELETE_ROUTE);

export const remoteManifestSupportsChat = (
  manifest: RemoteManifest,
): boolean =>
  manifest.device.scopes.includes('messages:write') &&
  manifest.routes.messages.includes(REMOTE_CHAT_ROUTE);

const parseArray = <T>(
  value: unknown,
  parse: (item: unknown) => T,
  description: string,
): T[] => {
  if (!Array.isArray(value)) throw new Error(description + ' must be an array');
  return value.map(parse);
};

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

export type RemoteChatContextMessage = NonNullable<
  ReturnType<typeof toContextMessage>
>;

/**
 * Builds the append payload from the Host-owned canonical transcript, never
 * from renderer state. Tool messages stay Host-internal.
 */
export const buildCanonicalChatMessages = (
  history: RemoteMessage[],
  messageId: string,
  content: string,
): RemoteChatContextMessage[] => {
  const messages = history
    .filter(message => message.id !== messageId)
    .map(toContextMessage)
    .filter((message): message is RemoteChatContextMessage => Boolean(message));
  messages.push({
    id: messageId,
    role: 'user',
    parts: [{ type: 'text', text: content }],
  });
  return messages;
};

export class RemoteHostBusinessClient {
  constructor(
    private readonly transport: RemoteHostBusinessTransport,
    private readonly grantPolicy: RemoteHostBusinessGrantPolicy = pairedGrantPolicy,
  ) {}

  async getManifest(signal?: AbortSignal): Promise<RemoteManifest> {
    return (await this.transport.openChannel()).request({
      path: '/remote/v1/manifest',
      signal,
      parse: parseRemoteManifest,
    });
  }

  async listThreads(): Promise<RemoteThread[]> {
    return (await this.transport.openChannel()).request({
      path: '/threads?status=active&sortBy=updatedAt&sortOrder=desc',
      parse: value => parseArray(value, parseRemoteThread, 'threads'),
    });
  }

  async getThread(threadId: string): Promise<RemoteThread> {
    return (await this.transport.openChannel()).request({
      path: '/threads/' + encodeURIComponent(threadId),
      parse: parseRemoteThread,
    });
  }

  async getMessages(threadId: string): Promise<RemoteMessage[]> {
    return (await this.transport.openChannel()).request({
      path: '/threads/' + encodeURIComponent(threadId) + '/messages',
      parse: value => parseArray(value, parseRemoteMessage, 'messages'),
    });
  }

  async createThread(title?: string): Promise<RemoteThread> {
    const channel = await this.transport.openChannel();
    return channel.mutateOnce(
      {
        path: '/threads',
        method: 'POST',
        body: title ? { title } : {},
        parse: parseRemoteThread,
      },
      'THREAD_CREATE_UNCERTAIN',
      manifest => {
        if (!remoteManifestSupportsThreadCreate(manifest)) {
          throw this.grantPolicy.threadCreateUnavailable();
        }
      },
    );
  }

  async deleteThread(threadId: string): Promise<void> {
    const channel = await this.transport.openChannel();
    return channel.mutateOnce(
      {
        path: '/threads/' + encodeURIComponent(threadId),
        method: 'DELETE',
        parse: () => undefined,
      },
      'THREAD_DELETE_UNCERTAIN',
      manifest => {
        if (!remoteManifestSupportsThreadDelete(manifest)) {
          throw this.grantPolicy.threadDeleteUnavailable();
        }
      },
    );
  }

  async sendMessage(
    input: SendRemoteMessageInput,
  ): Promise<PostSseSession<RemoteChatStreamEvent>> {
    const content = input.content.trim();
    if (!content) {
      throw new RemoteHostError('EMPTY_MESSAGE', 'Message content cannot be empty');
    }
    const messageId = input.messageId.trim();
    if (!messageId) {
      throw new RemoteHostError(
        'MESSAGE_ID_REQUIRED',
        'A stable message id is required for reconnect-safe sending',
      );
    }

    const channel = await this.transport.openChannel();
    const manifest = await channel.request({
      path: '/remote/v1/manifest',
      parse: parseRemoteManifest,
    });
    if (!remoteManifestSupportsChat(manifest)) {
      throw this.grantPolicy.messageWriteUnavailable();
    }

    // The Host owns the canonical transcript. Read it immediately before the
    // append so the cursor and model context come from the same Host snapshot.
    const history = await channel.request({
      path: '/threads/' + encodeURIComponent(input.threadId) + '/messages',
      parse: value => parseArray(value, parseRemoteMessage, 'messages'),
    });
    const messages = buildCanonicalChatMessages(history, messageId, content);
    const expectedTailMessageId = history.length
      ? history[history.length - 1]!.id
      : null;

    return channel.openChatStream({
      path: REMOTE_CHAT_PATH,
      body: {
        id: input.threadId,
        messageId,
        messages,
        // DSK-013 common Host append contract: distinguish an optimistic append
        // from a deliberate branch-from-root edit. Host rejects a stale tail.
        appendAtTail: { expectedTailMessageId },
        ...(typeof input.agentEnabled === 'boolean'
          ? { agentEnabled: input.agentEnabled }
          : {}),
        ...(input.requestedToolGroupIds
          ? { requestedToolGroupIds: input.requestedToolGroupIds }
          : {}),
      },
    });
  }
}
