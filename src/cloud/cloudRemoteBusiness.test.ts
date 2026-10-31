import {
  type CloudRelayTicketProvider,
  type CloudRelayTransportTarget,
} from '../api/cloudRelay';
import { RemoteHostError, type RemoteJsonRequest } from '../api/remoteHttp';
import type { PostSseRequest } from '../api/postSse';
import {
  type RemoteDeviceScope,
} from '../protocol/remoteHostV1';
import { CloudRemoteBusinessClient } from './cloudRemoteBusiness';

const target = {
  endpoint: 'https://isolated-cloud-relay.example.test',
  room: 'cloud-room-a',
  hostId: 'desktop-a',
};
const tickets = { acquireClientTicket: jest.fn(async () => 'secret-client-ticket') };

const manifest = (scopes: RemoteDeviceScope[] = [
  'threads:read', 'messages:read', 'messages:write',
]) => ({
  protocolVersion: 1,
  device: { id: 'cloud-mobile-a', name: 'Mira Mobile', platform: 'mobile', scopes },
  routes: {
    threads: ['GET /threads', 'GET /threads/:id', 'POST /threads', 'DELETE /threads/:id'],
    messages: ['POST /proxy/chat/default'],
    agent: [], tools: [], artifacts: [],
  },
  reconnect: { mode: 'canonical-state-replay', eventCursor: false },
  serverTime: '2026-11-01T00:00:00.000Z',
});

const thread = {
  id: 'remote-thread-1', title: 'From Desktop', modelName: null,
  workspaceId: null, knowledgeBaseId: null, roleId: null,
  agentEnabled: false, status: 'active',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:01:00.000Z', messageCount: 0,
};

const access = { target, tickets };

const harness = (scopes?: RemoteDeviceScope[]) => {
  const entry = {
    discover: jest.fn(async () => access),
    assertCurrentAccess: jest.fn(),
    reset: jest.fn(),
  };
  const responses = new Map<string, unknown>([
    ['/remote/v1/manifest', manifest(scopes)],
    ['/threads?status=active&sortBy=updatedAt&sortOrder=desc', [thread]],
    ['/threads/remote-thread-1', thread],
    ['/threads/remote-thread-1/messages', []],
    ['/threads', thread],
    ['/DELETE /threads/remote-thread-1', null],
  ]);

  const json = jest.fn(async <T>(
    _target: CloudRelayTransportTarget,
    _tickets: CloudRelayTicketProvider,
    request: RemoteJsonRequest<T>,
  ): Promise<T> => {
    const key = request.method === 'DELETE' ? 'DELETE ' + request.path : request.path;
    return request.parse(responses.get(key));
  });

  const sse = jest.fn(<T>(
    _target: CloudRelayTransportTarget,
    _tickets: CloudRelayTicketProvider,
    _request: PostSseRequest<T>,
  ) => ({
    events: (async function* () { yield { type: 'finish', finishReason: 'stop' } as unknown as T; })(),
    abort: jest.fn(),
  }));
  const client = new CloudRemoteBusinessClient(entry, json, sse);
  return { client, entry, json, sse, responses };
};

describe('MOB-080 Cloud-only business transport', () => {
  beforeEach(() => tickets.acquireClientTicket.mockClear());

  it('reads canonical Desktop threads with Cloud authority and never sends a business bearer', async () => {
    const { client, entry, json } = harness();
    await expect(client.listThreads()).resolves.toMatchObject([{ id: thread.id }]);
    await expect(client.getMessages(thread.id)).resolves.toEqual([]);
    expect(entry.discover).toHaveBeenCalledTimes(2);
    for (const [requestTarget, ticketSource, request] of json.mock.calls) {
      expect(requestTarget).toBe(target);
      expect(ticketSource).toBe(tickets);
      expect(request.hostUrl).toBe(target.endpoint);
      expect(request.allowInsecureDevelopment).toBe(false);
      expect(request).not.toHaveProperty('credential');
    }
    expect(tickets.acquireClientTicket).not.toHaveBeenCalled();
  });

  it('requires the Host manifest grant before mutations', async () => {
    const { client, json, sse } = harness(['threads:read', 'messages:read']);
    await expect(client.createThread('Denied')).rejects.toMatchObject({
      code: 'CLOUD_HOST_GRANT_REQUIRED', status: 403,
    });
    await expect(client.sendMessage({
      threadId: thread.id, messageId: 'mobile-1', content: 'Hello',
    })).rejects.toMatchObject({ code: 'CLOUD_HOST_GRANT_REQUIRED' });
    expect(json).toHaveBeenCalledTimes(2);
    expect(json.mock.calls.every(([, , request]) => request.path === '/remote/v1/manifest'))
      .toBe(true);
    expect(sse).not.toHaveBeenCalled();
  });

  it('performs one probed mutation and marks uncertain Relay disconnect without replay', async () => {
    const { client, json } = harness();
    json.mockImplementation(async <T>(
      _target: CloudRelayTransportTarget,
      _tickets: CloudRelayTicketProvider,
      request: RemoteJsonRequest<T>,
    ): Promise<T> => {
      if (request.method === 'POST') {
        throw new RemoteHostError('RELAY_DISCONNECTED', 'Socket lost');
      }
      return request.parse(manifest());
    });
    await expect(client.createThread('Once')).rejects.toMatchObject({
      code: 'THREAD_CREATE_UNCERTAIN',
    });
    expect(json.mock.calls.filter(([, , request]) => request.method === 'POST'))
      .toHaveLength(1);
  });

  it('opens Cloud chat SSE using the canonical Host request, without Legacy Authorization', async () => {
    const { client, sse, json } = harness();
    const stream = await client.sendMessage({
      threadId: thread.id,
      messageId: 'mobile-stable-1',
      content: 'Hello',
      agentEnabled: true,
    });
    expect(stream.abort).toEqual(expect.any(Function));
    expect(json).toHaveBeenCalledTimes(1);
    const [requestTarget, ticketSource, request] = sse.mock.calls[0];
    expect(requestTarget).toBe(target);
    expect(ticketSource).toBe(tickets);
    expect(request).toMatchObject({
      hostUrl: target.endpoint,
      path: '/proxy/chat/default',
      credential: '',
      allowInsecureDevelopment: false,
      body: {
        id: thread.id,
        messageId: 'mobile-stable-1',
        agentEnabled: true,
        messages: [{
          id: 'mobile-stable-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Hello' }],
        }],
      },
    });
    expect(request.credential).not.toContain('ticket');
    expect(tickets.acquireClientTicket).not.toHaveBeenCalled();
  });

  it('rejects response data after an account switch, rather than displaying stale sessions', async () => {
    const { client, entry } = harness();
    entry.assertCurrentAccess
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new RemoteHostError('CLOUD_RELAY_SESSION_REJECTED', 'Switched account');
      });
    await expect(client.listThreads()).rejects.toMatchObject({
      code: 'CLOUD_RELAY_SESSION_REJECTED',
    });
  });
});
