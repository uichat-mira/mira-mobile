import type { OpenAiMessage, OpenAiTool } from '../provider/openAiStandardClient';
import { PiCoreAgentLoop } from './piAgentLoop';
import type { RuntimeEvent } from './conversationRuntime';
import {
  TOOL_DISCLOSURE_TOOL,
  ToolGatewayError,
  type ToolCallRequest,
  type ToolCallResult,
} from '../tools/toolGatewayClient';
import {
  McpProtocolClient,
  MCP_PROTOCOL_VERSION,
} from '../mcp/mcpProtocolClient';
import {
  SERVICE_CAPABILITIES_SCHEMA_VERSION,
  projectMcpService,
} from '../mcp/mcpServiceCapabilities';
import { McpServiceToolGateway } from '../tools/mcpServiceToolGateway';

const ENDPOINT = 'https://fixture-mcp.example.test/mcp';
const TOKEN = 'fixture-token';
const SERVICE_ID = 'fixture-svc';
const CAPABILITY_ID = 'fixture.read';

const schemaA = {
  type: 'object',
  properties: { query: { type: 'string' } },
  required: ['query'],
  additionalProperties: false,
};
const schemaB = {
  type: 'object',
  properties: { id: { type: 'string' } },
  additionalProperties: false,
};

const tools = [
  { name: 'fixture_read_a', description: 'Read A', inputSchema: schemaA },
  { name: 'fixture_read_b', description: 'Read B', inputSchema: schemaB },
  { name: 'fixture_unclassified_e', description: 'Read E', inputSchema: {} },
  {
    name: 'fixture_write_c',
    description: 'Write C',
    inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
  },
];

const resource = {
  schema: SERVICE_CAPABILITIES_SCHEMA_VERSION,
  version: '1.0.0',
  service: {
    id: SERVICE_ID,
    name: 'Fixture',
    description: 'Fixture service',
    documentation: 'https://example.test',
    mcp: {
      serverName: 'fixture-server',
      serverVersion: '1.0.0',
      sdk: '@modelcontextprotocol/server@2.4.0',
      protocolVersions: ['2025-06-18'],
    },
  },
  capabilities: [
    {
      id: CAPABILITY_ID,
      title: 'Read items',
      description: 'Reads fixture items',
      access: 'read',
      requiredScopes: ['fixture.read'],
      confirmation: 'none',
      tools: ['fixture_read_a', 'fixture_read_b'],
    },
    {
      id: 'fixture.write',
      title: 'Write items',
      description: 'Writes fixture items',
      access: 'write',
      requiredScopes: ['fixture.write'],
      confirmation: 'none',
      tools: ['fixture_write_c'],
    },
  ],
  fallback: {
    unknownSchema: 'Ignore this resource.',
    unclassifiedTools: 'Keep every tools/list entry visible.',
  },
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const rpc = (id: unknown, result: unknown): Response =>
  json(200, { jsonrpc: '2.0', id, result });

const fetchFixture = () =>
  jest.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (url !== ENDPOINT) throw new Error('unexpected URL ' + url);
    const body = JSON.parse(String(init?.body)) as {
      id?: number;
      method: string;
      params?: { name?: string; uri?: string; arguments?: Record<string, unknown> };
    };
    if (body.method === 'initialize') {
      return rpc(body.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'fixture-server', version: '1.0.0' },
      });
    }
    if (body.method === 'notifications/initialized') {
      return new Response(null, { status: 202 });
    }
    if (body.method === 'tools/list') return rpc(body.id, { tools });
    if (body.method === 'resources/list') {
      return rpc(body.id, {
        resources: [{
          uri: 'mira://service/fixture/capabilities',
          mimeType: 'application/json',
        }],
      });
    }
    if (body.method === 'resources/read') {
      return rpc(body.id, {
        contents: [{
          uri: 'mira://service/fixture/capabilities',
          mimeType: 'application/json',
          text: JSON.stringify(resource),
        }],
      });
    }
    if (body.method === 'tools/call') {
      return rpc(body.id, {
        content: [{ type: 'text', text: 'result:' + body.params?.name }],
        structuredContent: {
          name: body.params?.name,
          arguments: body.params?.arguments,
        },
      });
    }
    return rpc(body.id, { isError: true });
  });

const setupGateway = async (visibleTools?: 'all') => {
  const fetchImpl = fetchFixture();
  const client = new McpProtocolClient({
    endpoint: ENDPOINT,
    token: TOKEN,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  await client.initialize();
  const toolDescriptors = await client.listTools();
  const resources = await client.listResources();
  const contents = await client.readResource(resources[0].uri);
  const projection = projectMcpService({
    serviceId: SERVICE_ID,
    serviceName: 'Fixture',
    toolDescriptors,
    capabilityResource: JSON.parse(contents[0].text),
    grantedScopes: ['fixture.read'],
    requiredScope: 'fixture.read',
    permittedToolNames: [
      'fixture_read_a',
      'fixture_read_b',
    ],
  });
  let current = true;
  const callTool = jest.fn(async (
    request: ToolCallRequest,
  ): Promise<ToolCallResult> => {
    const result = await client.callTool(
      request.name,
      JSON.parse(request.arguments) as Record<string, unknown>,
    ) as { content: Array<{ text: string }> };
    return { content: result.content.map((block) => block.text).join('') };
  });
  const gateway = new McpServiceToolGateway({
    snapshot: {
      service: projection.service,
      tools: projection.tools,
      catalogRevision: projection.catalogRevision,
      ...(visibleTools === 'all' ? {} : { visibleTools: [] }),
      degradation: projection.degradation,
      assertCurrent: () => {
        if (!current) {
          throw new ToolGatewayError('MCP_SERVICE_UNAUTHORIZED', 'account changed');
        }
      },
    },
    executeTool: callTool,
  });
  return {
    gateway,
    callTool,
    projection,
    revoke: () => { current = false; },
  };
};

const collect = async (stream: AsyncIterable<RuntimeEvent>) => {
  const events: RuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
};

const toolCall = (callId: string, name: string, args: Record<string, unknown>) =>
  ({
    type: 'tool-call' as const,
    callId,
    name,
    arguments: JSON.stringify(args),
  });
const text = (delta: string) => ({ type: 'text-delta' as const, delta });
const stop = () => ({ type: 'finish' as const, reason: 'stop' as const });
const toolsCall = () => ({ type: 'finish' as const, reason: 'tool_calls' as const });

describe('Pi Core real run over a trusted MCP service', () => {
  it('uses a known permitted tool directly without any disclosure round', async () => {
    const { gateway, callTool } = await setupGateway('all');
    const offered: string[][] = [];
    const modelCall = jest.fn(async (
      _messages: readonly OpenAiMessage[],
      offeredTools: readonly OpenAiTool[],
    ) => {
      offered.push(offeredTools.map((entry) => entry.function.name));
      if (offered.length === 1) {
        return (async function* () {
          yield toolCall('direct-1', 'fixture_read_a', { query: 'mira' });
          yield toolsCall();
        })();
      }
      return (async function* () {
        yield text('direct done');
        yield stop();
      })();
    });
    gateway.discloseTools = jest.fn(gateway.discloseTools);

    const events = await collect(await new PiCoreAgentLoop(gateway).run(
      [{ role: 'user', content: 'use known read tool' }],
      modelCall,
    ));

    expect(offered).toEqual([[
      'fixture_read_a',
      'fixture_read_b',
    ], [
      'fixture_read_a',
      'fixture_read_b',
    ]]);
    expect(gateway.discloseTools).not.toHaveBeenCalled();
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool-result',
        name: 'fixture_read_a',
        content: 'result:fixture_read_a',
      }),
      { type: 'text-delta', delta: 'direct done' },
    ]));
  });

  it('discloses the real capability schema once, reuses two tools and continues the task', async () => {
    const { gateway, callTool } = await setupGateway();
    const offered: OpenAiTool[][] = [];
    const modelCall = jest.fn(async (
      _messages: readonly OpenAiMessage[],
      offeredTools: readonly OpenAiTool[],
    ) => {
      offered.push([...offeredTools]);
      if (offered.length === 1) {
        return (async function* () {
          yield toolCall('disclose-1', TOOL_DISCLOSURE_TOOL, {
            serviceId: SERVICE_ID,
            capabilityId: CAPABILITY_ID,
          });
          yield toolsCall();
        })();
      }
      if (offered.length === 2) {
        return (async function* () {
          yield toolCall('read-a', 'fixture_read_a', { query: 'mira' });
          yield toolCall('read-b', 'fixture_read_b', { id: 'item-1' });
          yield toolsCall();
        })();
      }
      return (async function* () {
        yield text('read both');
        yield stop();
      })();
    });

    const events = await collect(await new PiCoreAgentLoop(gateway).run(
      [{ role: 'user', content: 'read two things' }],
      modelCall,
    ));

    expect(offered[0].map((entry) => entry.function.name))
      .toEqual([TOOL_DISCLOSURE_TOOL]);
    expect(offered[1].map((entry) => entry.function.name))
      .toEqual(['fixture_read_a', 'fixture_read_b']);
    expect(offered[1][0].function.parameters).toEqual(schemaA);
    expect(offered[1][1].function.parameters).toEqual(schemaB);
    // Same capability reuse: no second discovery round for the second tool.
    expect(offered[2].map((entry) => entry.function.name))
      .toEqual(['fixture_read_a', 'fixture_read_b']);
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(callTool.mock.calls.map((call) => call[0].name))
      .toEqual(['fixture_read_a', 'fixture_read_b']);
    expect(events).toEqual(expect.arrayContaining([
      { type: 'text-delta', delta: 'read both' },
    ]));
  });

  it('never advertises an undeclared write tool and rejects a stale catalog revision', async () => {
    const { gateway, callTool, revoke } = await setupGateway();
    const explained = await gateway.discloseTools({
      serviceId: SERVICE_ID,
      capabilityId: CAPABILITY_ID,
      catalogRevision: 'stale-revision',
    }).catch((error: unknown) => error);
    expect(explained).toMatchObject({ code: 'TOOL_DISCLOSURE_STALE' });

    await expect(gateway.callTool({
      callId: 'write-1',
      name: 'fixture_write_c',
      arguments: '{"value":"x"}',
    })).rejects.toMatchObject({ code: 'TOOL_NOT_DECLARED' });
    expect(callTool).not.toHaveBeenCalled();

    const all = await gateway.discoverTools();
    expect(all.services?.[0].capabilities?.flatMap((cap) => cap.toolNames))
      .not.toContain('fixture_write_c');

    revoke();
    await expect(gateway.callTool({
      callId: 'read-late',
      name: 'fixture_read_a',
      arguments: '{}',
    })).rejects.toMatchObject({ code: 'MCP_SERVICE_UNAUTHORIZED' });
  });
});
