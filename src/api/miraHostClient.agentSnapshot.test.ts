import type { RemoteMiraHostClient } from './remoteMiraHost';
import { PairedRemoteMiraHostClient } from './miraHostClient';

const canonicalMessage = {
  id: 'assistant-1',
  threadId: 'thread-1',
  role: 'assistant' as const,
  content: '等待审批',
  parts: [
    { type: 'text' as const, text: '等待审批' },
    {
      type: 'image' as const,
      image: 'https://example.test/preview.png',
      filename: 'preview.png',
      fileId: 'media-image-1',
      mediaType: 'image/png',
    },
    {
      type: 'file' as const,
      data: 'opaque-file-data',
      filename: 'notes.pdf',
      fileId: 'media-file-1',
      mimeType: 'application/pdf',
    },
  ],
  metadata: {
    agent: {
      status: 'waiting_approval',
      runId: 'run-1',
    },
  },
  createdAt: '2026-08-29T00:00:00.000Z',
};

const hiddenToolMessage = {
  id: 'tool-1',
  threadId: 'thread-1',
  role: 'tool' as const,
  content: 'tool evidence',
  parts: [
    {
      type: 'file' as const,
      data: 'opaque-tool-file',
      filename: 'tool-output.bin',
      fileId: 'tool-media-1',
      mimeType: 'application/octet-stream',
    },
  ],
  createdAt: '2026-08-29T00:00:01.000Z',
};

const createdThread = {
  id: 'thread-new',
  title: '新对话',
  modelName: null,
  workspaceId: null,
  knowledgeBaseId: null,
  roleId: null,
  agentEnabled: null,
  status: 'active',
  createdAt: '2026-08-29T01:00:00.000Z',
  updatedAt: '2026-08-29T01:00:00.000Z',
  messageCount: 0,
};

const manifest = (
  options: {
    artifactsScope?: boolean;
    mediaRoute?: boolean;
    messagesWriteScope?: boolean;
    createRoute?: boolean;
  } = {},
) => ({
  protocolVersion: 1 as const,
  device: {
    id: 'device-1',
    name: 'Phone',
    platform: 'ios',
    scopes: [
      ...(options.artifactsScope ? (['artifacts:read'] as const) : []),
      ...(options.messagesWriteScope ? (['messages:write'] as const) : []),
    ],
  },
  routes: {
    threads: options.createRoute ? ['POST /threads'] : [],
    messages: [],
    agent: [],
    artifacts: options.mediaRoute
      ? ['GET /threads/:id/media/:mediaId/content']
      : [],
  },
  reconnect: { mode: 'canonical-state-replay' as const, eventCursor: false as const },
  serverTime: '2026-08-29T00:00:00.000Z',
});

describe('PairedRemoteMiraHostClient canonical message snapshots', () => {
  test('preserves canonical metadata and mixed user-visible message parts', async () => {
    const remote = {
      getMessages: jest.fn(async () => [canonicalMessage]),
    } as unknown as RemoteMiraHostClient;
    const client = new PairedRemoteMiraHostClient(remote);
    const listener = jest.fn();
    const unsubscribe = client.subscribeMessageSnapshots(listener);

    const messages = await client.getMessages('thread-1');

    expect(messages[0]?.metadata).toEqual(canonicalMessage.metadata);
    expect(messages[0]?.parts).toEqual(canonicalMessage.parts);
    expect(messages[0]?.content).toBe('等待审批');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      sessionId: 'thread-1',
      messages,
    });

    unsubscribe();
    await client.getMessages('thread-1');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('does not expose tool/system media parts as user-visible attachments', async () => {
    const remote = {
      getMessages: jest.fn(async () => [hiddenToolMessage]),
    } as unknown as RemoteMiraHostClient;
    const client = new PairedRemoteMiraHostClient(remote);

    const messages = await client.getMessages('thread-1');

    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.parts).toBeUndefined();
  });
});

describe('PairedRemoteMiraHostClient canonical thread creation', () => {
  test('does not create when messages:write is missing', async () => {
    const remote = {
      getManifest: jest.fn(async () => manifest({ createRoute: true })),
      createThread: jest.fn(),
    } as unknown as RemoteMiraHostClient;
    const client = new PairedRemoteMiraHostClient(remote);

    await expect(client.createSession()).rejects.toMatchObject({
      code: 'THREAD_CREATE_UNAVAILABLE',
      status: 403,
    });
    expect(remote.createThread).not.toHaveBeenCalled();
  });

  test('does not create when the Host manifest does not advertise POST /threads', async () => {
    const remote = {
      getManifest: jest.fn(async () => manifest({ messagesWriteScope: true })),
      createThread: jest.fn(),
    } as unknown as RemoteMiraHostClient;
    const client = new PairedRemoteMiraHostClient(remote);

    await expect(client.createSession()).rejects.toMatchObject({
      code: 'THREAD_CREATE_UNAVAILABLE',
      status: 403,
    });
    expect(remote.createThread).not.toHaveBeenCalled();
  });

  test('returns the canonical Host thread after the capability gate passes', async () => {
    const remote = {
      getManifest: jest.fn(async () =>
        manifest({ messagesWriteScope: true, createRoute: true }),
      ),
      createThread: jest.fn(async () => createdThread),
    } as unknown as RemoteMiraHostClient;
    const client = new PairedRemoteMiraHostClient(remote);

    await expect(client.createSession('新对话')).resolves.toMatchObject({
      id: 'thread-new',
      title: '新对话',
      status: 'active',
      messageCount: 0,
    });
    expect(remote.createThread).toHaveBeenCalledWith('新对话', undefined);
  });

  test('passes the requested Agent contract through to the Host thread create', async () => {
    const remote = {
      getManifest: jest.fn(async () =>
        manifest({ messagesWriteScope: true, createRoute: true }),
      ),
      createThread: jest.fn(async () => createdThread),
    } as unknown as RemoteMiraHostClient;
    const client = new PairedRemoteMiraHostClient(remote);

    await client.createSession(undefined, { agentEnabled: true });

    // Mobile's new Remote chat must be a Host Agent thread, matching what
    // current Desktop creates by default.
    expect(remote.createThread).toHaveBeenCalledWith(undefined, {
      agentEnabled: true,
    });
  });
});

describe('PairedRemoteMiraHostClient thread media reads', () => {
  test('requires both artifacts scope and the canonical manifest route', async () => {
    const remote = {
      getManifest: jest.fn(async () => manifest({ artifactsScope: false, mediaRoute: true })),
      getThreadMediaRequest: jest.fn(),
    } as unknown as RemoteMiraHostClient;
    const client = new PairedRemoteMiraHostClient(remote);

    await expect(client.getThreadMediaRequest('thread-1', 'media-1')).rejects.toMatchObject({
      code: 'THREAD_MEDIA_READ_UNAVAILABLE',
      status: 403,
    });
    expect(remote.getThreadMediaRequest).not.toHaveBeenCalled();
  });

  test('delegates canonical media ids only after the manifest gate passes', async () => {
    const request = {
      url: 'https://mira.example.test/threads/thread-1/media/media-1/content',
      headers: { Authorization: 'Bearer secret-device-credential' },
    };
    const remote = {
      getManifest: jest.fn(async () => manifest({ artifactsScope: true, mediaRoute: true })),
      getThreadMediaRequest: jest.fn(async () => request),
    } as unknown as RemoteMiraHostClient;
    const client = new PairedRemoteMiraHostClient(remote);

    await expect(client.getThreadMediaRequest('thread-1', ' media-1 ')).resolves.toEqual(request);
    expect(remote.getThreadMediaRequest).toHaveBeenCalledWith('thread-1', 'media-1');
  });
});
