import { CloudHostRuntime } from './cloudHostRuntime';
import { RemoteHostError } from '../api/remoteHttp';

const thread = {
  id: 'remote-1', title: 'Mac Desktop', updatedAt: '2026-11-16T02:00:00Z',
  workspaceId: null, knowledgeBaseId: null, roleId: null,
  agentEnabled: false, status: 'active', messageCount: 1,
};
const message = {
  id: 'msg-1', role: 'user' as const, content: 'Hello', parts: [],
  createdAt: '2026-11-16T02:00:00Z', metadata: {},
};
const manifest = {
  device: { scopes: ['threads:read'], id: 'cloud-mobile' },
  routes: { threads: ['GET /threads'], messages: [] as string[] },
};
const api = () => ({
  listThreads: jest.fn(async () => [thread]),
  getThread: jest.fn(async () => thread),
  getMessages: jest.fn(async () => [message]),
  getManifest: jest.fn(async () => manifest),
  deleteThread: jest.fn(async () => undefined),
  sendMessage: jest.fn(async () => ({
    abort: jest.fn(), events: (async function* () {
      yield { type: 'text-delta', delta: 'Reply' };
      yield { type: 'finish', finishReason: 'stop' };
    })(),
  })),
});

describe('CloudHostRuntime independent Cloud business origin', () => {
  it('converts canonical Cloud threads and messages without paired-client access', async () => {
    const client = api();
    const runtime = new CloudHostRuntime(client as never);
    await expect(runtime.listSessions()).resolves.toMatchObject([
      { id: 'remote-1', source: 'cloud-host', title: 'Mac Desktop' },
    ]);
    await expect(runtime.getSession('remote-1')).resolves.toMatchObject({
      id: 'remote-1', source: 'cloud-host',
    });
    await expect(runtime.getMessages('remote-1')).resolves.toMatchObject([
      { id: 'msg-1', role: 'user', content: 'Hello' },
    ]);
  });

  it('cannot delete under read-only Cloud Host grant', async () => {
    const client = api();
    const runtime = new CloudHostRuntime(client as never);
    await expect(runtime.canDeleteSession()).resolves.toBe(false);
    await expect(runtime.deleteSession('remote-1')).rejects.toMatchObject({
      code: 'CLOUD_HOST_GRANT_REQUIRED', status: 403,
    } satisfies Partial<RemoteHostError>);
    expect(client.deleteThread).not.toHaveBeenCalled();
  });

  it('streams canonical chat events only through the Cloud adapter', async () => {
    const client = api();
    const runtime = new CloudHostRuntime(client as never);
    const events = await runtime.sendMessage('remote-1', 'Hello', { messageId: 'stable-msg' });
    const seen = [];
    for await (const event of events) seen.push(event);
    expect(seen).toEqual([
      { type: 'text-delta', delta: 'Reply' },
      { type: 'finish', reason: 'stop' },
    ]);
    expect(client.sendMessage).toHaveBeenCalledWith({
      threadId: 'remote-1', content: 'Hello', messageId: 'stable-msg',
    });
  });

  it('allows legacy Agent history reads but rejects every mutation without Workspace', async () => {
    const client = api();
    client.getThread.mockResolvedValueOnce({
      ...thread, agentEnabled: true, workspaceId: null,
    });
    const runtime = new CloudHostRuntime(client as never);
    await expect(runtime.getMessages('remote-1')).resolves.toHaveLength(1);
    await expect(runtime.sendMessage('remote-1', 'do not run')).rejects.toMatchObject({
      code: 'CLOUD_AGENT_WORKSPACE_REQUIRED', status: 403,
    });
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('checks canonical thread Workspace before enabling Cloud message input', async () => {
    const client = api();
    client.getManifest.mockResolvedValue({
      ...manifest,
      device: { ...manifest.device, scopes: ['threads:read', 'messages:write'] },
      routes: { ...manifest.routes, messages: ['POST /proxy/chat/default'] },
    });
    const runtime = new CloudHostRuntime(client as never);
    await expect(runtime.canSendMessage()).resolves.toBe(false);
    client.getThread.mockResolvedValueOnce({
      ...thread, agentEnabled: true, workspaceId: null,
    });
    await expect(runtime.canSendMessage('remote-1')).resolves.toBe(false);
    await expect(runtime.canSendMessage('remote-1')).resolves.toBe(true);
    expect(client.getThread).toHaveBeenCalledTimes(2);
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects partial chat streams, without fabricating a finish', async () => {
    const client = api();
    client.sendMessage.mockResolvedValueOnce({
      abort: jest.fn(), events: (async function* () {
        yield { type: 'text-delta', delta: 'partial' };
      })(),
    });
    const runtime = new CloudHostRuntime(client as never);
    const events = await runtime.sendMessage('remote-1', 'Hello');
    const consume = async () => { for await (const event of events) { void event; } };
    await expect(consume()).rejects.toMatchObject({ code: 'CHAT_STREAM_INCOMPLETE' });
  });
});
