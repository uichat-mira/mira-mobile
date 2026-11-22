import {
  requestCloudRelayJson,
  type CloudRelayTicketProvider,
  type CloudRelayTransportTarget,
} from '../api/cloudRelay';
import { RemoteHostError, type RemoteJsonRequest } from '../api/remoteHttp';
import type { PostSseRequest, PostSseSession } from '../api/postSse';
import type { CloudRelayAccess } from '../cloud/cloudRelayEntry';
import type { RemoteDeviceScope } from '../protocol/remoteHostV1';
import type { RuntimeEvent } from '../runtime/conversationRuntime';
import { MobileAgentLoop } from '../runtime/mobileAgentLoop';
import type { OpenAiMessage, OpenAiTool } from '../provider/openAiStandardClient';
import {
  LocalAgentToolGateway,
  type CloudToolAccountContext,
} from './localAgentToolGateway';
import type {
  ToolGatewayClient,
  ToolManifest,
} from './toolGatewayClient';

const localTool: ToolManifest = {
  name: 'local_weather_current',
  description: 'Local weather',
  parameters: { type: 'object' },
};

const cloudTool = {
  id: 'mcp:server-1:tool:search',
  name: 'mcp_server_1_tool_search_a1b2c3d4e5',
  description: 'Search',
  parameters: { type: 'object' },
  destructive: false,
  requiresApproval: false,
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

const discoveryFixture = (options: {
  access?: CloudRelayAccess;
  scopes?: RemoteDeviceScope[];
  discoveryError?: unknown;
  sse?: jest.Mock;
} = {}) => {
  const access = options.access ?? makeAccess();
  const entry = {
    discoverSingleHost: jest.fn(async () => {
      if (options.discoveryError) throw options.discoveryError;
      return access;
    }),
    assertCurrentAccess: jest.fn((seen: CloudRelayAccess) => {
      if (seen !== access) {
        throw new RemoteHostError(
          'CLOUD_RELAY_SESSION_REJECTED',
          'stale Cloud session',
        );
      }
    }),
    reset: jest.fn(),
  };
  const jsonImpl = async function <T>(
    _target: CloudRelayTransportTarget,
    _tickets: CloudRelayTicketProvider,
    request: RemoteJsonRequest<T>,
  ): Promise<T> {
    if (request.path === '/remote/v1/manifest') {
      return request.parse(manifest(options.scopes));
    }
    if (request.path === '/remote/v1/tools') return request.parse([cloudTool]);
    if (request.path.endsWith('/approval')) {
      return request.parse({
        invocationId: 'inv-1',
        toolId: cloudTool.id,
        status: 'completed',
        content: 'approved-result',
      });
    }
    throw new Error('Unexpected Cloud tool path ' + request.path);
  };
  const json = jest.fn(jsonImpl);
  const sseImpl = function <T>(
    _target: CloudRelayTransportTarget,
    _tickets: CloudRelayTicketProvider,
    _request: PostSseRequest<T>,
  ) {
    return {
    events: (async function* () {
      yield {
        type: 'tool:start',
        invocationId: 'inv-1',
        toolId: cloudTool.id,
      } as unknown as T;
      yield {
        type: 'tool:complete',
        invocation: {
          invocationId: 'inv-1',
          toolId: cloudTool.id,
          status: 'completed',
          content: 'cloud-result',
        },
      } as unknown as T;
    })(),
    abort: jest.fn(),
    };
  };
  const sse = options.sse ?? jest.fn(sseImpl);
  return { access, entry, json, sse };
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
    expect(fixture.entry.discoverSingleHost).not.toHaveBeenCalled();
  });

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

  it('reports no online Host, multiple online Hosts, and missing grant separately', async () => {
    const noHost = gateway(discoveryFixture({
      discoveryError: new RemoteHostError('CLOUD_RELAY_HOST_NOT_FOUND', 'none'),
    }));
    await expect(noHost.discoverTools()).resolves.toMatchObject({
      tools: [localTool],
      notices: [{ code: 'cloud-tools-unavailable' }],
    });

    const ambiguous = gateway(discoveryFixture({
      discoveryError: new RemoteHostError(
        'CLOUD_RELAY_HOST_AMBIGUOUS',
        'two online hosts',
      ),
    }));
    await expect(ambiguous.discoverTools()).resolves.toMatchObject({
      tools: [localTool],
      notices: [{ code: 'cloud-tools-host-ambiguous' }],
    });

    const unauthorized = gateway(discoveryFixture({
      scopes: ['tools:invoke', 'tools:approve', 'tools:control'],
    }));
    await expect(unauthorized.discoverTools()).resolves.toMatchObject({
      tools: [localTool],
      notices: [{ code: 'cloud-tools-unauthorized' }],
    });
  });

  it('does not reuse a Host/tool id from a previous run after Host changes', async () => {
    const firstAccess = makeAccess('host-a');
    const secondAccess = makeAccess('host-b');
    const entry = {
      discoverSingleHost: jest.fn()
        .mockResolvedValueOnce(firstAccess)
        .mockResolvedValueOnce(firstAccess)
        .mockResolvedValue(secondAccess),
      assertCurrentAccess: jest.fn((seen: CloudRelayAccess) => {
        if (seen !== firstAccess && seen !== secondAccess) {
          throw new RemoteHostError('CLOUD_RELAY_SESSION_REJECTED', 'stale');
        }
      }),
      reset: jest.fn(),
    };
    const fixture = discoveryFixture();
    const firstRun = new LocalAgentToolGateway({
      local: localGateway(),
      paired: pairedGateway(),
      entry,
      cloudContext: cloudContext({ accountId: 'account-a', explicitlySignedOut: false }),
      json: fixture.json as unknown as typeof requestCloudRelayJson,
      sse: fixture.sse as unknown as typeof import('../api/cloudRelay').openCloudRelayPostSse,
    });
    await expect(firstRun.discoverTools()).resolves.toMatchObject({
      tools: [localTool, expect.objectContaining({ name: cloudTool.name })],
    });

    const secondRun = new LocalAgentToolGateway({
      local: localGateway(),
      paired: pairedGateway(),
      entry,
      cloudContext: cloudContext({ accountId: 'account-a', explicitlySignedOut: false }),
      json: fixture.json as unknown as typeof requestCloudRelayJson,
      sse: fixture.sse as unknown as typeof import('../api/cloudRelay').openCloudRelayPostSse,
    });
    await expect(secondRun.discoverTools()).resolves.toMatchObject({
      tools: [localTool, expect.objectContaining({ name: cloudTool.name })],
    });
    await expect(firstRun.callTool({
      callId: 'call-stale',
      name: cloudTool.name,
      arguments: '{}',
    })).rejects.toMatchObject({ code: 'CLOUD_TOOL_HOST_CHANGED' });
  });
});

describe('Cloud Local Agent joint entry', () => {
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
        content: 'cloud-result',
      }),
    ]));
    const secondRoundMessages = modelCall.mock.calls[1][0] as OpenAiMessage[];
    expect(secondRoundMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'tool',
        content: 'cloud-result',
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
        content: 'approved-result',
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
