import {
  RemoteHostBusinessClient,
  type SendRemoteMessageInput,
} from './remoteHostBusiness';
import type { RemoteJsonRequest } from './remoteHttp';
import { RemoteHostError } from './remoteHttp';
import type { PostSseRequest, PostSseSession } from './postSse';
import { RemoteMiraHostClient } from './remoteMiraHost';
import { CloudRemoteBusinessClient } from '../cloud/cloudRemoteBusiness';
import { MemoryDeviceCredentialStore } from '../security/deviceCredentialStore';
import type {
  RemoteChatStreamEvent,
  RemoteManifest,
  RemoteMessage,
  RemoteThread,
} from '../protocol/remoteHostV1';

const thread: RemoteThread = {
  id: 'thread-1',
  title: 'Shared thread',
  modelName: null,
  workspaceId: null,
  knowledgeBaseId: null,
  roleId: null,
  agentEnabled: false,
  status: 'active',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:01:00.000Z',
  messageCount: 3,
};

const history = (): RemoteMessage[] => [
  {
    id: 'user-old',
    threadId: thread.id,
    role: 'user',
    content: 'remember this',
    parts: [{ type: 'text', text: 'remember this' }],
    createdAt: '2026-11-01T00:00:00.000Z',
  },
  {
    id: 'assistant-old',
    threadId: thread.id,
    role: 'assistant',
    content: 'I remember',
    parts: [{ type: 'text', text: 'I remember' }],
    createdAt: '2026-11-01T00:00:01.000Z',
  },
  {
    id: 'tool-old',
    threadId: thread.id,
    role: 'tool',
    content: 'internal tool output',
    parts: [{ type: 'text', text: 'internal tool output' }],
    createdAt: '2026-11-01T00:00:02.000Z',
  },
];

const manifest = (options: {
  writeScope?: boolean;
  chatRoute?: boolean;
  createRoute?: boolean;
  deleteRoute?: boolean;
} = {}): RemoteManifest => ({
  protocolVersion: 1,
  device: {
    id: 'device-1',
    name: 'Phone',
    platform: 'android',
    scopes: options.writeScope === false
      ? ['threads:read', 'messages:read']
      : ['threads:read', 'messages:read', 'messages:write'],
  },
  routes: {
    threads: [
      'GET /threads',
      'GET /threads/:id',
      ...(options.createRoute === false ? [] : ['POST /threads']),
      ...(options.deleteRoute === false ? [] : ['DELETE /threads/:id']),
    ],
    messages: options.chatRoute === false ? [] : ['POST /proxy/chat/default'],
    agent: [],
    tools: [],
    artifacts: [],
  },
  reconnect: { mode: 'canonical-state-replay', eventCursor: false },
  serverTime: '2026-11-01T00:00:00.000Z',
});

interface RecordedJsonRequest {
  path: string;
  method: string;
  body: unknown;
}

interface BusinessProfile {
  name: string;
  client: Pick<
    RemoteHostBusinessClient,
    | 'listThreads'
    | 'getMessages'
    | 'createThread'
    | 'deleteThread'
    | 'sendMessage'
  >;
  jsonRequests: RecordedJsonRequest[];
  sseRequests: Array<PostSseRequest<RemoteChatStreamEvent>>;
  setManifest(manifest: RemoteManifest): void;
  setHistory(history: RemoteMessage[]): void;
  failHistory(error: unknown): void;
  failCreate(error: unknown): void;
  createUncertainError(): RemoteHostError;
  createDeniedCode: string;
  writeDeniedCode: string;
}

const parseChatEvents = (
  request: PostSseRequest<RemoteChatStreamEvent>,
): PostSseSession<RemoteChatStreamEvent> => ({
  abort: jest.fn(),
  events: (async function* () {
    yield request.parse({ type: 'start' });
    yield request.parse({ type: 'text-delta', id: 'assistant-1', delta: 'Reply' });
    yield request.parse({ type: 'finish', finishReason: 'stop' });
  })(),
});

const makePairedProfile = async (): Promise<BusinessProfile> => {
  const state = {
    manifest: manifest(),
    history: history(),
    historyError: null as unknown,
    createError: null as unknown,
  };
  const jsonRequests: RecordedJsonRequest[] = [];
  const json = async <T>(request: RemoteJsonRequest<T>): Promise<T> => {
    jsonRequests.push({
      path: request.path,
      method: request.method ?? 'GET',
      body: request.body,
    });
    if (request.path === '/remote/v1/manifest') {
      return request.parse(state.manifest);
    }
    if (request.path.startsWith('/threads/') && request.path.endsWith('/messages')) {
      if (state.historyError) throw state.historyError;
      return request.parse(state.history);
    }
    if (request.path.startsWith('/threads?')) return request.parse([thread]);
    if (request.path === '/threads/thread-1') return request.parse(thread);
    if (request.path === '/threads' && request.method === 'POST') {
      if (state.createError) throw state.createError;
      return request.parse(thread);
    }
    if (request.method === 'DELETE') return request.parse(null);
    throw new Error('Unexpected paired request: ' + request.path);
  };
  const sseRequests: Array<PostSseRequest<RemoteChatStreamEvent>> = [];
  const sse = <T>(request: PostSseRequest<T>): PostSseSession<T> => {
    sseRequests.push(request as PostSseRequest<RemoteChatStreamEvent>);
    return parseChatEvents(request as PostSseRequest<RemoteChatStreamEvent>) as PostSseSession<T>;
  };
  const store = new MemoryDeviceCredentialStore();
  await store.save({
    hostUrl: 'https://mira.example.ts.net',
    relay: null,
    credential: 'mira_device_device-1.secret',
    deviceId: 'device-1',
    scopes: ['threads:read', 'messages:read', 'messages:write'],
    savedAt: '2026-11-01T00:00:00.000Z',
  });
  const client = new RemoteMiraHostClient(store, json, sse);
  await client.restoreConnection();

  return {
    name: 'paired Direct',
    client,
    jsonRequests,
    sseRequests,
    setManifest: next => { state.manifest = next; },
    setHistory: next => { state.history = next; },
    failHistory: error => { state.historyError = error; },
    failCreate: error => { state.createError = error; },
    createUncertainError: () =>
      new RemoteHostError('NETWORK_ERROR', 'response lost'),
    createDeniedCode: 'THREAD_CREATE_UNAVAILABLE',
    writeDeniedCode: 'MESSAGES_WRITE_UNAVAILABLE',
  };
};

const makeCloudProfile = (): BusinessProfile => {
  const state = {
    manifest: manifest(),
    history: history(),
    historyError: null as unknown,
    createError: null as unknown,
  };
  const access = {
    target: {
      endpoint: 'https://isolated-cloud-relay.example.test',
      room: 'cloud-room-a',
      hostId: 'desktop-a',
    },
    tickets: { acquireClientTicket: jest.fn(async () => 'secret-ticket') },
  };
  const entry = {
    discover: jest.fn(async () => access),
    assertCurrentAccess: jest.fn(),
    reset: jest.fn(),
  };
  const jsonRequests: RecordedJsonRequest[] = [];
  const json = async <T>(
    _target: unknown,
    _tickets: unknown,
    request: RemoteJsonRequest<T>,
  ): Promise<T> => {
    jsonRequests.push({
      path: request.path,
      method: request.method ?? 'GET',
      body: request.body,
    });
    if (request.path === '/remote/v1/manifest') {
      return request.parse(state.manifest);
    }
    if (request.path.startsWith('/threads/') && request.path.endsWith('/messages')) {
      if (state.historyError) throw state.historyError;
      return request.parse(state.history);
    }
    if (request.path.startsWith('/threads?')) return request.parse([thread]);
    if (request.path === '/threads/thread-1') return request.parse(thread);
    if (request.path === '/threads' && request.method === 'POST') {
      if (state.createError) throw state.createError;
      return request.parse(thread);
    }
    if (request.method === 'DELETE') return request.parse(null);
    throw new Error('Unexpected Cloud request: ' + request.path);
  };
  const sseRequests: Array<PostSseRequest<RemoteChatStreamEvent>> = [];
  const sse = <T>(
    _target: unknown,
    _tickets: unknown,
    request: PostSseRequest<T>,
  ): PostSseSession<T> => {
    sseRequests.push(request as PostSseRequest<RemoteChatStreamEvent>);
    return parseChatEvents(request as PostSseRequest<RemoteChatStreamEvent>) as PostSseSession<T>;
  };
  const client = new CloudRemoteBusinessClient(
    entry as never,
    json as never,
    sse as never,
  );

  return {
    name: 'Cloud Relay',
    client,
    jsonRequests,
    sseRequests,
    setManifest: next => { state.manifest = next; },
    setHistory: next => { state.history = next; },
    failHistory: error => { state.historyError = error; },
    failCreate: error => { state.createError = error; },
    createUncertainError: () =>
      new RemoteHostError('RELAY_DISCONNECTED', 'Socket lost'),
    createDeniedCode: 'CLOUD_HOST_GRANT_REQUIRED',
    writeDeniedCode: 'CLOUD_HOST_GRANT_REQUIRED',
  };
};

const sendInput = (overrides: Partial<SendRemoteMessageInput> = {}): SendRemoteMessageInput => ({
  threadId: thread.id,
  messageId: 'mobile-new',
  content: 'continue',
  ...overrides,
});

describe.each([
  ['paired', makePairedProfile],
  ['Cloud', makeCloudProfile],
])('%s Remote Host shared business contract', (_name, makeProfile) => {
  let profile: BusinessProfile;

  beforeEach(async () => {
    profile = await makeProfile();
  });

  it('lists and reads canonical Host thread/message ids', async () => {
    await expect(profile.client.listThreads()).resolves.toMatchObject([
      { id: thread.id },
    ]);
    await expect(profile.client.getMessages(thread.id)).resolves.toMatchObject([
      { id: 'user-old' },
      { id: 'assistant-old' },
      { id: 'tool-old' },
    ]);
  });

  it('appends the Host canonical transcript and its exact tail cursor', async () => {
    await profile.client.sendMessage(sendInput());

    expect(profile.sseRequests).toHaveLength(1);
    expect(profile.sseRequests[0]!.path).toBe('/proxy/chat/default');
    expect(profile.sseRequests[0]!.body).toMatchObject({
      id: thread.id,
      messageId: 'mobile-new',
      appendAtTail: { expectedTailMessageId: 'tool-old' },
      messages: [
        {
          id: 'user-old',
          role: 'user',
          parts: [{ type: 'text', text: 'remember this' }],
        },
        {
          id: 'assistant-old',
          role: 'assistant',
          parts: [{ type: 'text', text: 'I remember' }],
        },
        {
          id: 'mobile-new',
          role: 'user',
          parts: [{ type: 'text', text: 'continue' }],
        },
      ],
    });
  });

  it('uses a null cursor for a genuinely empty Host transcript', async () => {
    profile.setHistory([]);
    await profile.client.sendMessage(sendInput());
    expect(profile.sseRequests[0]!.body).toMatchObject({
      appendAtTail: { expectedTailMessageId: null },
    });
  });

  it('refuses to open the chat stream when canonical history is unavailable', async () => {
    profile.failHistory(new RemoteHostError('NETWORK_ERROR', 'offline'));
    await expect(profile.client.sendMessage(sendInput())).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    expect(profile.sseRequests).toHaveLength(0);
  });

  it('maps the shared Host SSE stream exactly once', async () => {
    const session = await profile.client.sendMessage(sendInput());
    const events: unknown[] = [];
    for await (const event of session.events) events.push(event);
    expect(events).toEqual([
      { type: 'start' },
      { type: 'text-delta', id: 'assistant-1', delta: 'Reply' },
      { type: 'finish', finishReason: 'stop' },
    ]);
  });

  it('gates create/delete/send on scope plus manifest route', async () => {
    profile.setManifest(manifest({ writeScope: false, chatRoute: false }));
    await expect(profile.client.createThread('denied')).rejects.toMatchObject({
      code: profile.createDeniedCode,
    });
    await expect(profile.client.sendMessage(sendInput())).rejects.toMatchObject({
      code: profile.writeDeniedCode,
    });

    profile.setManifest(manifest({ chatRoute: false }));
    await expect(profile.client.sendMessage(sendInput())).rejects.toMatchObject({
      code: profile.writeDeniedCode,
    });
    expect(profile.sseRequests).toHaveLength(0);
  });

  it('dispatches an uncertain create at most once and never replays it', async () => {
    profile.failCreate(profile.createUncertainError());
    await expect(profile.client.createThread('once')).rejects.toMatchObject({
      code: 'THREAD_CREATE_UNCERTAIN',
    });
    expect(
      profile.jsonRequests.filter(
        request => request.method === 'POST' && request.path === '/threads',
      ),
    ).toHaveLength(1);
  });

  it('deletes only through the shared mutation contract', async () => {
    await expect(profile.client.deleteThread(thread.id)).resolves.toBeUndefined();
    expect(
      profile.jsonRequests.filter(
        request => request.method === 'DELETE' && request.path === `/threads/${thread.id}`,
      ),
    ).toHaveLength(1);
  });
});
