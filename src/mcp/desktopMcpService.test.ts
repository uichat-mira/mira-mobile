import type { RemoteJsonRequest } from '../api/remoteHttp';
import type { CloudRelayAccess } from '../cloud/cloudRelayEntry';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import { useDesktopConnectionStore } from '../connectivity/desktopConnectionAuthority';
import type { StoredDeviceCredential } from '../security/deviceCredentialStore';
import {
  ToolApprovalRequiredError,
  type ToolApprovalRequest,
} from '../tools/toolGatewayClient';
import {
  createCloudDesktopMcpDiscovery,
  createDirectDesktopMcpDiscovery,
  DESKTOP_MCP_SERVICE_ID,
  DESKTOP_MCP_RESOURCE_URI,
} from './desktopMcpService';

const directCredential: StoredDeviceCredential = {
  hostUrl: 'https://100.64.0.8:41131',
  credential: 'paired-device-token',
  deviceId: 'desktop-device-a',
  scopes: ['tools:read', 'tools:invoke', 'tools:approve', 'tools:control'],
  savedAt: '2026-11-24T00:00:00.000Z',
};

const remoteManifest = {
  protocolVersion: 1,
  device: {
    id: 'mobile-device-a',
    name: 'Mira Mobile',
    platform: 'mobile',
    scopes: ['tools:read', 'tools:invoke', 'tools:approve', 'tools:control'],
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
    mcp: ['POST /mcp'],
  },
  reconnect: { mode: 'canonical-state-replay', eventCursor: false },
  serverTime: '2026-11-24T00:00:00.000Z',
};

const desktopTool = {
  name: 'read',
  title: 'Read file',
  description: 'Read a file from the selected Desktop workspace',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false,
  },
};

const capabilityDocument = {
  schema: 'mira.service-capabilities/v1',
  version: '1.0.0',
  service: {
    id: 'mira-desktop',
    name: 'Mira Desktop',
    description: 'Desktop tools',
    documentation: 'https://github.com/uichat-mira/mira-desktop',
    mcp: {
      serverName: 'mira-desktop',
      serverVersion: '0.4.0',
      sdk: 'mira-desktop-tool-core',
      protocolVersions: ['2025-06-18'],
    },
  },
  capabilities: [{
    id: 'desktop.files.read',
    title: 'Read files',
    description: 'Read files from the selected Desktop workspace',
    access: 'read',
    requiredScopes: ['tools:read', 'tools:invoke'],
    confirmation: 'none',
    tools: ['read'],
  }],
  fallback: {
    unknownSchema: 'Use tools/list',
    unclassifiedTools: 'Expose permitted real tools without invented groups',
  },
};

const rpcResult = (
  payload: Record<string, unknown>,
  mode: 'completed' | 'approval' = 'completed',
): unknown => {
  const id = payload.id;
  const method = payload.method;
  if (method === 'notifications/initialized') return null;
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
        },
        serverInfo: { name: 'mira-desktop', version: '0.4.0' },
      },
    };
  }
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: [desktopTool] } };
  }
  if (method === 'resources/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        resources: [{
          uri: DESKTOP_MCP_RESOURCE_URI,
          name: 'Mira Desktop capabilities',
          mimeType: 'application/json',
        }],
      },
    };
  }
  if (method === 'resources/read') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        contents: [{
          uri: DESKTOP_MCP_RESOURCE_URI,
          mimeType: 'application/json',
          text: JSON.stringify(capabilityDocument),
        }],
      },
    };
  }
  if (method === 'tools/call') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{
          type: 'text',
          text: mode === 'approval' ? 'approval required' : 'desktop-content',
        }],
        structuredContent: {
          invocationId: 'inv-1',
          toolId: 'tool-read',
          status: mode === 'approval' ? 'awaiting_approval' : 'completed',
          ...(mode === 'approval'
            ? { approval: { message: 'Allow Desktop read?', scope: 'workspace' } }
            : {}),
        },
        isError: mode === 'approval',
      },
    };
  }
  throw new Error('Unexpected MCP method ' + String(method));
};

const parseBody = (request: RemoteJsonRequest<unknown>) =>
  request.body as Record<string, unknown>;

describe('Mira Desktop MCP Mobile binding', () => {
  const originalDesktop = useDesktopConnectionStore.getState();
  const originalCloud = useCloudAccountStore.getState();

  afterEach(() => {
    useDesktopConnectionStore.setState(originalDesktop);
    useCloudAccountStore.setState(originalCloud);
  });

  it('uses POST /mcp over the active Direct transport and keeps Remote V1 only for manifest/approval', async () => {
    useDesktopConnectionStore.setState({
      mode: 'direct',
      generation: 7,
      transitioning: false,
      hydrated: true,
    });
    const credentialStore = {
      load: jest.fn(async () => directCredential),
    };
    let toolMode: 'completed' | 'approval' = 'completed';
    const request = jest.fn(async <T>(input: RemoteJsonRequest<T>): Promise<T> => {
      if (input.path === '/remote/v1/manifest') {
        return input.parse(remoteManifest);
      }
      if (input.path !== '/mcp' || input.method !== 'POST' || input.raw !== true) {
        throw new Error('Unexpected Direct path ' + input.path);
      }
      return input.parse(rpcResult(parseBody(input as RemoteJsonRequest<unknown>), toolMode));
    });
    const approvalClient = {
      resolveToolApproval: jest.fn(async () => ({
        invocationId: 'inv-1',
        toolId: 'tool-read',
        status: 'completed' as const,
        content: 'approved-desktop-content',
      })),
    };

    const snapshot = await createDirectDesktopMcpDiscovery(7, {
      credentialStore,
      request: request as typeof import('../api/remoteHttp').requestRemoteJson,
      approvalClient,
    }).discover({ accountId: null });

    expect(snapshot.service.id).toBe(DESKTOP_MCP_SERVICE_ID);
    expect(snapshot.service.capabilities).toEqual([
      expect.objectContaining({
        id: 'desktop.files.read',
        toolNames: ['read'],
      }),
    ]);
    expect(snapshot.tools).toEqual([
      expect.objectContaining({ name: 'read', parameters: desktopTool.inputSchema }),
    ]);
    expect(snapshot.bindingKey).toContain('direct:desktop-device-a:');
    expect(request.mock.calls.map(([call]) => call.path)).toEqual(
      expect.arrayContaining(['/remote/v1/manifest', '/mcp']),
    );
    expect(request.mock.calls.some(([call]) =>
      call.path === '/remote/v1/tools' ||
      call.path === '/remote/v1/tool-invocations/stream'
    )).toBe(false);
    // Direct paired Desktop never opts into the Cloud thread workspace header.
    expect(request.mock.calls.every(([call]) => call.headers === undefined))
      .toBe(true);

    await expect(snapshot.executionGateway?.callTool({
      callId: 'call-direct',
      name: 'read',
      arguments: '{"path":"README.md"}',
    })).resolves.toEqual({ content: 'desktop-content' });

    toolMode = 'approval';
    let approval: ToolApprovalRequest | null = null;
    try {
      await snapshot.executionGateway?.callTool({
        callId: 'call-approval',
        name: 'read',
        arguments: '{"path":"AGENTS.md"}',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ToolApprovalRequiredError);
      approval = (error as ToolApprovalRequiredError).approval;
    }
    expect(approval).toMatchObject({
      invocationId: 'inv-1',
      name: 'read',
      scope: 'workspace',
    });
    await expect(snapshot.executionGateway?.resolveApproval?.(
      approval as ToolApprovalRequest,
      'approved',
    )).resolves.toEqual({
      status: 'completed',
      result: { content: 'approved-desktop-content' },
    });
    expect(approvalClient.resolveToolApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        invocationId: 'inv-1',
        toolId: 'tool-read',
        decision: 'approved',
        args: { path: 'AGENTS.md' },
      }),
    );
  });

  it('sends the Local thread header only on official Cloud tools/call and its approval', async () => {
    useDesktopConnectionStore.setState({
      mode: 'cloud',
      generation: 11,
      transitioning: false,
      hydrated: true,
    });
    useCloudAccountStore.setState({
      status: 'signed_in',
      account: { id: 'account-a', displayName: 'Tomz' },
    } as never);
    const access: CloudRelayAccess = {
      accountId: 'account-a',
      target: {
        endpoint: 'https://relay.example.test',
        room: 'room-host-a',
        hostId: 'host-a',
      },
      tickets: {
        acquireClientTicket: jest.fn(async () => 'ticket-a'),
      },
    };
    const entry = {
      discoverHost: jest.fn(async () => access),
      assertCurrentAccess: jest.fn(),
    };
    let toolMode: 'completed' | 'approval' = 'completed';
    const json = jest.fn(async <T>(
      _target: CloudRelayAccess['target'],
      _tickets: CloudRelayAccess['tickets'],
      request: RemoteJsonRequest<T>,
    ): Promise<T> => {
      if (request.path === '/remote/v1/manifest') {
        return request.parse(remoteManifest);
      }
      if (request.path === '/mcp') {
        return request.parse(
          rpcResult(parseBody(request as RemoteJsonRequest<unknown>), toolMode),
        );
      }
      if (request.path.endsWith('/approval')) {
        return request.parse({
          invocationId: 'inv-1',
          toolId: 'tool-read',
          status: 'completed',
          content: 'approved-desktop-content',
        });
      }
      throw new Error('Unexpected Relay path ' + request.path);
    });
    const threadWorkspace = {
      assertBindingCompatible: jest.fn(),
      rememberBinding: jest.fn(async () => undefined),
    };
    const snapshot = await createCloudDesktopMcpDiscovery({
      accountId: 'account-a',
      hostId: 'host-a',
      generation: 11,
      threadId: 'local-thread-1',
      entry,
      json: json as never,
      threadWorkspace,
    }).discover({ accountId: 'account-a' });

    await expect(snapshot.executionGateway?.callTool({
      callId: 'call-relay',
      name: 'read',
      arguments: '{"path":"README.md"}',
    })).resolves.toEqual({ content: 'desktop-content' });

    const mcpCalls = json.mock.calls
      .map(([, , request]) => request)
      .filter((request) => request.path === '/mcp');
    const toolsCall = mcpCalls.find(
      (request) =>
        (request.body as { method?: string }).method === 'tools/call',
    );
    const initialize = mcpCalls.find(
      (request) =>
        (request.body as { method?: string }).method === 'initialize',
    );
    expect(toolsCall?.headers).toEqual({
      'X-Mira-Thread-Id': 'local-thread-1',
    });
    expect(initialize?.headers).toBeUndefined();
    expect(threadWorkspace.assertBindingCompatible).toHaveBeenCalledWith({
      threadId: 'local-thread-1',
      accountId: 'account-a',
      hostId: 'host-a',
      deviceId: 'mobile-device-a',
    });
    expect(threadWorkspace.rememberBinding).toHaveBeenCalledWith({
      threadId: 'local-thread-1',
      accountId: 'account-a',
      hostId: 'host-a',
      deviceId: 'mobile-device-a',
      generation: 11,
    });

    threadWorkspace.rememberBinding.mockRejectedValueOnce(new Error('storage unavailable'));
    const before = json.mock.calls.length;
    await expect(snapshot.executionGateway?.callTool({
      callId: 'storage-failed', name: 'read', arguments: '{"path":"README.md"}',
    })).rejects.toMatchObject({ code: 'THREAD_BINDING_STORAGE_FAILED' });
    expect(json.mock.calls).toHaveLength(before);

    toolMode = 'approval';
    let approval: ToolApprovalRequest | null = null;
    try {
      await snapshot.executionGateway?.callTool({
        callId: 'call-approval',
        name: 'read',
        arguments: '{"path":"AGENTS.md"}',
      });
    } catch (error) {
      approval = (error as ToolApprovalRequiredError).approval;
    }
    await snapshot.executionGateway?.resolveApproval?.(
      approval as ToolApprovalRequest,
      'approved',
    );
    const approvalCall = json.mock.calls
      .map(([, , request]) => request)
      .find((request) => request.path.endsWith('/approval'));
    expect(approvalCall?.headers).toEqual({
      'X-Mira-Thread-Id': 'local-thread-1',
    });
  });

  it('uses the same MCP protocol over official Relay and binds the exact selected Host', async () => {
    useDesktopConnectionStore.setState({
      mode: 'cloud',
      generation: 11,
      transitioning: false,
      hydrated: true,
    });
    useCloudAccountStore.setState({
      status: 'signed_in',
      account: { id: 'account-a', displayName: 'Tomz' },
    } as never);
    const access: CloudRelayAccess = {
      accountId: 'account-a',
      target: {
        endpoint: 'https://relay.example.test',
        room: 'room-host-a',
        hostId: 'host-a',
      },
      tickets: {
        acquireClientTicket: jest.fn(async () => 'ticket-a'),
      },
    };
    const entry = {
      discoverHost: jest.fn(async (hostId: string) => {
        if (hostId !== 'host-a') throw new Error('wrong host');
        return access;
      }),
      assertCurrentAccess: jest.fn((seen: CloudRelayAccess) => {
        if (seen !== access) throw new Error('stale access');
      }),
    };
    const json = jest.fn(async <T>(
      _target: CloudRelayAccess['target'],
      _tickets: CloudRelayAccess['tickets'],
      request: RemoteJsonRequest<T>,
    ): Promise<T> => {
      if (request.path === '/remote/v1/manifest') {
        return request.parse(remoteManifest);
      }
      if (request.path !== '/mcp' || request.method !== 'POST' || request.raw !== true) {
        throw new Error('Unexpected Relay path ' + request.path);
      }
      return request.parse(rpcResult(parseBody(request as RemoteJsonRequest<unknown>)));
    });

    const snapshot = await createCloudDesktopMcpDiscovery({
      accountId: 'account-a',
      hostId: 'host-a',
      generation: 11,
      entry,
      json: json as never,
    }).discover({ accountId: 'account-a' });

    expect(snapshot.service.id).toBe(DESKTOP_MCP_SERVICE_ID);
    expect(snapshot.bindingKey).toContain('cloud:account-a:host-a:');
    await expect(snapshot.executionGateway?.callTool({
      callId: 'call-relay',
      name: 'read',
      arguments: '{"path":"README.md"}',
    })).resolves.toEqual({ content: 'desktop-content' });
    expect(json.mock.calls.map(([, , call]) => call.path)).toEqual(
      expect.arrayContaining(['/remote/v1/manifest', '/mcp']),
    );
    expect(json.mock.calls.some(([, , call]) =>
      call.path === '/remote/v1/tools' ||
      call.path === '/remote/v1/tool-invocations/stream'
    )).toBe(false);

    useDesktopConnectionStore.setState({ generation: 12 });
    expect(() => snapshot.assertCurrent?.()).toThrow(
      'The active Desktop connection changed',
    );
  });
});
