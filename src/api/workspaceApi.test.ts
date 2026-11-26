import type { RemoteJsonRequest } from './remoteHttp';
import { RemoteHostError } from './remoteHttp';
import { WorkspaceApiClient } from './workspaceApi';
import { MemoryDeviceCredentialStore } from '../security/deviceCredentialStore';

type JsonTransport = <T>(request: RemoteJsonRequest<T>) => Promise<T>;
const workspacePayload = [
  {
    id: 'workspace-1',
    name: 'Mira Mobile',
    isDefault: false,
    status: 'active',
    createdAt: '2026-08-27T09:00:00.000Z',
    updatedAt: '2026-08-27T10:00:00.000Z',
  },
];

const remoteThread = (
  id: string,
  workspaceId: string,
  updatedAt = '2026-08-27T10:00:00.000Z',
) => ({
  id,
  title: `Thread ${id}`,
  modelName: null,
  workspaceId,
  knowledgeBaseId: null,
  roleId: null,
  agentEnabled: false,
  status: 'active',
  createdAt: '2026-08-27T09:00:00.000Z',
  updatedAt,
  messageCount: 1,
});

const pairedStore = async () => {
  const store = new MemoryDeviceCredentialStore();
  await store.save({
    hostUrl: 'https://mira.example.ts.net',
    credential: 'mira_device_device-1.secret',
    deviceId: 'device-1',
    scopes: ['threads:read'],
    savedAt: '2026-08-27T00:00:00.000Z',
  });
  return store;
};

describe('WorkspaceApiClient', () => {
  it('reads the exact Mobile-safe workspace route without rootPath', async () => {
    const store = await pairedStore();
    const directMock = jest.fn();
    const direct: JsonTransport = async request => {
      directMock(request);
      return request.parse(workspacePayload);
    };
    const client = new WorkspaceApiClient(store, direct);

    await expect(client.listChatWorkspaces()).resolves.toEqual(workspacePayload);
    expect(directMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/remote/v1/workspaces' }),
    );
    expect(await client.listChatWorkspaces()).toEqual([
      expect.not.objectContaining({ rootPath: expect.anything() }),
    ]);
  });

  it('rejects an unsafe workspace projection that exposes rootPath', async () => {
    const store = await pairedStore();
    const direct: JsonTransport = async request =>
      request.parse([{ ...workspacePayload[0], rootPath: '/Users/private/Mira' }]);
    const client = new WorkspaceApiClient(store, direct);

    await expect(client.listChatWorkspaces()).rejects.toThrow('rootPath');
  });

  it('does not fall back or clear the paired credential when reading is forbidden', async () => {
    const store = await pairedStore();
    const direct: JsonTransport = async () => {
      throw new RemoteHostError('HTTP_403', 'forbidden', 403);
    };
    const client = new WorkspaceApiClient(store, direct);

    await expect(client.listChatWorkspaces()).rejects.toMatchObject({ status: 403 });
    await expect(store.load()).resolves.toMatchObject({
      credential: 'mira_device_device-1.secret',
      deviceId: 'device-1',
    });
  });

  it('reports a Direct network failure without fallback', async () => {
    const store = await pairedStore();
    const directMock = jest.fn();
    const direct: JsonTransport = async request => {
      directMock(request);
      throw new RemoteHostError('NETWORK_ERROR', 'offline');
    };
    const client = new WorkspaceApiClient(store, direct);
    await expect(client.listChatWorkspaces()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(directMock).toHaveBeenCalledTimes(1);
  });

  it('uses the authoritative workspace thread pagination contract and preserves opaque cursors verbatim', async () => {
    const store = await pairedStore();
    const paths: string[] = [];
    const workspaceId = 'workspace / 1';
    const opaqueCursor = ' cursor + next ';
    const direct: JsonTransport = async request => {
      paths.push(request.path);
      if (request.path.includes('cursor=')) {
        return request.parse({
          items: [remoteThread('thread-2', workspaceId)],
          total: 2,
          nextCursor: null,
          limit: 50,
        });
      }
      return request.parse({
        items: [remoteThread('thread-1', workspaceId)],
        total: 2,
        nextCursor: opaqueCursor,
        limit: 50,
      });
    };
    const client = new WorkspaceApiClient(store, direct);

    const first = await client.listWorkspaceThreads(workspaceId);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      id: 'thread-1',
      workspaceId,
    });
    expect(first.total).toBe(2);
    expect(first.nextCursor).toBe(opaqueCursor);
    expect(paths[0]).toBe(
      '/remote/v1/workspaces/workspace%20%2F%201/threads?status=active&limit=50',
    );

    const second = await client.listWorkspaceThreads(workspaceId, {
      cursor: first.nextCursor,
    });
    expect(second.items.map(item => item.id)).toEqual(['thread-2']);
    expect(second.total).toBe(2);
    expect(second.nextCursor).toBeNull();
    expect(paths[1]).toBe(
      '/remote/v1/workspaces/workspace%20%2F%201/threads?status=active&limit=50&cursor=%20cursor%20%2B%20next%20',
    );
  });

  it('rejects a workspace page containing a thread from another workspace', async () => {
    const store = await pairedStore();
    const direct: JsonTransport = async request =>
      request.parse({
        items: [remoteThread('wrong', 'workspace-2')],
        total: 1,
        nextCursor: null,
        limit: 50,
      });
    const client = new WorkspaceApiClient(store, direct);

    await expect(
      client.listWorkspaceThreads('workspace-1'),
    ).rejects.toThrow('outside workspace');
  });

  it('preserves a workspace 404 instead of inventing an empty project', async () => {
    const store = await pairedStore();
    const direct: JsonTransport = async () => {
      throw new RemoteHostError('HTTP_404', 'not found', 404);
    };
    const client = new WorkspaceApiClient(store, direct);

    await expect(client.listWorkspaceThreads('workspace-1')).rejects.toMatchObject({
      status: 404,
    });
  });
});
