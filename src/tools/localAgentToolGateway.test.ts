import {
  requestCloudRelayJson,
  type CloudRelayTicketProvider,
  type CloudRelayTransportTarget,
} from '../api/cloudRelay';
import { RemoteHostError, type RemoteJsonRequest } from '../api/remoteHttp';
import type { PostSseRequest, PostSseSession } from '../api/postSse';
import type { CloudDesktopHost } from '../cloud/cloudAuthApi';
import type { CloudRelayAccess } from '../cloud/cloudRelayEntry';
import type { RemoteDeviceScope } from '../protocol/remoteHostV1';
import type { RuntimeEvent } from '../runtime/conversationRuntime';
import { PiCoreAgentLoop } from '../runtime/piAgentLoop';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import type { OpenAiMessage, OpenAiTool } from '../provider/openAiStandardClient';
import {
  LocalAgentToolGateway,
  type CloudToolAccountContext,
} from './localAgentToolGateway';
import {
  DESKTOP_HOST_DISCOVERY_TOOL,
  TOOL_DISCLOSURE_TOOL,
  ToolApprovalRequiredError,
  type ToolApprovalRequest,
  type ToolApprovalResolution,
  type ToolGatewayClient,
  type ToolManifest,
  type ToolServiceDescriptor,
} from './toolGatewayClient';
import type { WhoYouMcpServiceDiscovery } from '../mcp/whoYouMcpService';
import { WhoYouError } from '../whoYou/whoYouError';

const localTool: ToolManifest = {
  name: 'local_weather_current',
  description: 'Local weather',
  parameters: { type: 'object' },
};

const sharedToolName = 'mcp_server_1_tool_search_a1b2c3d4e5';
const cloudTool = {
  id: 'mcp:server-1:tool:search:host-a',
  name: sharedToolName,
  description: 'Search on host A',
  parameters: { type: 'object' },
  destructive: false,
  requiresApproval: false,
};
const cloudToolB = {
  ...cloudTool,
  id: 'mcp:server-1:tool:search:host-b',
  description: 'Search on host B',
};

const makeHost = (
  id: string,
  name: string | null,
  overrides: Partial<CloudDesktopHost> = {},
): CloudDesktopHost => ({
  id,
  deviceId: `device-${id}`,
  displayName: name,
  clientVersion: '1.0.0',
  availability: 'available',
  relayRoom: `room-${id}`,
  registeredAt: '2026-11-01T00:00:00.000Z',
  lastAdvertisedAt: '2026-11-01T00:01:00.000Z',
  leaseExpiresAt: '2026-11-01T00:03:00.000Z',
  ...overrides,
});

const hostA = makeHost('host-a', 'MacBook Pro');
const hostB = makeHost('host-b', 'Office PC', {
  lastAdvertisedAt: '2026-11-01T00:02:00.000Z',
});

const makeAccess = (
  hostId = 'host-a',
  accountId = 'account-a',
  room = `room-${hostId}`,
): CloudRelayAccess => ({
  accountId,
  target: {
    endpoint: 'https://isolated-cloud-relay.example.test',
    room,
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
  device: { id: 'cloud-mobile-a', name: 'Mira Mobile', platform: 'mobile', scopes },
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

const localGateway = (overrides: Partial<ToolGatewayClient> = {}): ToolGatewayClient => ({
  listTools: jest.fn(async () => [localTool]),
  callTool: jest.fn(async () => ({ content: 'local-result' })),
  ...overrides,
});

const pairedGateway = (): ToolGatewayClient => ({
  listTools: jest.fn(async () => [{
    name: 'paired_tool',
    description: 'Paired Host tool',
    parameters: { type: 'object' },
  }]),
  callTool: jest.fn(async () => ({ content: 'paired-result' })),
});

interface HostSetup {
  host: CloudDesktopHost;
  scopes?: RemoteDeviceScope[];
  tools?: typeof cloudTool[];
  error?: RemoteHostError;
}

const discoveryFixture = (options: {
  hosts?: HostSetup[];
  listError?: unknown;
  accountId?: string;
  sse?: jest.Mock;
} = {}) => {
  const accountId = options.accountId ?? 'account-a';
  const setups = options.hosts ?? [{ host: hostA, tools: [cloudTool] }];
  const accesses = new Map(setups.map(setup => [
    setup.host.id,
    makeAccess(setup.host.id, accountId, setup.host.relayRoom),
  ]));
  const findByRoom = (room: string): HostSetup => {
    const setup = setups.find(item => item.host.relayRoom === room);
    if (!setup) throw new Error('Unknown Cloud room ' + room);
    return setup;
  };
  const entry = {
    listHostCandidates: jest.fn(async () => {
      if (options.listError) throw options.listError;
      return {
        accountId,
        hosts: setups.map(setup => ({
          hostId: setup.host.id,
          deviceId: setup.host.deviceId,
          name: setup.host.displayName,
          availability: setup.host.availability,
          clientVersion: setup.host.clientVersion,
          lastAdvertisedAt: setup.host.lastAdvertisedAt,
        })),
      };
    }),
    discoverHost: jest.fn(async (hostId: string) => {
      if (options.listError) throw options.listError;
      const setup = setups.find(item => item.host.id === hostId);
      if (!setup) {
        throw new RemoteHostError('CLOUD_RELAY_HOST_NOT_FOUND', 'missing');
      }
      if (setup.host.availability !== 'available') {
        throw new RemoteHostError('CLOUD_RELAY_HOST_OFFLINE', 'offline');
      }
      return accesses.get(hostId) as CloudRelayAccess;
    }),
    assertCurrentAccess: jest.fn((seen: CloudRelayAccess) => {
      if (![...accesses.values()].includes(seen)) {
        throw new RemoteHostError(
          'CLOUD_RELAY_SESSION_REJECTED',
          'stale Cloud session',
        );
      }
    }),
  };
  const jsonImpl = async function <T>(
    target: CloudRelayTransportTarget,
    _tickets: CloudRelayTicketProvider,
    request: RemoteJsonRequest<T>,
  ): Promise<T> {
    const setup = findByRoom(target.room);
    if (setup.error) throw setup.error;
    const tools = setup.tools ?? [cloudTool];
    if (request.path === '/remote/v1/manifest') {
      return request.parse(manifest(setup.scopes));
    }
    if (request.path === '/remote/v1/tools') return request.parse(tools);
    if (request.path.endsWith('/approval')) {
      return request.parse({
        invocationId: 'inv-1',
        toolId: tools[0].id,
        status: 'completed',
        content: 'approved-result-' + setup.host.id,
      });
    }
    throw new Error('Unexpected Cloud tool path ' + request.path);
  };
  const json = jest.fn(jsonImpl);
  const sseImpl = function <T>(
    target: CloudRelayTransportTarget,
    _tickets: CloudRelayTicketProvider,
    _request: PostSseRequest<T>,
  ) {
    const setup = findByRoom(target.room);
    const tool = (setup.tools ?? [cloudTool])[0];
    return {
    events: (async function* () {
      yield {
        type: 'tool:start',
        invocationId: 'inv-1',
        toolId: tool.id,
      } as unknown as T;
      yield {
        type: 'tool:complete',
        invocation: {
          invocationId: 'inv-1',
          toolId: tool.id,
          status: 'completed',
          content: 'cloud-result-' + setup.host.id,
        },
      } as unknown as T;
    })(),
    abort: jest.fn(),
    };
  };
  const sse = options.sse ?? jest.fn(sseImpl);
  return { accesses, setups, entry, json, sse };
};

const cloudContext = (
  value: CloudToolAccountContext,
): (() => CloudToolAccountContext) => () => value;

const gateway = (
  fixture: ReturnType<typeof discoveryFixture>,
  options: {
    local?: ToolGatewayClient;
    paired?: ToolGatewayClient;
    context?: CloudToolAccountContext;
    selectionText?: string;
    previousAssistantText?: string;
    mcp?: WhoYouMcpServiceDiscovery | null;
  } = {},
) => new LocalAgentToolGateway({
  local: options.local ?? localGateway(),
  paired: options.paired ?? pairedGateway(),
  entry: fixture.entry,
  cloudContext: cloudContext(options.context ?? {
    accountId: 'account-a',
    explicitlySignedOut: false,
  }),
  json: fixture.json as unknown as typeof requestCloudRelayJson,
  sse: fixture.sse as unknown as typeof import('../api/cloudRelay').openCloudRelayPostSse,
  ...(options.selectionText ? { selectionText: options.selectionText } : {}),
  ...(options.previousAssistantText
    ? { previousAssistantText: options.previousAssistantText } : {}),
  ...(options.mcp !== undefined ? { mcp: options.mcp } : {}),
});

const asyncStream = <T>(events: T[]): AsyncIterable<T> =>
  (async function* () {
    for (const event of events) yield event;
  })();

const modelStream = (events: RuntimeEvent[]): AsyncIterable<RuntimeEvent> =>
  asyncStream(events);

const drain = async <T>(stream: AsyncIterable<T>): Promise<T[]> => {
  const events: T[] = [];
  for await (const event of stream) events.push(event);
  return events;
};

const discoverDesktop = async (selected: ToolGatewayClient) => {
  await selected.discoverTools?.();
  return selected.callTool({
    callId: 'discover-desktop',
    name: DESKTOP_HOST_DISCOVERY_TOOL,
    arguments: '{}',
  });
};

const previousHostPrompt = (...setups: HostSetup[]): string => [
  '检测到同一 Mira Cloud 账号下有多台可用的 Mira Desktop Host。请回复要使用哪一台：',
  '',
  ...setups.map((setup, index) =>
    String(index + 1) + '. ' + (setup.host.displayName ?? '未命名 Desktop') +
    '（Host ID：' + setup.host.id + '；在线；可用工具：搜索）',
  ),
  '',
  '请直接回复设备名称或 Host ID；确认后我会在下一轮使用该设备的工具。',
].join('\n');

describe('LocalAgentToolGateway', () => {
  it('uses the existing Local + paired Host toolset only when explicitly signed out', async () => {
    const fixture = discoveryFixture();
    const paired = pairedGateway();
    const selected = gateway(fixture, {
      paired,
      context: { accountId: null, explicitlySignedOut: true },
    });

    await expect(selected.listTools()).resolves.toEqual([{
      name: 'paired_tool',
      description: 'Paired Host tool',
      parameters: { type: 'object' },
    }]);
    expect(paired.listTools).toHaveBeenCalledTimes(1);
    expect(fixture.entry.listHostCandidates).not.toHaveBeenCalled();
  });

  it.each(['session_rejected', 'device_revoked'] as const)(
    'does not fall back to paired tools after Cloud status %s',
    async status => {
      const original = useCloudAccountStore.getState();
      useCloudAccountStore.setState({ status, account: null });
      try {
        const paired = pairedGateway();
        const fixture = discoveryFixture();
        const selected = new LocalAgentToolGateway({
          local: localGateway(),
          paired,
          entry: fixture.entry,
          json: fixture.json as unknown as typeof requestCloudRelayJson,
          sse: fixture.sse as unknown as typeof import('../api/cloudRelay').openCloudRelayPostSse,
        });
        await expect(selected.discoverTools()).resolves.toMatchObject({
          tools: [localTool],
          notices: [{ code: 'cloud-tools-session-invalid' }],
        });
        expect(paired.listTools).not.toHaveBeenCalled();
        expect(fixture.entry.listHostCandidates).not.toHaveBeenCalled();
      } finally {
        useCloudAccountStore.setState(original);
      }
    },
  );

  it('exposes a trusted local service catalog and rejects stale disclosure revisions', async () => {
    const selected = gateway(discoveryFixture());
    const initial = await selected.discoverTools();
    expect(initial.services).toEqual([{
      id: 'mira-mobile-local',
      name: 'Mira Mobile 本机',
      description: expect.any(String),
      toolNames: [localTool.name, DESKTOP_HOST_DISCOVERY_TOOL],
    }]);
    expect(initial.catalogRevision).toEqual(expect.any(String));

    const disclosed = await selected.discloseTools?.({
      serviceId: 'mira-mobile-local',
      toolNames: [localTool.name],
      catalogRevision: initial.catalogRevision,
    });
    expect(disclosed?.tools).toEqual([localTool]);

    await expect(selected.discloseTools?.({
      serviceId: 'mira-mobile-local',
      toolNames: [localTool.name],
      catalogRevision: 'stale-revision',
    })).rejects.toMatchObject({ code: 'TOOL_DISCLOSURE_STALE' });
  });

  it('publishes the selected Desktop service without inventing capability groups', async () => {
    const selected = gateway(discoveryFixture());
    await selected.discoverTools();
    const result = await discoverDesktop(selected);

    expect(result.refreshedServices).toEqual([
      expect.objectContaining({
        id: 'mira-mobile-local',
        toolNames: [localTool.name],
      }),
      {
        id: 'mira-desktop',
        name: 'Mira Desktop',
        description: expect.any(String),
        toolNames: [sharedToolName],
      },
    ]);
    expect(result.refreshedCatalogRevision).toEqual(expect.any(String));
    const disclosed = await selected.discloseTools?.({
      serviceId: 'mira-desktop',
      toolNames: [sharedToolName],
      catalogRevision: result.refreshedCatalogRevision,
    });
    expect(disclosed?.tools.map(tool => tool.name)).toEqual([sharedToolName]);
  });

  it('keeps local tools and never falls back to paired credentials when Cloud is signed in', async () => {
    const fixture = discoveryFixture();
    const paired = pairedGateway();
    const selected = gateway(fixture, { paired });

    const initial = await selected.discoverTools();
    expect(initial.tools.map(tool => tool.name)).toEqual([
      localTool.name, DESKTOP_HOST_DISCOVERY_TOOL,
    ]);
    expect(initial.notices).toEqual([]);
    expect(fixture.entry.listHostCandidates).not.toHaveBeenCalled();
    expect(fixture.json).not.toHaveBeenCalled();
    const result = await selected.callTool({
      callId: 'discover', name: DESKTOP_HOST_DISCOVERY_TOOL, arguments: '{}',
    });
    expect(result.refreshedTools?.map(tool => tool.name))
      .toEqual([localTool.name, sharedToolName]);
    await selected.callTool({
      callId: 'real-call', name: sharedToolName, arguments: '{}',
    });
    expect(fixture.sse.mock.calls[0][2]).toMatchObject({
      credential: '', body: { toolId: cloudTool.id },
    });
    expect(paired.listTools).not.toHaveBeenCalled();
  });

  it('reports no Host, offline Hosts, ambiguity, and missing grant separately', async () => {
    const noHost = gateway(discoveryFixture({ hosts: [] }));
    await expect(discoverDesktop(noHost)).rejects.toMatchObject({
      code: 'CLOUD_RELAY_HOST_OFFLINE',
    });
    const offline = gateway(discoveryFixture({
      hosts: [{ host: { ...hostA, availability: 'offline' } }],
    }));
    await expect(discoverDesktop(offline)).rejects.toMatchObject({
      code: 'CLOUD_RELAY_HOST_OFFLINE',
    });

    const ambiguous = gateway(discoveryFixture({
      hosts: [{ host: hostA }, { host: hostB }],
    }));
    const selection = await discoverDesktop(ambiguous);
    expect(selection).toMatchObject({
      hostSelectionRequired: true,
      hostCandidates: [
        { hostId: 'host-a', name: 'MacBook Pro', toolNames: [sharedToolName] },
        { hostId: 'host-b', name: 'Office PC', toolNames: [sharedToolName] },
      ],
    });

    const unauthorized = gateway(discoveryFixture({
      hosts: [{ host: hostA, scopes: ['tools:read'] }],
    }));
    await expect(discoverDesktop(unauthorized)).rejects.toMatchObject({
      code: 'CLOUD_TOOL_GRANT_REQUIRED',
    });
  });

  it('keeps the read-only Host tool out of the Local Agent model toolset', async () => {
    const fixture = discoveryFixture({
      hosts: [{ host: hostA, scopes: ['tools:read'] }],
    });
    const selected = gateway(fixture);
    const offeredTools: OpenAiTool[][] = [];
    const modelCall = jest.fn(async (
      _messages: readonly OpenAiMessage[],
      tools: readonly OpenAiTool[],
    ) => {
      offeredTools.push([...tools]);
      return modelStream([
        { type: 'text-delta', delta: '你好' },
        { type: 'finish', reason: 'stop' },
      ]);
    });
    const events = await drain(await new PiCoreAgentLoop(selected).run(
      [{ role: 'user', content: '你好' }], modelCall,
    ));
    expect(offeredTools[0]?.map(tool => tool.function.name))
      .toEqual([localTool.name, DESKTOP_HOST_DISCOVERY_TOOL]);
    expect(events).toContainEqual({ type: 'text-delta', delta: '你好' });
    expect(fixture.entry.listHostCandidates).not.toHaveBeenCalled();
    await expect(selected.callTool({
      callId: 'discover', name: DESKTOP_HOST_DISCOVERY_TOOL, arguments: '{}',
    })).rejects.toMatchObject({ code: 'CLOUD_TOOL_GRANT_REQUIRED' });
    expect(fixture.sse).not.toHaveBeenCalled();
  });

  it('separates invalid Cloud sessions, offline Hosts and protocol errors', async () => {
    for (const [inputCode, expectedCode] of [
      ['CLOUD_RELAY_SESSION_REJECTED', 'CLOUD_RELAY_SESSION_REJECTED'],
      ['CLOUD_RELAY_HOST_NOT_FOUND', 'CLOUD_RELAY_HOST_NOT_FOUND'],
      ['CLOUD_RELAY_INVALID_RESPONSE', 'CLOUD_RELAY_INVALID_RESPONSE'],
      ['RELAY_PROTOCOL_ERROR', 'RELAY_PROTOCOL_ERROR'],
    ]) {
      const fixture = discoveryFixture({
        listError: new RemoteHostError(inputCode, 'Cloud probe failed'),
      });
      const selected = gateway(fixture);
      await expect(selected.discoverTools()).resolves.toMatchObject({
        tools: [localTool, expect.objectContaining({
          name: DESKTOP_HOST_DISCOVERY_TOOL,
        })],
      });
      expect(fixture.entry.listHostCandidates).not.toHaveBeenCalled();
      await expect(selected.callTool({
        callId: 'discover', name: DESKTOP_HOST_DISCOVERY_TOOL, arguments: '{}',
      })).rejects.toMatchObject({ code: expectedCode });
    }
    const grantFailure = gateway(discoveryFixture({
      hosts: [{ host: hostA, error: new RemoteHostError(
        'RELAY_CLOUD_GRANT_REQUIRED', 'Cloud Host denied business request',
      ) }],
    }));
    await expect(discoverDesktop(grantFailure)).rejects.toMatchObject({
      code: 'CLOUD_TOOL_GRANT_REQUIRED',
    });
  });

  it('binds same-named tools to the selected Host and fails closed after it disappears', async () => {
    const mutableHostA = { ...hostA };
    const fixture = discoveryFixture({
      hosts: [
        { host: mutableHostA, tools: [cloudTool] },
        { host: hostB, tools: [cloudToolB] },
      ],
    });
    const prompt = previousHostPrompt(...fixture.setups);
    const firstRun = gateway(fixture, {
      selectionText: '用 MacBook Pro 搜索', previousAssistantText: prompt,
    });
    await expect(firstRun.discoverTools()).resolves.toMatchObject({
      tools: [localTool, expect.objectContaining({ name: sharedToolName })],
    });
    await firstRun.callTool({
      callId: 'call-a', name: sharedToolName, arguments: '{"query":"a"}',
    });
    expect(fixture.sse.mock.calls[0][2]).toMatchObject({
      body: { toolId: cloudTool.id },
    });

    const secondRun = gateway(fixture, {
      selectionText: 'Office PC 上搜索', previousAssistantText: prompt,
    });
    await expect(secondRun.discoverTools()).resolves.toMatchObject({
      tools: [localTool, expect.objectContaining({ name: sharedToolName })],
    });
    await secondRun.callTool({
      callId: 'call-b', name: sharedToolName, arguments: '{"query":"b"}',
    });
    expect(fixture.sse.mock.calls[1][2]).toMatchObject({
      body: { toolId: cloudToolB.id },
    });
    mutableHostA.availability = 'offline';
    await expect(firstRun.callTool({
      callId: 'call-stale', name: sharedToolName, arguments: '{}',
    })).rejects.toMatchObject({ code: 'CLOUD_RELAY_HOST_OFFLINE' });
  });

});

describe('Cloud Local Agent authority changes', () => {
  it('stops a run when the selected Host loses its tool grant', async () => {
    const setup: HostSetup = { host: hostA, tools: [cloudTool] };
    const fixture = discoveryFixture({ hosts: [setup] });
    const selected = gateway(fixture);
    const ready = await discoverDesktop(selected);
    expect(ready.refreshedTools?.map(tool => tool.name))
      .toContain(sharedToolName);
    await expect(selected.callTool({
      callId: 'call-allowed', name: sharedToolName, arguments: '{}',
    })).resolves.toEqual({ content: 'cloud-result-host-a' });

    setup.scopes = ['tools:read'];
    await expect(selected.callTool({
      callId: 'call-degraded', name: sharedToolName, arguments: '{}',
    })).rejects.toMatchObject({ code: 'CLOUD_TOOL_GRANT_REQUIRED' });
  });

  it('stops a run when the Cloud account switches', async () => {
    const fixture = discoveryFixture();
    let context: CloudToolAccountContext = {
      accountId: 'account-a', explicitlySignedOut: false,
    };
    const selected = new LocalAgentToolGateway({
      local: localGateway(),
      paired: pairedGateway(),
      entry: fixture.entry,
      cloudContext: () => context,
      json: fixture.json as unknown as typeof requestCloudRelayJson,
      sse: fixture.sse as unknown as typeof import('../api/cloudRelay').openCloudRelayPostSse,
    });
    expect((await discoverDesktop(selected)).refreshedTools?.map(tool => tool.name))
      .toContain(sharedToolName);
    context = { accountId: 'account-b', explicitlySignedOut: false };
    await expect(selected.callTool({
      callId: 'call-switched', name: sharedToolName, arguments: '{}',
    })).rejects.toMatchObject({ code: 'CLOUD_TOOL_HOST_CHANGED' });
  });

});

describe('Cloud Local Agent joint entry', () => {
  it('asks with real candidates, then binds the user-selected Host on the next turn', async () => {
    const fixture = discoveryFixture({
      hosts: [
        { host: hostA, tools: [cloudTool] },
        { host: hostB, tools: [cloudToolB] },
      ],
    });

    const clarificationModel = jest.fn(async () =>
      modelStream([
        { type: 'tool-call', callId: 'discover-hosts',
          name: DESKTOP_HOST_DISCOVERY_TOOL, arguments: '{}' },
        { type: 'finish', reason: 'tool_calls' },
      ]));
    const clarification = await drain(await new PiCoreAgentLoop(
      gateway(fixture),
    ).run(
      [{ role: 'user', content: '帮我找一下资料' }],
      clarificationModel,
    ));
    expect(clarificationModel).toHaveBeenCalledTimes(1);
    expect(fixture.sse).not.toHaveBeenCalled();
    expect(clarification).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'text-delta',
        delta: expect.stringContaining('MacBook Pro'),
      }),
      expect.objectContaining({
        type: 'text-delta',
        delta: expect.stringContaining('Office PC'),
      }),
      expect.objectContaining({ type: 'text-delta', delta: expect.stringContaining('Host ID') }),
      expect.objectContaining({ type: 'finish', reason: 'stop' }),
    ]));

    const priorPrompt = clarification.find((event): event is Extract<RuntimeEvent,
      { type: 'text-delta' }> =>
      event.type === 'text-delta' && event.delta.startsWith('检测到'))?.delta ?? '';
    const selected = gateway(fixture, {
      selectionText: '用 Office PC 搜索', previousAssistantText: priorPrompt,
    });
    const modelCall = jest.fn()
      .mockResolvedValueOnce(modelStream([
        {
          type: 'tool-call',
          callId: 'call-selected',
          name: sharedToolName,
          arguments: '{"query":"selected"}',
        },
        { type: 'finish', reason: 'tool_calls' },
      ]))
      .mockResolvedValueOnce(modelStream([
        { type: 'text-delta', delta: 'done' },
        { type: 'finish', reason: 'stop' },
      ]));
    const events = await drain(await new PiCoreAgentLoop(selected).run(
      [{ role: 'user', content: '用 Office PC 搜索' }],
      modelCall,
    ));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool-result',
        name: sharedToolName,
        content: 'cloud-result-host-b',
      }),
    ]));
    expect(fixture.sse.mock.calls[0][2]).toMatchObject({
      body: { toolId: cloudToolB.id, args: { query: 'selected' } },
    });
  });

  it('lets ordinary model and phone-only tool turns work with two online Desktops', async () => {
    const fixture = discoveryFixture({
      hosts: [{ host: hostA }, { host: hostB }],
    });
    const offered: string[][] = [];
    const modelCall = jest.fn(async (
      _messages: readonly OpenAiMessage[], tools: readonly OpenAiTool[],
    ) => {
      offered.push(tools.map(tool => tool.function.name));
      return modelStream([
        { type: 'text-delta', delta: '你好，有什么可以帮你？' },
        { type: 'finish', reason: 'stop' },
      ]);
    });
    const events = await drain(await new PiCoreAgentLoop(gateway(fixture)).run(
      [{ role: 'user', content: '你好' }], modelCall,
    ));
    expect(modelCall).toHaveBeenCalledTimes(1);
    expect(offered[0]).toEqual([localTool.name, DESKTOP_HOST_DISCOVERY_TOOL]);
    expect(events).toContainEqual({
      type: 'text-delta', delta: '你好，有什么可以帮你？',
    });
    expect(events.some(event => event.type === 'text-delta' &&
      event.delta.includes('请回复要使用哪一台'))).toBe(false);
    expect(fixture.sse).not.toHaveBeenCalled();

    const weather = jest.fn()
      .mockResolvedValueOnce(modelStream([
        { type: 'tool-call', callId: 'weather-call',
          name: localTool.name, arguments: '{}' },
        { type: 'finish', reason: 'tool_calls' },
      ]))
      .mockResolvedValueOnce(modelStream([
        { type: 'text-delta', delta: '当前天气已查询' },
        { type: 'finish', reason: 'stop' },
      ]));
    const weatherEvents = await drain(await new PiCoreAgentLoop(gateway(fixture)).run(
      [{ role: 'user', content: '查天气' }], weather,
    ));
    expect(weatherEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool-result',
        name: localTool.name, content: 'local-result' }),
    ]));
    expect(fixture.sse).not.toHaveBeenCalled();
  });

  it.each(['RELAY_NO_RESPONSE_STATUS', 'RELAY_CLOUD_GRANT_REQUIRED'] as const)(
    'keeps hello and local weather working when one Desktop would reject %s',
    async code => {
      const fixture = discoveryFixture({
        hosts: [{ host: hostA, error: new RemoteHostError(code, 'Host failed') }],
      });
      const selected = gateway(fixture);
      const calls: string[][] = [];
      const model = jest.fn(async (
        _messages: readonly OpenAiMessage[], tools: readonly OpenAiTool[],
      ) => {
        calls.push(tools.map(tool => tool.function.name));
        return modelStream([
          { type: 'text-delta', delta: '你好' },
          { type: 'finish', reason: 'stop' },
        ]);
      });
      const result = await drain(await new PiCoreAgentLoop(selected).run(
        [{ role: 'user', content: '你好' }], model,
      ));
      expect(result).toContainEqual({ type: 'text-delta', delta: '你好' });
      expect(model).toHaveBeenCalledTimes(1);
      expect(calls[0]).toEqual([localTool.name, DESKTOP_HOST_DISCOVERY_TOOL]);
      expect(fixture.entry.listHostCandidates).not.toHaveBeenCalled();
      expect(fixture.json).not.toHaveBeenCalled();

      const localResult = await selected.callTool({
        callId: 'weather', name: localTool.name, arguments: '{}',
      });
      expect(localResult.content).toBe('local-result');
      expect(fixture.json).not.toHaveBeenCalled();
      await expect(selected.callTool({
        callId: 'desktop', name: DESKTOP_HOST_DISCOVERY_TOOL, arguments: '{}',
      })).rejects.toMatchObject({
        code: code === 'RELAY_CLOUD_GRANT_REQUIRED'
          ? 'CLOUD_TOOL_GRANT_REQUIRED' : 'RELAY_NO_RESPONSE_STATUS',
      });
    },
  );

  it('resolves a numbered reply against the previous assistant list, not a new sort', async () => {
    const fixture = discoveryFixture({
      hosts: [{ host: hostA, tools: [cloudTool] },
        { host: hostB, tools: [cloudToolB] }],
    });
    const offered = gateway(fixture);
    const model = jest.fn(async () => modelStream([
      { type: 'tool-call', callId: 'list-hosts',
        name: DESKTOP_HOST_DISCOVERY_TOOL, arguments: '{}' },
      { type: 'finish', reason: 'tool_calls' },
    ]));
    const clarification = await drain(await new PiCoreAgentLoop(offered).run(
      [{ role: 'user', content: '用电脑搜索' }], model,
    ));
    const prompt = clarification.find((event): event is Extract<RuntimeEvent,
      { type: 'text-delta' }> => event.type === 'text-delta')?.delta ?? '';
    expect(prompt).toContain('1. MacBook Pro');
    expect(prompt).toContain('2. Office PC');

    // An unrelated / stale chat must not resolve a bare digit.
    const unrelated = await gateway(fixture, { selectionText: '2' }).discoverTools();
    expect(unrelated.tools.map(tool => tool.name)).toContain(DESKTOP_HOST_DISCOVERY_TOOL);
    const selected = gateway(fixture, {
      selectionText: '2', previousAssistantText: prompt,
    });
    const selection = await selected.discoverTools();
    expect(selection.tools.map(tool => tool.name)).toContain(sharedToolName);
    await selected.callTool({
      callId: 'numbered-call', name: sharedToolName, arguments: '{}',
    });
    expect(fixture.sse.mock.calls[0][2]).toMatchObject({
      body: { toolId: cloudToolB.id },
    });

    // If the indexed Host disappears, the old index never jumps to Host A.
    fixture.setups[1].host = { ...fixture.setups[1].host, availability: 'offline' };
    const offline = await gateway(fixture, {
      selectionText: '2', previousAssistantText: prompt,
    }).discoverTools();
    expect(offline.tools).toEqual([localTool]);
    expect(offline.notices).toEqual([{ code: 'cloud-tools-unavailable' }]);
  });

  it('routes a same-named tool approval to the selected Host only', async () => {
    const sse = jest.fn();
    const fixture = discoveryFixture({
      hosts: [
        { host: hostA, tools: [cloudTool] },
        { host: hostB, tools: [cloudToolB] },
      ],
      sse,
    });
    sse.mockImplementation(<T>(
      target: CloudRelayTransportTarget,
      _tickets: CloudRelayTicketProvider,
      _request: PostSseRequest<T>,
    ): PostSseSession<T> => {
      const setup = fixture.setups.find(item => item.host.relayRoom === target.room);
      const tool = (setup?.tools ?? [cloudTool])[0];
      return {
        events: (async function* () {
          yield {
            type: 'tool:approval_required',
            invocationId: 'inv-b',
            message: 'Run Desktop tool?',
            scope: 'terminal',
          } as unknown as T;
          yield {
            type: 'tool:complete',
            invocation: {
              invocationId: 'inv-b',
              toolId: tool.id,
              status: 'awaiting_approval',
              approval: { message: 'Run Desktop tool?', scope: 'terminal' },
            },
          } as unknown as T;
        })(),
        abort: jest.fn(),
      };
    });

    const selected = gateway(fixture, {
      selectionText: 'Office PC',
      previousAssistantText: previousHostPrompt(...fixture.setups),
    });
    const modelCall = jest.fn()
      .mockResolvedValueOnce(modelStream([
        {
          type: 'tool-call',
          callId: 'call-b-approval',
          name: sharedToolName,
          arguments: '{"query":"b"}',
        },
        { type: 'finish', reason: 'tool_calls' },
      ]))
      .mockResolvedValueOnce(modelStream([
        { type: 'text-delta', delta: 'approved' },
        { type: 'finish', reason: 'stop' },
      ]));
    const events = await drain(await new PiCoreAgentLoop(selected).run(
      [{ role: 'user', content: 'Office PC 搜索' }],
      modelCall,
      { requestApproval: jest.fn(async () => 'approved' as const) },
    ));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool-result',
        content: 'approved-result-host-b',
      }),
    ]));
    const approval = fixture.json.mock.calls.find(
      ([, , request]) => request.path.endsWith('/approval'),
    );
    expect(approval?.[0]).toMatchObject({ room: hostB.relayRoom });
    expect(approval?.[2]).toMatchObject({
      body: { toolId: cloudToolB.id, args: { query: 'b' } },
    });
  });

  it('uses Host ID to disambiguate identical device names', async () => {
    const sameNameA = makeHost('host-aaaa', 'Mira Desktop');
    const sameNameB = makeHost('host-bbbb', 'Mira Desktop');
    const fixture = discoveryFixture({
      hosts: [
        { host: sameNameA, tools: [cloudTool] },
        { host: sameNameB, tools: [cloudToolB] },
      ],
    });

    const ambiguous = await discoverDesktop(gateway(fixture));
    expect(ambiguous.hostCandidates?.map(candidate => candidate.hostId))
      .toEqual(['host-aaaa', 'host-bbbb']);

    const selected = gateway(fixture, {
      selectionText: '使用 host-bbbb',
      previousAssistantText: previousHostPrompt(...fixture.setups),
    });
    await expect(selected.discoverTools()).resolves.toMatchObject({
      tools: [localTool, expect.objectContaining({ name: sharedToolName })],
    });
    await selected.callTool({
      callId: 'call-by-id',
      name: sharedToolName,
      arguments: '{}',
    });
    expect(fixture.sse.mock.calls[0][2]).toMatchObject({
      body: { toolId: cloudToolB.id },
    });
  });

  it('runs PiCoreAgentLoop through the real Cloud adapter and existing RemoteToolGatewayClient', async () => {
    const fixture = discoveryFixture();
    const selected = gateway(fixture);
    const modelCall = jest.fn()
      .mockResolvedValueOnce(modelStream([
        { type: 'tool-call', callId: 'discover-desktop',
          name: DESKTOP_HOST_DISCOVERY_TOOL, arguments: '{}' },
        { type: 'finish', reason: 'tool_calls' },
      ]))
      .mockResolvedValueOnce(modelStream([
        {
          type: 'tool-call',
          callId: 'call-1',
          name: cloudTool.name,
          arguments: '{"query":"mira"}',
        },
        { type: 'finish', reason: 'tool_calls' },
      ]))
      .mockResolvedValueOnce(modelStream([
        { type: 'text-delta', delta: 'final answer' },
        { type: 'finish', reason: 'stop' },
      ]));

    const events = await drain(await new PiCoreAgentLoop(selected).run(
      [{ role: 'user', content: 'search' }],
      modelCall,
    ));

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool-result',
        name: cloudTool.name,
        content: 'cloud-result-host-a',
      }),
    ]));
    const firstRoundTools = modelCall.mock.calls[0][1] as OpenAiTool[];
    expect(firstRoundTools.map(tool => tool.function.name))
      .toEqual([localTool.name, DESKTOP_HOST_DISCOVERY_TOOL]);
    const secondRoundMessages = modelCall.mock.calls[2][0] as OpenAiMessage[];
    expect(secondRoundMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'tool',
        content: 'cloud-result-host-a',
        tool_call_id: 'call-1',
      }),
    ]));
    const secondRoundTools = modelCall.mock.calls[1][1] as OpenAiTool[];
    expect(secondRoundTools.map(item => item.function.name))
      .toContain(cloudTool.name);
    expect(fixture.sse.mock.calls[0][2]).toMatchObject({
      path: '/remote/v1/tool-invocations/stream',
      credential: '',
      body: { toolId: cloudTool.id, args: { query: 'mira' } },
    });
  });

  it('reuses the existing Mobile approval flow and exact Host invocation', async () => {
    const sse = jest.fn(<T>(
      _target: CloudRelayTransportTarget,
      _tickets: CloudRelayTicketProvider,
      _request: PostSseRequest<T>,
    ): PostSseSession<T> => ({
      events: (async function* () {
        yield {
          type: 'tool:approval_required',
          invocationId: 'inv-1',
          message: 'Run Desktop tool?',
          scope: 'terminal',
        } as unknown as T;
        yield {
          type: 'tool:complete',
          invocation: {
            invocationId: 'inv-1',
            toolId: cloudTool.id,
            status: 'awaiting_approval',
            approval: { message: 'Run Desktop tool?', scope: 'terminal' },
          },
        } as unknown as T;
      })(),
      abort: jest.fn(),
    }));
    const fixture = discoveryFixture({ sse });
    const selected = gateway(fixture);
    const requestApproval = jest.fn(async () => 'approved' as const);
    const modelCall = jest.fn()
      .mockResolvedValueOnce(modelStream([
        { type: 'tool-call', callId: 'discover-desktop',
          name: DESKTOP_HOST_DISCOVERY_TOOL, arguments: '{}' },
        { type: 'finish', reason: 'tool_calls' },
      ]))
      .mockResolvedValueOnce(modelStream([
        {
          type: 'tool-call',
          callId: 'call-approval',
          name: cloudTool.name,
          arguments: '{"query":"mira"}',
        },
        { type: 'finish', reason: 'tool_calls' },
      ]))
      .mockResolvedValueOnce(modelStream([
        { type: 'text-delta', delta: 'approved answer' },
        { type: 'finish', reason: 'stop' },
      ]));

    const events = await drain(await new PiCoreAgentLoop(selected).run(
      [{ role: 'user', content: 'search' }],
      modelCall,
      { requestApproval },
    ));

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'approval-required',
        invocationId: 'inv-1',
        name: cloudTool.name,
        scope: 'terminal',
      }),
      expect.objectContaining({
        type: 'tool-result',
        name: cloudTool.name,
        content: 'approved-result-host-a',
      }),
    ]));
    const approvalCalls = fixture.json.mock.calls.filter(
      ([, , request]) => request.path.endsWith('/approval'),
    );
    expect(approvalCalls).toHaveLength(1);
    expect(approvalCalls[0][2]).toMatchObject({
      method: 'POST',
      body: {
        decision: 'approved',
        toolId: cloudTool.id,
        args: { query: 'mira' },
      },
    });
  });
});

describe('LocalAgentToolGateway trusted MCP service slice', () => {
  const mcpService: ToolServiceDescriptor = {
    id: 'who-you',
    name: '狐邮 Who You',
    toolNames: ['whoyou_mail_search', 'whoyou_mail_message_get'],
    capabilities: [{
      id: 'who-you.mail.read',
      name: 'Mail search and reading',
      toolNames: ['whoyou_mail_search', 'whoyou_mail_message_get'],
    }],
  };
  const mcpTools: ToolManifest[] = [
    {
      name: 'whoyou_mail_search',
      description: 'Real MCP search schema',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        additionalProperties: false,
      },
      sensitiveResult: 'mail-search',
    },
    {
      name: 'whoyou_mail_message_get',
      description: 'Real MCP message schema',
      parameters: {
        type: 'object',
        properties: { messageId: { type: 'string' } },
        required: ['messageId'],
        additionalProperties: false,
      },
      sensitiveResult: 'mail-body',
    },
  ];
  const approval: ToolApprovalRequest = {
    invocationId: 'mcp-approval-1',
    callId: 'mail-call-1',
    name: 'whoyou_mail_search',
    arguments: '{"query":"mira"}',
    message: 'send mail metadata to the model',
  };

  const mcpLocal = (): ToolGatewayClient => ({
    listTools: jest.fn(async () => [localTool, ...mcpTools]),
    callTool: jest.fn(async (request) => {
      if (request.name === 'whoyou_mail_search') {
        throw new ToolApprovalRequiredError(approval);
      }
      return { content: 'local-result' };
    }),
    resolveApproval: jest.fn(async (): Promise<ToolApprovalResolution> => ({
      status: 'completed',
      result: { content: 'approved-mail' },
    })),
  });

  const mcpDiscovery = (
    snapshot: Awaited<ReturnType<WhoYouMcpServiceDiscovery['discover']>>,
  ): WhoYouMcpServiceDiscovery => ({
    discover: jest.fn(async () => snapshot),
  });

  it('defers the real mail schemas, discloses them, and reuses the existing approval path', async () => {
    let current = true;
    const local = mcpLocal();
    const selected = gateway(discoveryFixture(), {
      local,
      mcp: mcpDiscovery({
        service: mcpService,
        tools: mcpTools,
        catalogRevision: 'mcp-rev-1',
        degradation: 'none',
        accountId: 'account-a',
        initialToolNames: [],
        expiresAt: Date.now() + 60_000,
        assertCurrent: () => {
          if (!current) throw new Error('account changed');
        },
      }),
    });

    const discovered = await selected.discoverTools?.();
    expect(discovered?.catalogRevision).toBe('mcp-rev-1');
    expect(discovered?.notices).toEqual([]);
    // Static mail schemas are replaced by the deferred MCP service; no shadow
    // duplicate remains visible in the local service.
    expect(discovered?.tools.map((tool) => tool.name)).toEqual([
      'local_weather_current',
      DESKTOP_HOST_DISCOVERY_TOOL,
    ]);
    expect(discovered?.services?.[0].toolNames).toEqual([
      'local_weather_current',
      DESKTOP_HOST_DISCOVERY_TOOL,
    ]);
    expect(discovered?.services?.[1]).toEqual(mcpService);

    const disclosed = await selected.discloseTools?.({
      serviceId: 'who-you',
      capabilityId: 'who-you.mail.read',
      catalogRevision: 'mcp-rev-1',
    });
    expect(disclosed?.tools.map((tool) => tool.name)).toEqual([
      'whoyou_mail_search',
      'whoyou_mail_message_get',
    ]);
    expect(disclosed?.tools[0].parameters).toEqual(mcpTools[0].parameters);
    expect(disclosed?.tools[1].parameters).toEqual(mcpTools[1].parameters);
    expect(disclosed?.catalogRevision).toBe('mcp-rev-1');

    await expect(selected.discloseTools?.({
      serviceId: 'who-you',
      capabilityId: 'who-you.mail.read',
      catalogRevision: 'stale',
    })).rejects.toMatchObject({ code: 'TOOL_DISCLOSURE_STALE' });

    await expect(selected.callTool({
      callId: 'mail-call-1',
      name: 'whoyou_mail_search',
      arguments: '{"query":"mira"}',
    })).rejects.toBeInstanceOf(ToolApprovalRequiredError);
    await expect(selected.resolveApproval?.(approval, 'approved')).resolves.toEqual({
      status: 'completed',
      result: { content: 'approved-mail' },
    });

    current = false;
    await expect(selected.callTool({
      callId: 'mail-call-2',
      name: 'whoyou_mail_search',
      arguments: '{"query":"mira"}',
    })).rejects.toThrow('account changed');
  });

  it('degrades to the compiled-in static read tools when the binding is unavailable', async () => {
    const selected = gateway(discoveryFixture(), {
      local: mcpLocal(),
      mcp: {
        discover: jest.fn(async () => {
          throw new WhoYouError('session_rejected', 'signed out');
        }),
      },
    });
    const discovered = await selected.discoverTools?.();
    expect(discovered?.notices).toEqual([]);
    expect(discovered?.tools.map((tool) => tool.name)).toEqual([
      'local_weather_current',
      'whoyou_mail_search',
      'whoyou_mail_message_get',
      DESKTOP_HOST_DISCOVERY_TOOL,
    ]);
    expect(discovered?.services?.[0].toolNames).toContain('whoyou_mail_search');
  });

  it('runs the complete read-only Who You chain through real Pi Core and the existing approval flow', async () => {
    const local: ToolGatewayClient = {
      listTools: jest.fn(async () => [localTool, ...mcpTools]),
      callTool: jest.fn(async (request) => {
        if (request.name === 'whoyou_mail_search' ||
            request.name === 'whoyou_mail_message_get') {
          throw new ToolApprovalRequiredError({
            invocationId: 'inv-' + request.name,
            callId: request.callId,
            name: request.name,
            arguments: request.arguments,
            message: 'send mail data to the current model',
          });
        }
        return { content: 'local-result' };
      }),
      resolveApproval: jest.fn(async (pending): Promise<ToolApprovalResolution> => ({
        status: 'completed',
        result: {
          content: pending.name === 'whoyou_mail_search'
            ? 'UNTRUSTED_EMAIL_CONTENT fixture search result'
            : 'UNTRUSTED_EMAIL_CONTENT fixture body result',
        },
      })),
    };
    const selected = gateway(discoveryFixture(), {
      local,
      mcp: mcpDiscovery({
        service: mcpService,
        tools: mcpTools,
        catalogRevision: 'mcp-rev-who-you',
        degradation: 'none',
        accountId: 'account-a',
        initialToolNames: ['whoyou_mail_search'],
        expiresAt: Date.now() + 60_000,
        assertCurrent: () => undefined,
      }),
    });

    const offered: string[][] = [];
    const modelCall = jest.fn(async (
      _messages: readonly OpenAiMessage[],
      tools: readonly OpenAiTool[],
    ) => {
      offered.push(tools.map((tool) => tool.function.name));
      if (offered.length === 1) {
        return asyncStream([
          { type: 'tool-call' as const, callId: 'disclose', name: TOOL_DISCLOSURE_TOOL,
            arguments: JSON.stringify({
              serviceId: 'who-you',
              capabilityId: 'who-you.mail.read',
            }) },
          { type: 'finish' as const, reason: 'tool_calls' },
        ]);
      }
      if (offered.length === 2) {
        return asyncStream([
          { type: 'tool-call' as const, callId: 'search', name: 'whoyou_mail_search',
            arguments: JSON.stringify({ query: 'mira' }) },
          { type: 'finish' as const, reason: 'tool_calls' },
        ]);
      }
      if (offered.length === 3) {
        return asyncStream([
          { type: 'tool-call' as const, callId: 'body',
            name: 'whoyou_mail_message_get',
            arguments: JSON.stringify({ messageId: 'msg-1' }) },
          { type: 'finish' as const, reason: 'tool_calls' },
        ]);
      }
      return asyncStream([
        { type: 'text-delta' as const, delta: 'mail summary ready' },
        { type: 'finish' as const, reason: 'stop' },
      ]);
    });

    const events = await drain(await new PiCoreAgentLoop(selected).run(
      [{ role: 'user', content: '搜索并阅读一封邮件' }],
      modelCall,
      { requestApproval: async () => 'approved' },
    ));

    expect(offered[0]).toEqual(expect.arrayContaining([
      'whoyou_mail_search',
      TOOL_DISCLOSURE_TOOL,
    ]));
    expect(offered[0]).not.toContain('whoyou_mail_message_get');
    expect(offered[1]).toEqual(expect.arrayContaining([
      'whoyou_mail_search',
      'whoyou_mail_message_get',
    ]));
    // After the search result only the body tool remains visible (MOB-086).
    expect(offered[2]).toEqual(['whoyou_mail_message_get']);
    expect(events.filter((event) => event.type === 'approval-required'))
      .toHaveLength(2);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool-result',
        name: 'whoyou_mail_search',
      }),
      expect.objectContaining({
        type: 'tool-result',
        name: 'whoyou_mail_message_get',
      }),
      { type: 'text-delta', delta: 'mail summary ready' },
    ]));
  });
});
