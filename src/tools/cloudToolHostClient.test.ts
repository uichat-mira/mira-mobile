import {
  requestCloudRelayJson,
  type CloudRelayTicketProvider,
  type CloudRelayTransportTarget,
} from '../api/cloudRelay';
import { RemoteHostError, type RemoteJsonRequest } from '../api/remoteHttp';
import type { PostSseRequest } from '../api/postSse';
import type { CloudRelayAccess } from '../cloud/cloudRelayEntry';
import type { RemoteDeviceScope } from '../protocol/remoteHostV1';
import { CloudToolHostClient } from './cloudToolHostClient';

const tool = {
  id: 'mcp:server-1:tool:search',
  name: 'mcp_server_1_tool_search_a1b2c3d4e5',
  description: 'Search',
  parameters: { type: 'object' },
  destructive: false,
  requiresApproval: false,
};

const invocation = {
  invocationId: 'inv-1',
  toolId: tool.id,
  status: 'completed' as const,
  content: 'result',
};

const makeAccess = (
  hostId = 'host-a',
  accountId = 'account-a',
): CloudRelayAccess => ({
  accountId,
  target: {
    endpoint: 'https://isolated-cloud-relay.example.test',
    room: 'room-a',
    hostId,
  },
  tickets: {
    acquireClientTicket: jest.fn(async () => 'transport-ticket'),
  } satisfies CloudRelayTicketProvider,
});

const manifest = (
  scopes: RemoteDeviceScope[] = ['tools:read', 'tools:invoke', 'tools:approve', 'tools:control'],
) => ({
  protocolVersion: 1,
  device: {
    id: 'cloud-mobile-a',
    name: 'Mira Mobile',
    platform: 'mobile',
    scopes,
  },
  routes: {
    threads: [],
    messages: [],
    agent: [],
    tools: [
      'GET /remote/v1/tools',
      'POST /remote/v1/tool-invocations/stream',
      'POST /remote/v1/tool-invocations/:invocationId/approval',
      'POST /remote/v1/tool-invocations/:invocationId/cancel',
    ],
    artifacts: [],
  },
  reconnect: { mode: 'canonical-state-replay', eventCursor: false },
  serverTime: '2026-11-01T00:00:00.000Z',
});

const harness = (options: {
  scopes?: RemoteDeviceScope[];
  access?: CloudRelayAccess;
  json?: jest.Mock;
  sse?: jest.Mock;
  current?: { value: boolean };
} = {}) => {
  const access = options.access ?? makeAccess();
  const current = options.current ?? { value: true };
  const entry = {
    discoverHost: jest.fn(async (_hostId: string) => access),
    assertCurrentAccess: jest.fn((seen: CloudRelayAccess) => {
      if (!current.value || seen !== access) {
        throw new RemoteHostError(
          'CLOUD_RELAY_SESSION_REJECTED',
          'stale Cloud session',
        );
      }
    }),
  };
  const json = options.json ?? jest.fn(async <T>(
    _target: CloudRelayTransportTarget,
    _tickets: CloudRelayTicketProvider,
    request: RemoteJsonRequest<T>,
  ): Promise<T> => {
    if (request.path === '/remote/v1/manifest') {
      return request.parse(manifest(options.scopes));
    }
    if (request.path === '/remote/v1/tools') return request.parse([tool]);
    if (request.path.endsWith('/approval')) return request.parse(invocation);
    if (request.path.endsWith('/cancel')) {
      return request.parse({
        invocationId: 'inv-1',
        accepted: true,
        status: 'cancelling',
      });
    }
    throw new Error('Unexpected Cloud tool path ' + request.path);
  });
  const sse = options.sse ?? jest.fn(<T>(
    _target: CloudRelayTransportTarget,
    _tickets: CloudRelayTicketProvider,
    _request: PostSseRequest<T>,
  ) => ({
    events: (async function* () {
      yield {
        type: 'tool:start',
        invocationId: 'inv-1',
        toolId: tool.id,
      } as unknown as T;
      yield {
        type: 'tool:complete',
        invocation: invocation,
      } as unknown as T;
    })(),
    abort: jest.fn(),
  }));
  const client = new CloudToolHostClient(
    access.accountId,
    access.target.hostId,
    entry,
    json as unknown as typeof requestCloudRelayJson,
    sse as unknown as typeof import('../api/cloudRelay').openCloudRelayPostSse,
    () => current.value,
  );
  return { access, client, entry, json, sse, current };
};

describe('CloudToolHostClient', () => {
  it('lists Host tools through Cloud Relay without a business credential', async () => {
    const f = harness();
    await expect(f.client.listRemoteTools()).resolves.toEqual([tool]);
    expect(f.json.mock.calls.map(([, , request]) => request.path)).toEqual([
      '/remote/v1/manifest',
      '/remote/v1/tools',
    ]);
    for (const [target, tickets, request] of f.json.mock.calls) {
      expect(target).toBe(f.access.target);
      expect(tickets).toBe(f.access.tickets);
      expect(request.hostUrl).toBe(f.access.target.endpoint);
      expect(request.allowInsecureDevelopment).toBe(false);
      expect(request).not.toHaveProperty('credential');
    }
    expect(f.access.tickets.acquireClientTicket).not.toHaveBeenCalled();
  });

  it('requires the Host-advertised tools route and read scope', async () => {
    await expect(
      harness({ scopes: ['tools:invoke'] }).client.listRemoteTools(),
    ).rejects.toMatchObject({ code: 'CLOUD_TOOL_GRANT_REQUIRED', status: 403 });

    const json = jest.fn(async <T>(
      _target: CloudRelayTransportTarget,
      _tickets: CloudRelayTicketProvider,
      request: RemoteJsonRequest<T>,
    ): Promise<T> => {
      const value = manifest();
      value.routes.tools = [];
      return request.parse(value);
    });
    await expect(
      harness({ json }).client.listRemoteTools(),
    ).rejects.toMatchObject({ code: 'CLOUD_TOOL_ROUTE_UNAVAILABLE', status: 403 });
    expect(json).toHaveBeenCalledTimes(1);
  });

  it('never advertises an Agent tool when the Host grants read but not invoke', async () => {
    const f = harness({ scopes: ['tools:read', 'tools:approve', 'tools:control'] });
    await expect(f.client.listRemoteTools()).rejects.toMatchObject({
      code: 'CLOUD_TOOL_GRANT_REQUIRED',
      status: 403,
    });
    expect(f.json.mock.calls.map(([, , request]) => request.path))
      .toEqual(['/remote/v1/manifest']);
    expect(f.sse).not.toHaveBeenCalled();
  });

  it('opens a Cloud tool invocation SSE with the exact frozen Host call', async () => {
    const f = harness();
    const session = await f.client.openToolInvocation({
      toolId: tool.id,
      args: { query: 'mira' },
    });
    const events = [];
    for await (const event of session.events) events.push(event);
    expect(events).toHaveLength(2);
    const [target, tickets, request] = f.sse.mock.calls[0];
    expect(target).toBe(f.access.target);
    expect(tickets).toBe(f.access.tickets);
    expect(request).toMatchObject({
      hostUrl: f.access.target.endpoint,
      path: '/remote/v1/tool-invocations/stream',
      credential: '',
      allowInsecureDevelopment: false,
      body: { toolId: tool.id, args: { query: 'mira' } },
    });
    expect(request.credential).not.toContain('ticket');
  });

  it('refuses a tool invocation before opening SSE when invoke scope is missing', async () => {
    const f = harness({ scopes: ['tools:read', 'tools:approve', 'tools:control'] });
    await expect(
      f.client.openToolInvocation({ toolId: tool.id, args: {} }),
    ).rejects.toMatchObject({ code: 'CLOUD_TOOL_GRANT_REQUIRED' });
    expect(f.sse).not.toHaveBeenCalled();
  });

  it('cancels through the existing Host control route and scope', async () => {
    const f = harness();
    await expect(f.client.cancelToolInvocation('inv-1')).resolves.toEqual({
      invocationId: 'inv-1',
      accepted: true,
      status: 'cancelling',
    });
    const cancel = f.json.mock.calls.find(
      ([, , request]) => request.path.endsWith('/cancel'),
    );
    expect(cancel?.[2]).toMatchObject({
      method: 'POST',
      path: '/remote/v1/tool-invocations/inv-1/cancel',
    });

    const denied = harness({ scopes: ['tools:read', 'tools:invoke', 'tools:approve'] });
    await expect(
      denied.client.cancelToolInvocation('inv-1'),
    ).rejects.toMatchObject({ code: 'CLOUD_TOOL_GRANT_REQUIRED' });
  });

  it('reuses the existing Host approval contract and marks Relay loss uncertain', async () => {
    const json = jest.fn(async <T>(
      _target: CloudRelayTransportTarget,
      _tickets: CloudRelayTicketProvider,
      request: RemoteJsonRequest<T>,
    ): Promise<T> => {
      if (request.path === '/remote/v1/manifest') return request.parse(manifest());
      throw new RemoteHostError('RELAY_DISCONNECTED', 'Socket lost');
    });
    const f = harness({ json });
    await expect(
      f.client.resolveToolApproval({
        invocationId: 'inv-1',
        decision: 'approved',
        toolId: tool.id,
        args: { query: 'mira' },
      }),
    ).rejects.toMatchObject({ code: 'TOOL_APPROVAL_UNCERTAIN' });
    expect(json.mock.calls.filter(([, , request]) => request.method === 'POST'))
      .toHaveLength(1);
  });

  it('fails closed when the account or bound Host changes mid-run', async () => {
    const secondAccess = makeAccess('host-b');
    const f = harness();
    (f.entry.discoverHost as jest.Mock)
      .mockResolvedValueOnce(f.access)
      .mockResolvedValue(secondAccess);
    // The real entry points assertCurrentAccess at its newest access; this
    // fixture only verifies that the client refuses the different Host.
    f.entry.assertCurrentAccess.mockImplementation(() => undefined);
    await expect(f.client.listRemoteTools()).resolves.toEqual([tool]);
    await expect(
      f.client.listRemoteTools(),
    ).rejects.toMatchObject({ code: 'CLOUD_TOOL_HOST_CHANGED' });
    expect(f.json.mock.calls).toHaveLength(2);
  });

  it('rejects a stale access after the Cloud account stops being current', async () => {
    const f = harness();
    await expect(f.client.listRemoteTools()).resolves.toEqual([tool]);
    f.current.value = false;
    await expect(f.client.listRemoteTools()).rejects.toMatchObject({
      code: 'CLOUD_TOOL_HOST_CHANGED',
    });
  });
});
