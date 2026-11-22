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
import { MobileAgentLoop } from '../runtime/mobileAgentLoop';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import type { OpenAiMessage, OpenAiTool } from '../provider/openAiStandardClient';
import {
  LocalAgentToolGateway,
  type CloudToolAccountContext,
} from './localAgentToolGateway';
import { DESKTOP_HOST_DISCOVERY_TOOL } from './toolGatewayClient';
import type {
  ToolGatewayClient,
  ToolManifest,
} from './toolGatewayClient';

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

  it('keeps local tools and never falls back to paired credentials when Cloud is signed in', async () => {
    const fixture = discoveryFixture();
    const paired = pairedGateway();
    const selected = gateway(fixture, { paired });

    await expect(selected.discoverTools()).resolves.toMatchObject({
      tools: [
        localTool,
        {
          name: cloudTool.name,
          description: cloudTool.description,
        },
      ],
      notices: [],
    });
    expect(paired.listTools).not.toHaveBeenCalled();
  });

  it('reports no Host, offline Hosts, ambiguity, and missing grant separately', async () => {
    const noHost = gateway(discoveryFixture({ hosts: [] }));
    await expect(noHost.discoverTools()).resolves.toMatchObject({
      tools: [localTool],
      notices: [{ code: 'cloud-tools-unavailable' }],
    });

    const offline = gateway(discoveryFixture({
      hosts: [{ host: { ...hostA, availability: 'offline' } }],
    }));
    await expect(offline.discoverTools()).resolves.toMatchObject({
      tools: [localTool],
      notices: [{ code: 'cloud-tools-unavailable' }],
    });

    const ambiguous = gateway(discoveryFixture({
      hosts: [{ host: hostA }, { host: hostB }],
    }));
    await expect(ambiguous.discoverTools()).resolves.toMatchObject({
      tools: [localTool, expect.objectContaining({
        name: DESKTOP_HOST_DISCOVERY_TOOL,
      })],
      notices: [],
      hostCandidates: [
        { hostId: 'host-a', name: 'MacBook Pro', toolNames: [cloudTool.name] },
        { hostId: 'host-b', name: 'Office PC', toolNames: [cloudTool.name] },
      ],
    });

    const unauthorized = gateway(discoveryFixture({
      hosts: [{
        host: hostA,
        scopes: ['tools:read', 'tools:approve', 'tools:control'],
      }],
    }));
    await expect(unauthorized.discoverTools()).resolves.toMatchObject({
      tools: [localTool],
      notices: [{ code: 'cloud-tools-unauthorized' }],
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
      return modelStream([{ type: 'finish', reason: 'stop' }]);
    });
    const events = await drain(await new MobileAgentLoop(selected).run(
      [{ role: 'user', content: 'Use Desktop search' }],
      modelCall,
    ));
    expect(offeredTools[0]?.map(tool => tool.function.name)).toEqual([localTool.name]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'notice', code: 'cloud-tools-unauthorized' }),
    ]));
    expect(fixture.sse).not.toHaveBeenCalled();
  });

  it('separates invalid Cloud sessions, offline Hosts and protocol errors', async () => {
    const session = gateway(discoveryFixture({
      listError: new RemoteHostError('CLOUD_RELAY_SESSION_REJECTED', 'expired'),
    }));
    await expect(session.discoverTools()).resolves.toMatchObject({
      tools: [localTool],
      notices: [{ code: 'cloud-tools-session-invalid' }],
    });

    const notFound = gateway(discoveryFixture({
      listError: new RemoteHostError('CLOUD_RELAY_HOST_NOT_FOUND', 'none'),
    }));
    await expect(notFound.discoverTools()).resolves.toMatchObject({
      tools: [localTool],
      notices: [{ code: 'cloud-tools-unavailable' }],
    });

    const malformed = gateway(discoveryFixture({
      listError: new RemoteHostError('CLOUD_RELAY_INVALID_RESPONSE', 'malformed'),
    }));
    await expect(malformed.discoverTools()).rejects.toMatchObject({
      code: 'CLOUD_RELAY_INVALID_RESPONSE',
    });

    const brokenRelay = gateway(discoveryFixture({
      listError: new RemoteHostError('RELAY_PROTOCOL_ERROR', 'invalid frame'),
    }));
    await expect(brokenRelay.discoverTools()).rejects.toMatchObject({
      code: 'RELAY_PROTOCOL_ERROR',
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
    const firstRun = gateway(fixture, { selectionText: '用 MacBook Pro 搜索' });
    await expect(firstRun.discoverTools()).resolves.toMatchObject({
      tools: [localTool, expect.objectContaining({ name: sharedToolName })],
    });
    await firstRun.callTool({
      callId: 'call-a',
      name: sharedToolName,
      arguments: '{"query":"a"}',
    });
    expect(fixture.sse.mock.calls[0][2]).toMatchObject({
      body: { toolId: cloudTool.id },
    });

    const secondRun = gateway(fixture, { selectionText: 'Office PC 上搜索' });
    await expect(secondRun.discoverTools()).resolves.toMatchObject({
      tools: [localTool, expect.objectContaining({ name: sharedToolName })],
    });
    await secondRun.callTool({
      callId: 'call-b',
      name: sharedToolName,
      arguments: '{"query":"b"}',
    });
    expect(fixture.sse.mock.calls[1][2]).toMatchObject({
      body: { toolId: cloudToolB.id },
    });

    mutableHostA.availability = 'offline';
    await expect(firstRun.callTool({
      callId: 'call-stale',
      name: sharedToolName,
      arguments: '{}',
    })).rejects.toMatchObject({ code: 'CLOUD_RELAY_HOST_OFFLINE' });
  });
});

describe('Cloud Local Agent authority changes', () => {
  it('stops a run when the selected Host loses its tool grant', async () => {
    const setup: HostSetup = { host: hostA, tools: [cloudTool] };
    const fixture = discoveryFixture({ hosts: [setup] });
    const selected = gateway(fixture);
    await expect(selected.discoverTools()).resolves.toMatchObject({
      tools: [localTool, expect.objectContaining({ name: sharedToolName })],
    });
    await expect(selected.callTool({
      callId: 'call-allowed',
      name: sharedToolName,
      arguments: '{}',
    })).resolves.toEqual({ content: 'cloud-result-host-a' });

    setup.scopes = ['tools:read'];
    await expect(selected.callTool({
      callId: 'call-degraded',
      name: sharedToolName,
      arguments: '{}',
    })).rejects.toMatchObject({ code: 'CLOUD_TOOL_GRANT_REQUIRED' });
  });

  it('stops a run when the Cloud account switches', async () => {
    const fixture = discoveryFixture();
    let context: CloudToolAccountContext = {
      accountId: 'account-a',
      explicitlySignedOut: false,
    };
    const selected = new LocalAgentToolGateway({
      local: localGateway(),
      paired: pairedGateway(),
      entry: fixture.entry,
      cloudContext: () => context,
      json: fixture.json as unknown as typeof requestCloudRelayJson,
      sse: fixture.sse as unknown as typeof import('../api/cloudRelay').openCloudRelayPostSse,
    });
    await expect(selected.discoverTools()).resolves.toMatchObject({
      tools: [localTool, expect.objectContaining({ name: sharedToolName })],
    });

    context = { accountId: 'account-b', explicitlySignedOut: false };
    await expect(selected.callTool({
      callId: 'call-switched',
      name: sharedToolName,
      arguments: '{}',
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
    const clarification = await drain(await new MobileAgentLoop(
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

    const selected = gateway(fixture, { selectionText: '用 Office PC 搜索' });
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
    const events = await drain(await new MobileAgentLoop(selected).run(
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
    const events = await drain(await new MobileAgentLoop(gateway(fixture)).run(
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
    const weatherEvents = await drain(await new MobileAgentLoop(gateway(fixture)).run(
      [{ role: 'user', content: '查天气' }], weather,
    ));
    expect(weatherEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool-result',
        name: localTool.name, content: 'local-result' }),
    ]));
    expect(fixture.sse).not.toHaveBeenCalled();
  });

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
    const clarification = await drain(await new MobileAgentLoop(offered).run(
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

    const selected = gateway(fixture, { selectionText: 'Office PC' });
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
    const events = await drain(await new MobileAgentLoop(selected).run(
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

    const ambiguous = await gateway(fixture).discoverTools();
    expect(ambiguous.hostCandidates?.map(candidate => candidate.hostId))
      .toEqual(['host-aaaa', 'host-bbbb']);

    const selected = gateway(fixture, { selectionText: '使用 host-bbbb' });
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

  it('runs MobileAgentLoop through the real Cloud adapter and existing RemoteToolGatewayClient', async () => {
    const fixture = discoveryFixture();
    const selected = gateway(fixture);
    const modelCall = jest.fn()
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

    const events = await drain(await new MobileAgentLoop(selected).run(
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
    const secondRoundMessages = modelCall.mock.calls[1][0] as OpenAiMessage[];
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

    const events = await drain(await new MobileAgentLoop(selected).run(
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
