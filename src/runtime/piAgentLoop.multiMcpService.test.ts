import type { OpenAiMessage, OpenAiTool } from '../provider/openAiStandardClient';
import { PiCoreAgentLoop } from './piAgentLoop';
import {
  TOOL_DISCLOSURE_TOOL,
  ToolApprovalRequiredError,
  type ToolApprovalResolution,
  type ToolCallRequest,
  type ToolCallResult,
  type ToolGatewayClient,
  type ToolManifest,
} from '../tools/toolGatewayClient';
import {
  MCP_PROTOCOL_VERSION,
  McpProtocolClient,
  type McpToolDescriptor,
} from '../mcp/mcpProtocolClient';
import {
  SERVICE_CAPABILITIES_SCHEMA_VERSION,
  projectMcpService,
} from '../mcp/mcpServiceCapabilities';
import { McpServiceBinding } from '../mcp/mcpServiceBinding';
import { LocalAgentToolGateway } from '../tools/localAgentToolGateway';

const TOKEN = 'fixture-token';

interface FixtureCapability {
  id: string;
  access: 'read' | 'write' | 'send' | 'destructive';
  requiredScopes: string[];
  tools: string[];
}

interface FixtureService {
  id: string;
  name: string;
  serverName: string;
  tools: McpToolDescriptor[];
  capabilities: FixtureCapability[];
  grantScopes: string[];
  resultFor?: (name: string) => string;
}

const schema = (properties: Record<string, unknown> = {}) => ({
  type: 'object',
  properties,
  additionalProperties: false,
});

const capabilityResource = (fixture: FixtureService) => ({
  schema: SERVICE_CAPABILITIES_SCHEMA_VERSION,
  version: '1.0.0',
  service: {
    id: fixture.id,
    name: fixture.name,
    description: fixture.name + ' fixture',
    documentation: 'https://fixture.example.test',
    mcp: {
      serverName: fixture.serverName,
      serverVersion: '1.0.0',
      sdk: 'fixture-sdk',
      protocolVersions: [MCP_PROTOCOL_VERSION],
    },
  },
  capabilities: fixture.capabilities.map((capability) => ({
    id: capability.id,
    title: capability.id,
    description: capability.id + ' description',
    access: capability.access,
    requiredScopes: capability.requiredScopes,
    confirmation: capability.access === 'read' ? 'none' : 'confirm-argument',
    tools: capability.tools,
  })),
  fallback: {
    unknownSchema: 'ignore',
    unclassifiedTools: 'keep real tools',
  },
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const rpc = (id: unknown, result: unknown): Response =>
  json(200, { jsonrpc: '2.0', id, result });

interface FixtureRuntime {
  fixture: FixtureService;
  endpoint: string;
  fetch: jest.Mock;
  calls: string[];
  callArguments: Array<Record<string, unknown>>;
  assertCurrent: () => void;
}

const startFixture = (fixture: FixtureService): FixtureRuntime => {
  const endpoint = `https://${fixture.id}.fixture.example.test/mcp`;
  const calls: string[] = [];
  const callArguments: Array<Record<string, unknown>> = [];
  const resourceUri = `mira://service/${fixture.id}/capabilities`;
  const fetchImpl = jest.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (url !== endpoint) throw new Error('unexpected URL ' + url);
    const body = JSON.parse(String(init?.body)) as {
      id?: number;
      method: string;
      params?: { name?: string; uri?: string; arguments?: Record<string, unknown> };
    };
    if (body.method === 'initialize') {
      return rpc(body.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: fixture.serverName, version: '1.0.0' },
      });
    }
    if (body.method === 'notifications/initialized') {
      return new Response(null, { status: 202 });
    }
    if (body.method === 'tools/list') return rpc(body.id, { tools: fixture.tools });
    if (body.method === 'resources/list') {
      return rpc(body.id, {
        resources: [{ uri: resourceUri, mimeType: 'application/json' }],
      });
    }
    if (body.method === 'resources/read') {
      return rpc(body.id, {
        contents: [{
          uri: resourceUri,
          mimeType: 'application/json',
          text: JSON.stringify(capabilityResource(fixture)),
        }],
      });
    }
    if (body.method === 'tools/call') {
      const name = body.params?.name ?? '';
      calls.push(name);
      callArguments.push(body.params?.arguments ?? {});
      return rpc(body.id, {
        content: [{
          type: 'text',
          text: fixture.resultFor?.(name) ?? `${fixture.id}:result:${name}`,
        }],
        structuredContent: {
          service: fixture.id,
          tool: name,
          arguments: body.params?.arguments,
        },
      });
    }
    return rpc(body.id, { isError: true });
  });
  return {
    fixture,
    endpoint,
    fetch: fetchImpl,
    calls,
    callArguments,
    assertCurrent: () => undefined,
  };
};

const execution = (
  runtime: FixtureRuntime,
  client: McpProtocolClient,
  protectedTools: ReadonlySet<string>,
): ToolGatewayClient => {
  const execute = async (request: ToolCallRequest): Promise<ToolCallResult> => {
    const result = await client.callTool(
      request.name,
      JSON.parse(request.arguments || '{}') as Record<string, unknown>,
    ) as { content: Array<{ text: string }> };
    return { content: result.content.map((block) => block.text).join('') };
  };
  return {
    listTools: async () => [],
    callTool: async (request) => {
      if (protectedTools.has(request.name)) {
        throw new ToolApprovalRequiredError({
          invocationId: `inv-${runtime.fixture.id}-${request.callId}`,
          callId: request.callId,
          name: request.name,
          arguments: request.arguments,
          message: `send ${runtime.fixture.id} result to the model`,
        });
      }
      return execute(request);
    },
    resolveApproval: async (approval): Promise<ToolApprovalResolution> => ({
      status: 'completed',
      result: await execute({
        callId: approval.callId,
        name: approval.name,
        arguments: approval.arguments,
      }),
    }),
  };
};

const snapshotFor = async (options: {
  runtime: FixtureRuntime;
  policy: {
    grantedScopes: string[];
    requiredScopes?: string[];
    permittedAccess: Array<'read' | 'write' | 'send' | 'destructive'>;
    permittedToolNames: string[];
    initialToolNames: string[];
    sensitiveResultFor?: (name: string) => ToolManifest['sensitiveResult'];
  };
  protectedTools?: ReadonlySet<string>;
}) => {
  const { runtime } = options;
  const client = new McpProtocolClient({
    endpoint: runtime.endpoint,
    token: TOKEN,
    fetchImpl: runtime.fetch as unknown as typeof fetch,
  });
  const serverInfo = await client.initialize();
  const toolDescriptors = await client.listTools();
  const resources = await client.listResources();
  const contents = await client.readResource(resources[0].uri);
  const projection = projectMcpService({
    serviceId: runtime.fixture.id,
    serviceName: runtime.fixture.name,
    toolDescriptors,
    capabilityResource: JSON.parse(contents[0].text),
    grantedScopes: options.policy.grantedScopes,
    ...(options.policy.requiredScopes
      ? { requiredScopes: options.policy.requiredScopes }
      : {}),
    permittedAccess: options.policy.permittedAccess,
    permittedToolNames: options.policy.permittedToolNames,
    ...(options.policy.sensitiveResultFor
      ? { sensitiveResultFor: options.policy.sensitiveResultFor }
      : {}),
    serverInfo,
  });
  return {
    ...projection,
    initialToolNames: options.policy.initialToolNames,
    expiresAt: Date.now() + 60_000,
    bindingKey: `${runtime.fixture.id}:account-a`,
    executionGateway: execution(
      runtime,
      client,
      options.protectedTools ?? new Set(),
    ),
    assertCurrent: runtime.assertCurrent,
  };
};

const localTool: ToolManifest = {
  name: 'web',
  description: 'Web page',
  parameters: { type: 'object' },
};

const localGateway = (): ToolGatewayClient => ({
  listTools: jest.fn(async () => [localTool]),
  callTool: jest.fn(async () => ({ content: 'local-result' })),
});

const asyncStream = <T>(events: T[]): AsyncIterable<T> =>
  (async function* () {
    for (const event of events) yield event;
  })();

const drain = async <T>(stream: AsyncIterable<T>): Promise<T[]> => {
  const events: T[] = [];
  for await (const event of stream) events.push(event);
  return events;
};

const toolCall = (callId: string, name: string, args: Record<string, unknown> = {}) => ({
  type: 'tool-call' as const,
  callId,
  name,
  arguments: JSON.stringify(args),
});
const text = (delta: string) => ({ type: 'text-delta' as const, delta });
const stop = () => ({ type: 'finish' as const, reason: 'stop' as const });
const toolCalls = () => ({ type: 'finish' as const, reason: 'tool_calls' as const });

const whoYouFixture: FixtureService = {
  id: 'who-you',
  name: 'Who You fixture',
  serverName: 'who-you-fixture-server',
  tools: [
    {
      name: 'whoyou_mail_search',
      description: 'Search protected mail',
      inputSchema: schema({
        query: { type: 'string' },
        cursor: { type: 'string' },
      }),
    },
    {
      name: 'whoyou_mail_message_get',
      description: 'Read protected mail body',
      inputSchema: schema({ messageId: { type: 'string' } }),
    },
    {
      name: 'whoyou_mail_send',
      description: 'Not permitted by Mobile policy',
      inputSchema: schema({ to: { type: 'string' } }),
    },
  ],
  capabilities: [
    {
      id: 'who-you.mail.read',
      access: 'read',
      requiredScopes: ['whoyou.read'],
      tools: ['whoyou_mail_search', 'whoyou_mail_message_get', 'whoyou_mail_send'],
    },
  ],
  grantScopes: ['whoyou.read'],
};

const neutralFixture: FixtureService = {
  id: 'neutral-lab',
  name: 'Neutral lab fixture',
  serverName: 'neutral-lab-server',
  tools: [
    {
      name: 'neutral_lookup',
      description: 'Look up a fixture item',
      inputSchema: schema({ query: { type: 'string' } }),
    },
    {
      name: 'neutral_note_write',
      description: 'Write a fixture note',
      inputSchema: schema({ value: { type: 'string' } }),
    },
    {
      name: 'neutral_unpermitted_delete',
      description: 'Not permitted by Mobile policy',
      inputSchema: schema(),
    },
  ],
  capabilities: [
    {
      id: 'neutral.read',
      access: 'read',
      requiredScopes: ['neutral.read'],
      tools: ['neutral_lookup'],
    },
    {
      id: 'neutral.write',
      access: 'write',
      requiredScopes: ['neutral.write'],
      tools: ['neutral_note_write', 'neutral_unpermitted_delete'],
    },
  ],
  grantScopes: ['neutral.read', 'neutral.write'],
};

describe('Pi Core over two independent MCP service bindings', () => {
  it('discloses and routes permitted tools from both services with the existing approval chain', async () => {
    const whoYou = startFixture(whoYouFixture);
    const neutral = startFixture(neutralFixture);
    const whoYouSnapshot = await snapshotFor({
      runtime: whoYou,
      policy: {
        grantedScopes: whoYouFixture.grantScopes,
        requiredScopes: ['whoyou.read'],
        permittedAccess: ['read'],
        permittedToolNames: ['whoyou_mail_search', 'whoyou_mail_message_get'],
        initialToolNames: ['whoyou_mail_search'],
        sensitiveResultFor: (name) => name === 'whoyou_mail_search'
          ? 'mail-search'
          : name === 'whoyou_mail_message_get' ? 'mail-body' : undefined,
      },
      protectedTools: new Set(['whoyou_mail_search', 'whoyou_mail_message_get']),
    });
    const neutralSnapshot = await snapshotFor({
      runtime: neutral,
      policy: {
        grantedScopes: neutralFixture.grantScopes,
        permittedAccess: ['read', 'write'],
        permittedToolNames: ['neutral_lookup', 'neutral_note_write'],
        initialToolNames: [],
      },
    });
    const whoYouDiscovery = {
      serviceTypeId: 'who-you',
      discover: jest.fn(async () => whoYouSnapshot),
    };
    const neutralDiscovery = {
      serviceTypeId: 'neutral-lab',
      discover: jest.fn(async () => neutralSnapshot),
    };
    const gateway = new LocalAgentToolGateway({
      local: localGateway(),
      mcp: [
        new McpServiceBinding({
          serviceTypeId: 'who-you',
          discovery: whoYouDiscovery,
          requiresCloudAccount: true,
        }),
        new McpServiceBinding({
          serviceTypeId: 'neutral-lab',
          discovery: neutralDiscovery,
        }),
      ],
      cloudContext: () => ({
        accountId: 'account-a',
        explicitlySignedOut: false,
        desktopMode: 'none',
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
          toolCall('disclose-neutral', TOOL_DISCLOSURE_TOOL, {
            serviceId: 'neutral-lab',
            toolNames: ['neutral_lookup', 'neutral_note_write'],
          }),
          toolCalls(),
        ]);
      }
      if (offered.length === 2) {
        return asyncStream([
          toolCall('neutral-read', 'neutral_lookup', { query: 'item' }),
          toolCall('neutral-write', 'neutral_note_write', { value: 'x' }),
          toolCalls(),
        ]);
      }
      if (offered.length === 3) {
        return asyncStream([
          toolCall('mail-search', 'whoyou_mail_search', { query: 'mira' }),
          toolCalls(),
        ]);
      }
      return asyncStream([text('two services complete'), stop()]);
    });
    const requestApproval = jest.fn(async () => 'approved' as const);

    const events = await drain(await new PiCoreAgentLoop(gateway).run(
      [{ role: 'user', content: 'search mail and use the lab service' }],
      modelCall,
      { requestApproval },
    ));

    expect(offered[0]).toEqual(expect.arrayContaining([
      'web',
      'whoyou_mail_search',
      TOOL_DISCLOSURE_TOOL,
    ]));
    expect(offered[0]).not.toContain('whoyou_mail_message_get');
    expect(offered[0]).not.toContain('neutral_lookup');
    expect(offered[0]).not.toContain('neutral_note_write');
    expect(offered[2]).toEqual(expect.arrayContaining([
      'neutral_lookup',
      'neutral_note_write',
    ]));
    expect(offered[2]).not.toContain('neutral_unpermitted_delete');
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.type === 'approval-required')).toHaveLength(1);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool-result',
        name: 'whoyou_mail_search',
        content: 'who-you:result:whoyou_mail_search',
      }),
      expect.objectContaining({
        type: 'tool-result',
        name: 'neutral_lookup',
        content: 'neutral-lab:result:neutral_lookup',
      }),
      expect.objectContaining({
        type: 'tool-result',
        name: 'neutral_note_write',
        content: 'neutral-lab:result:neutral_note_write',
      }),
      text('two services complete'),
    ]));
    // Calls stayed on their own authorized service; the unpermitted tool never
    // reached either fixture.
    expect(whoYou.calls).toEqual(['whoyou_mail_search']);
    expect(neutral.calls).toEqual(['neutral_lookup', 'neutral_note_write']);
    expect(whoYouDiscovery.discover).toHaveBeenCalledTimes(1);
    expect(neutralDiscovery.discover).toHaveBeenCalledTimes(1);

    const discovery = await gateway.discoverTools();
    expect(discovery.services?.map((service) => service.id)).toEqual([
      'mira-mobile-local',
      'neutral-lab',
      'who-you',
    ]);
    expect(discovery.services?.find((service) => service.id === 'neutral-lab')
      ?.capabilities?.map((capability) => capability.id))
      .toEqual(['neutral.read', 'neutral.write']);
  });

  it('lets mail data drive authorized cross-service calls and repeated searches in one run', async () => {
    const whoYou = startFixture({
      ...whoYouFixture,
      resultFor: (name) => name === 'whoyou_mail_search'
        ? JSON.stringify({ messages: [{ messageId: 'msg-42' }], nextCursor: 'cursor-2' })
        : name === 'whoyou_mail_message_get'
          ? JSON.stringify({ messageId: 'msg-42', body: 'fixture body' })
          : `who-you:result:${name}`,
    });
    const neutral = startFixture({
      ...neutralFixture,
      resultFor: (name) => name === 'neutral_lookup'
        ? 'workspace://fixture/item-42'
        : `neutral-lab:result:${name}`,
    });
    const whoYouSnapshot = await snapshotFor({
      runtime: whoYou,
      policy: {
        grantedScopes: whoYouFixture.grantScopes,
        requiredScopes: ['whoyou.read'],
        permittedAccess: ['read'],
        permittedToolNames: ['whoyou_mail_search', 'whoyou_mail_message_get'],
        initialToolNames: ['whoyou_mail_search', 'whoyou_mail_message_get'],
        sensitiveResultFor: (name) => name === 'whoyou_mail_search'
          ? 'mail-search'
          : name === 'whoyou_mail_message_get' ? 'mail-body' : undefined,
      },
      protectedTools: new Set(['whoyou_mail_search', 'whoyou_mail_message_get']),
    });
    const neutralSnapshot = await snapshotFor({
      runtime: neutral,
      policy: {
        grantedScopes: neutralFixture.grantScopes,
        permittedAccess: ['read', 'write'],
        permittedToolNames: ['neutral_lookup', 'neutral_note_write'],
        initialToolNames: ['neutral_lookup'],
      },
    });
    const gateway = new LocalAgentToolGateway({
      local: localGateway(),
      mcp: [
        new McpServiceBinding({
          serviceTypeId: 'who-you',
          discovery: {
            serviceTypeId: 'who-you',
            discover: async () => whoYouSnapshot,
          },
          requiresCloudAccount: true,
        }),
        new McpServiceBinding({
          serviceTypeId: 'neutral-lab',
          discovery: {
            serviceTypeId: 'neutral-lab',
            discover: async () => neutralSnapshot,
          },
        }),
      ],
      cloudContext: () => ({
        accountId: 'account-a',
        explicitlySignedOut: false,
        desktopMode: 'none',
      }),
    });

    const offered: string[][] = [];
    let nextCursor: string | undefined;
    let lookupResult = '';
    const lastToolResult = (messages: readonly OpenAiMessage[]): string =>
      [...messages].reverse().find(message => message.role === 'tool')?.content ?? '';
    const modelCall = jest.fn(async (
      messages: readonly OpenAiMessage[],
      tools: readonly OpenAiTool[],
    ) => {
      offered.push(tools.map((tool) => tool.function.name));
      const previous = lastToolResult(messages);
      if (offered.length === 1) {
        return asyncStream([
          toolCall('mail-search-1', 'whoyou_mail_search', { query: 'mira' }),
          toolCalls(),
        ]);
      }
      if (offered.length === 2) {
        const page = JSON.parse(previous) as {
          messages: Array<{ messageId: string }>;
          nextCursor: string;
        };
        nextCursor = page.nextCursor;
        return asyncStream([
          toolCall('mail-body', 'whoyou_mail_message_get', {
            messageId: page.messages[0].messageId,
          }),
          toolCalls(),
        ]);
      }
      if (offered.length === 3) {
        const body = JSON.parse(previous) as { body: string };
        return asyncStream([
          toolCall('neutral-lookup', 'neutral_lookup', { query: body.body }),
          toolCalls(),
        ]);
      }
      if (offered.length === 4) {
        lookupResult = previous;
        return asyncStream([
          toolCall('disclose-neutral-write', TOOL_DISCLOSURE_TOOL, {
            serviceId: 'neutral-lab',
            toolNames: ['neutral_note_write'],
          }),
          toolCalls(),
        ]);
      }
      if (offered.length === 5) {
        return asyncStream([
          toolCall('neutral-write', 'neutral_note_write', { value: lookupResult }),
          toolCalls(),
        ]);
      }
      if (offered.length === 6) {
        return asyncStream([
          toolCall('mail-search-2', 'whoyou_mail_search', {
            query: 'mira again',
            ...(nextCursor ? { cursor: nextCursor } : {}),
          }),
          toolCalls(),
        ]);
      }
      return asyncStream([text('mail and lab complete'), stop()]);
    });
    const requestApproval = jest.fn(async () => 'approved' as const);

    const events = await drain(await new PiCoreAgentLoop(gateway).run(
      [{ role: 'user', content: 'search mail, read it and use the lab service' }],
      modelCall,
      { requestApproval },
    ));

    // The authorized tool set never shrinks after a mail result; only the
    // model-requested schema disclosure adds the deferred write tool.
    expect(offered[0]).toEqual(expect.arrayContaining([
      'web',
      'whoyou_mail_search',
      'whoyou_mail_message_get',
      'neutral_lookup',
      TOOL_DISCLOSURE_TOOL,
    ]));
    expect(offered[0]).not.toContain('neutral_note_write');
    expect(offered[2]).toEqual(expect.arrayContaining([
      'whoyou_mail_search',
      'whoyou_mail_message_get',
      'neutral_lookup',
    ]));
    expect(offered[2]).not.toContain('neutral_note_write');
    expect(offered[3]).toEqual(expect.arrayContaining([
      'whoyou_mail_search',
      'whoyou_mail_message_get',
      'neutral_lookup',
    ]));
    expect(offered[4]).toEqual(expect.arrayContaining([
      'whoyou_mail_search',
      'whoyou_mail_message_get',
      'neutral_lookup',
      'neutral_note_write',
    ]));
    expect(offered[6]).toEqual(expect.arrayContaining([
      'whoyou_mail_search',
      'whoyou_mail_message_get',
      'neutral_lookup',
      'neutral_note_write',
    ]));

    expect(whoYou.calls).toEqual([
      'whoyou_mail_search',
      'whoyou_mail_message_get',
      'whoyou_mail_search',
    ]);
    expect(neutral.calls).toEqual(['neutral_lookup', 'neutral_note_write']);
    expect(whoYou.callArguments[1]).toEqual({ messageId: 'msg-42' });
    expect(neutral.callArguments[0]).toEqual({ query: 'fixture body' });
    expect(neutral.callArguments[1]).toEqual({ value: 'workspace://fixture/item-42' });
    expect(whoYou.callArguments[2]).toEqual({ query: 'mira again', cursor: 'cursor-2' });
    expect(requestApproval).toHaveBeenCalledTimes(3);
    expect(events.filter((event) => event.type === 'approval-required')).toHaveLength(3);
    expect(events.filter((event) => event.type === 'tool-result')).toHaveLength(6);
    expect(events).toContainEqual(text('mail and lab complete'));
    expect(events.at(-1)).toMatchObject({ type: 'finish', reason: 'stop' });
  });

  it('keeps ordinary local chat working when one binding cannot be discovered', async () => {
    const neutral = startFixture(neutralFixture);
    const neutralSnapshot = await snapshotFor({
      runtime: neutral,
      policy: {
        grantedScopes: neutralFixture.grantScopes,
        permittedAccess: ['read'],
        permittedToolNames: ['neutral_lookup'],
        initialToolNames: ['neutral_lookup'],
      },
    });
    const gateway = new LocalAgentToolGateway({
      local: localGateway(),
      mcp: [
        new McpServiceBinding({
          serviceTypeId: 'who-you',
          discovery: {
            serviceTypeId: 'who-you',
            discover: async () => {
              throw new Error('fixture service offline');
            },
          },
          requiresCloudAccount: true,
        }),
        new McpServiceBinding({
          serviceTypeId: 'neutral-lab',
          discovery: {
            serviceTypeId: 'neutral-lab',
            discover: async () => neutralSnapshot,
          },
        }),
      ],
      cloudContext: () => ({
        accountId: 'account-a',
        explicitlySignedOut: false,
        desktopMode: 'none',
      }),
    });

    const modelCall = jest.fn(async () =>
      asyncStream([
        text('ordinary chat remains available'),
        stop(),
      ]));
    const events = await drain(await new PiCoreAgentLoop(gateway).run(
      [{ role: 'user', content: 'hello' }],
      modelCall,
    ));
    expect(events).toEqual(expect.arrayContaining([
      text('ordinary chat remains available'),
    ]));
    const discovery = await gateway.discoverTools();
    expect(discovery.services?.map((service) => service.id)).toContain('neutral-lab');
    expect(discovery.services?.map((service) => service.id)).not.toContain('who-you');
    expect(discovery.notices).toEqual(expect.arrayContaining([
      { code: 'mcp-service-degraded' },
    ]));
  });
});
