import { RemoteHostError } from '../api/remoteHttp';
import { CompositeToolGatewayClient } from './compositeToolGatewayClient';
import type {
  ToolCallRequest,
  ToolGatewayClient,
  ToolManifest,
} from './toolGatewayClient';

const localManifest: ToolManifest = {
  name: 'local_weather_current',
  description: 'Local weather',
  parameters: { type: 'object' },
  destructive: false,
  requiresApproval: false,
};

const remoteManifest: ToolManifest = {
  name: 'mcp_search',
  description: 'Remote search',
  parameters: { type: 'object' },
};

const request = (name: string): ToolCallRequest => ({
  callId: 'call-1',
  name,
  arguments: '{}',
});

const client = (overrides: Partial<ToolGatewayClient>): ToolGatewayClient =>
  ({
    listTools: jest.fn(async () => []),
    callTool: jest.fn(async () => ({ content: 'ok' })),
    ...overrides,
  }) as ToolGatewayClient;

describe('CompositeToolGatewayClient', () => {
  it('merges local and remote tools, preferring local names on collision', async () => {
    const local = client({
      listTools: jest.fn(async () => [
        localManifest,
        { ...localManifest, name: 'shared_tool' },
      ]),
    });
    const remote = client({
      listTools: jest.fn(async () => [
        { ...remoteManifest, name: 'shared_tool' },
        remoteManifest,
      ]),
    });

    const gateway = new CompositeToolGatewayClient(local, remote);

    await expect(gateway.listTools()).resolves.toEqual([
      localManifest,
      { ...localManifest, name: 'shared_tool' },
      remoteManifest,
    ]);
  });

  it('keeps local tools available when the Host is not paired', async () => {
    const local = client({
      listTools: jest.fn(async () => [localManifest]),
    });
    const remote = client({
      listTools: jest.fn(async () => {
        throw new RemoteHostError('PAIRING_REQUIRED', 'Host is not paired');
      }),
    });

    const gateway = new CompositeToolGatewayClient(local, remote);

    await expect(gateway.listTools()).resolves.toEqual([localManifest]);
  });

  it('reports a degraded toolset when the Host is unreachable', async () => {
    const local = client({
      listTools: jest.fn(async () => [localManifest]),
    });
    const remote = client({
      listTools: jest.fn(async () => {
        throw new RemoteHostError('NETWORK_ERROR', 'Network is down');
      }),
    });

    const gateway = new CompositeToolGatewayClient(local, remote);

    await expect(gateway.discoverTools()).resolves.toEqual({
      tools: [localManifest],
      notices: [{ code: 'toolset-degraded' }],
    });
  });

  it('reports a degraded toolset when the Host returns a server error', async () => {
    const gateway = new CompositeToolGatewayClient(
      client({ listTools: jest.fn(async () => [localManifest]) }),
      client({
        listTools: jest.fn(async () => {
          throw new RemoteHostError('HTTP_ERROR', 'Upstream failed', 503);
        }),
      }),
    );

    await expect(gateway.discoverTools()).resolves.toEqual({
      tools: [localManifest],
      notices: [{ code: 'toolset-degraded' }],
    });
  });

  it('rethrows a lost tool scope instead of hiding it as unavailable', async () => {
    const gateway = new CompositeToolGatewayClient(
      client({ listTools: jest.fn(async () => [localManifest]) }),
      client({
        listTools: jest.fn(async () => {
          throw new RemoteHostError(
            'REMOTE_SCOPE_REQUIRED',
            'Tool scope is missing',
            403,
          );
        }),
      }),
    );

    await expect(gateway.discoverTools()).rejects.toMatchObject({
      code: 'REMOTE_SCOPE_REQUIRED',
    });
  });

  it('rethrows a protocol or alias defect instead of hiding it as unavailable', async () => {
    const gateway = new CompositeToolGatewayClient(
      client({ listTools: jest.fn(async () => [localManifest]) }),
      client({
        listTools: jest.fn(async () => {
          throw new RemoteHostError(
            'REMOTE_TOOL_ALIAS_CONFLICT',
            'Alias conflict',
          );
        }),
      }),
    );

    await expect(gateway.discoverTools()).rejects.toMatchObject({
      code: 'REMOTE_TOOL_ALIAS_CONFLICT',
    });
  });

  it('reports no notices when remote discovery succeeds', async () => {
    const gateway = new CompositeToolGatewayClient(
      client({ listTools: jest.fn(async () => [localManifest]) }),
      client({ listTools: jest.fn(async () => [remoteManifest]) }),
    );

    await expect(gateway.discoverTools()).resolves.toEqual({
      tools: [localManifest, remoteManifest],
      notices: [],
    });
  });

  it('routes local tool calls locally and remote calls remotely', async () => {
    const local = client({
      listTools: jest.fn(async () => [localManifest]),
      callTool: jest.fn(async () => ({ content: 'local' })),
    });
    const remote = client({
      listTools: jest.fn(async () => [remoteManifest]),
      callTool: jest.fn(async () => ({ content: 'remote' })),
    });

    const gateway = new CompositeToolGatewayClient(local, remote);

    await expect(gateway.callTool(request(localManifest.name))).resolves.toEqual({
      content: 'local',
    });
    expect(local.callTool).toHaveBeenCalledTimes(1);
    expect(remote.callTool).not.toHaveBeenCalled();

    await expect(gateway.callTool(request(remoteManifest.name))).resolves.toEqual({
      content: 'remote',
    });
    expect(remote.callTool).toHaveBeenCalledTimes(1);
  });

  it('delegates approval resolution to the remote gateway', async () => {
    const resolution = { status: 'rejected' as const };
    const remoteResolve = jest.fn(async () => resolution);
    const local = client({});
    const remote = client({ resolveApproval: remoteResolve });
    const gateway = new CompositeToolGatewayClient(local, remote);
    const approval = {
      invocationId: 'inv-1',
      callId: 'call-1',
      name: remoteManifest.name,
      arguments: '{}',
      message: 'Approve?',
    };

    await expect(
      gateway.resolveApproval(approval, 'rejected'),
    ).resolves.toEqual(resolution);
    expect(remoteResolve).toHaveBeenCalledWith(approval, 'rejected', undefined);
  });

  it('rejects approval when the remote gateway has no approval support', async () => {
    const gateway = new CompositeToolGatewayClient(client({}), client({}));

    await expect(
      gateway.resolveApproval(
        {
          invocationId: 'inv-1',
          callId: 'call-1',
          name: remoteManifest.name,
          arguments: '{}',
          message: 'Approve?',
        },
        'approved',
      ),
    ).rejects.toMatchObject({ code: 'TOOL_APPROVAL_UNSUPPORTED' });
  });
});
