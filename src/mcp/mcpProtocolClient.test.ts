import {
  MCP_PROTOCOL_VERSION,
  McpProtocolClient,
  McpProtocolError,
} from './mcpProtocolClient';

const ENDPOINT = 'https://mcp.example.test/mcp';
const TOKEN = 'fixture-read-token';
const RESOURCE_URI = 'mira://service/fixture/capabilities';

interface FixtureTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

const tools: FixtureTool[] = [
  {
    name: 'fixture_read_a',
    description: 'Read A',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'fixture_read_b',
    description: 'Read B',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
  },
  {
    name: 'fixture_read_c',
    description: 'Read C',
    inputSchema: { type: 'object', properties: {} },
  },
];

interface RpcBody {
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const rpc = (id: unknown, result: Record<string, unknown>): Response =>
  json(200, { jsonrpc: '2.0', id, result: { resultType: 'complete', ...result } });

const rpcError = (id: unknown, code: number, data?: unknown): Response =>
  json(200, {
    jsonrpc: '2.0',
    id,
    error: { code, message: 'no', ...(data !== undefined ? { data } : {}) },
  });

const discoveryResult = (supportedVersions: string[] = [MCP_PROTOCOL_VERSION]) => ({
  supportedVersions,
  capabilities: { tools: {}, resources: {} },
  _meta: {
    'io.modelcontextprotocol/serverInfo': {
      name: 'fixture-server',
      version: '1.2.3',
    },
  },
  ttlMs: 60_000,
  cacheScope: 'public',
});

const fixtureFetch = () =>
  jest.fn(async (_url: string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as RpcBody;
    if (body.method === 'server/discover') {
      return rpc(body.id, discoveryResult());
    }
    if (body.method === 'tools/list') {
      if (body.params?.cursor === 'page-2') {
        return rpc(body.id, { tools: [tools[2]] });
      }
      return rpc(body.id, {
        tools: [tools[0], tools[1]],
        nextCursor: 'page-2',
        ttlMs: 300_000,
        cacheScope: 'public',
      });
    }
    if (body.method === 'resources/list') {
      return rpc(body.id, {
        resources: [{
          uri: RESOURCE_URI,
          name: 'fixture-capabilities',
          mimeType: 'application/json',
        }],
        ttlMs: 300_000,
        cacheScope: 'public',
      });
    }
    if (body.method === 'resources/read') {
      return rpc(body.id, {
        contents: [{
          uri: RESOURCE_URI,
          mimeType: 'application/json',
          text: JSON.stringify({ schema: 'mira.service-capabilities/v1' }),
        }],
        ttlMs: 60_000,
        cacheScope: 'private',
      });
    }
    if (body.method === 'tools/call') {
      return rpc(body.id, {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: { name: body.params?.name },
      });
    }
    return rpcError(body.id, -32601);
  });

const client = (fetchImpl: typeof fetch) =>
  new McpProtocolClient({ endpoint: ENDPOINT, token: TOKEN, fetchImpl });

type Captured = [string, RequestInit & { redirect?: string }];

const captured = (fetchMock: jest.Mock): Captured[] =>
  fetchMock.mock.calls as unknown as Captured[];

const headersOf = (init: RequestInit): Record<string, string> =>
  init.headers as Record<string, string>;

const bodyOf = (init: RequestInit): RpcBody =>
  JSON.parse(String(init.body)) as RpcBody;

describe('generic MCP 2026-07-28 protocol client', () => {
  it('discovers, paginates and calls tools with stateless request metadata', async () => {
    const fetchMock = fixtureFetch();
    const api = client(fetchMock as unknown as typeof fetch);
    const info = await api.discover();
    expect(MCP_PROTOCOL_VERSION).toBe('2026-07-28');
    expect(info).toEqual({
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverName: 'fixture-server',
      serverVersion: '1.2.3',
      tools: true,
      resources: true,
    });
    const listed = await api.listTools();
    expect(listed.map((tool) => tool.name)).toEqual([
      'fixture_read_a',
      'fixture_read_b',
      'fixture_read_c',
    ]);
    expect(listed[0].inputSchema).toEqual(tools[0].inputSchema);
    const resources = await api.listResources();
    expect(resources).toEqual([{
      uri: RESOURCE_URI,
      name: 'fixture-capabilities',
      mimeType: 'application/json',
    }]);
    const contents = await api.readResource(resources[0].uri);
    expect(JSON.parse(contents[0].text)).toEqual({
      schema: 'mira.service-capabilities/v1',
    });
    const called = await api.callTool('fixture_read_a', { query: 'mira' });
    expect(called).toMatchObject({ structuredContent: { name: 'fixture_read_a' } });

    const calls = captured(fetchMock);
    expect(calls).toHaveLength(6);
    expect(calls.every(([url]) => url === ENDPOINT)).toBe(true);
    for (const [, init] of calls) {
      const body = bodyOf(init);
      const headers = headersOf(init);
      expect(init.redirect).toBe('error');
      expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(headers['MCP-Protocol-Version']).toBe(MCP_PROTOCOL_VERSION);
      expect(headers['Mcp-Method']).toBe(body.method);
      expect(body.params?._meta).toEqual({
        'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
        'io.modelcontextprotocol/clientInfo': {
          name: 'mira-mobile',
          version: '1',
        },
        'io.modelcontextprotocol/clientCapabilities': {},
      });
      expect(String(init.body)).not.toContain(TOKEN);
      expect(body.method).not.toBe('initialize');
      expect(body.method).not.toBe('notifications/initialized');
    }
    const methods = calls.map(([, init]) => bodyOf(init).method);
    expect(methods).toEqual([
      'server/discover',
      'tools/list',
      'tools/list',
      'resources/list',
      'resources/read',
      'tools/call',
    ]);
    expect(headersOf(calls[0][1])['Mcp-Name']).toBeUndefined();
    expect(headersOf(calls[4][1])['Mcp-Name']).toBe(RESOURCE_URI);
    expect(headersOf(calls[5][1])['Mcp-Name']).toBe('fixture_read_a');
  });

  it('encodes non-ASCII and whitespace-bearing Mcp-Name values', async () => {
    const fetchMock = fixtureFetch();
    const api = client(fetchMock as unknown as typeof fetch);
    const uri = 'mira://service/fixture/文件 name';
    await api.readResource(uri);
    const [, init] = captured(fetchMock)[0];
    const expected = `=?base64?${Buffer.from(uri, 'utf8').toString('base64')}?=`;
    expect(headersOf(init)['Mcp-Name']).toBe(expected);
  });

  it('rejects duplicate tools and servers without the 2026-07-28 revision', async () => {
    const duplicate = fixtureFetch();
    duplicate.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as RpcBody;
      if (body.method === 'server/discover') {
        return rpc(body.id, discoveryResult());
      }
      return rpc(body.id, { tools: [tools[0], tools[0]] });
    });
    await expect(client(duplicate as unknown as typeof fetch).listTools())
      .rejects.toMatchObject({ code: 'MCP_TOOL_DUPLICATE' });

    const unsupported = fixtureFetch();
    unsupported.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as RpcBody;
      return json(200, {
        jsonrpc: '2.0',
        id: body.id,
        result: {
          resultType: 'complete',
          supportedVersions: ['2025-11-25'],
          capabilities: {},
        },
      });
    });
    await expect(client(unsupported as unknown as typeof fetch).discover())
      .rejects.toMatchObject({
        kind: 'unsupported',
        code: 'MCP_PROTOCOL_UNSUPPORTED',
      });
  });

  it('rejects an initialize-only legacy server without trying its handshake', async () => {
    const legacy = jest.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as RpcBody;
      if (body.method === 'initialize') {
        return rpc(body.id, {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
        });
      }
      if (body.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }
      return rpcError(body.id, -32601);
    });
    await expect(client(legacy as unknown as typeof fetch).discover())
      .rejects.toMatchObject({
        kind: 'rejected',
        code: 'MCP_METHOD_NOT_FOUND',
      });
    expect(legacy).toHaveBeenCalledTimes(1);
    expect((JSON.parse(String(legacy.mock.calls[0][1]?.body)) as RpcBody).method)
      .toBe('server/discover');
  });

  it('surfaces protocol errors from a 400 response body', async () => {
    const rejected = jest.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as RpcBody;
      return json(400, {
        jsonrpc: '2.0',
        id: body.id,
        error: {
          code: -32022,
          message: 'Unsupported protocol version',
          data: {
            supported: ['2025-11-25'],
            requested: MCP_PROTOCOL_VERSION,
          },
        },
      });
    });
    await expect(client(rejected as unknown as typeof fetch).discover())
      .rejects.toMatchObject({
        kind: 'unsupported',
        code: 'MCP_PROTOCOL_UNSUPPORTED',
      });
  });

  it('surfaces the Remote Thread Workspace application code from error.data', async () => {
    const denied = jest.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as RpcBody;
      return json(200, {
        jsonrpc: '2.0',
        id: body.id,
        error: {
          code: -32010,
          message: 'thread ended',
          data: { code: 'thread_ended' },
        },
      });
    });
    await expect(client(denied as unknown as typeof fetch).callTool('fixture_read_a'))
      .rejects.toMatchObject({
        kind: 'rejected',
        code: 'thread_ended',
      });
  });

  it('maps auth failure and malformed JSON-RPC, and never exposes provider bodies', async () => {
    const unauthorized = jest.fn(async () =>
      json(401, { error: 'secret-provider-body' }));
    await expect(client(unauthorized as unknown as typeof fetch).discover())
      .rejects.toMatchObject({ kind: 'unauthorized', status: 401 });

    const mismatched = jest.fn(async () =>
      rpc(999, { supportedVersions: [MCP_PROTOCOL_VERSION] }));
    const error = await client(mismatched as unknown as typeof fetch)
      .discover()
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(McpProtocolError);
    expect(String(error)).not.toContain(TOKEN);
  });

  it('cancels a stalled request through the caller signal', async () => {
    const controller = new AbortController();
    let observed: AbortSignal | undefined;
    const stalled = jest.fn(async (_url: string, init?: RequestInit) =>
      new Promise<Response>(() => {
        observed = init?.signal ?? undefined;
      }));
    const pending = client(stalled as unknown as typeof fetch)
      .discover(controller.signal);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'MCP_REQUEST_CANCELLED' });
    expect(observed?.aborted).toBe(true);
  });

  it('handles complete, absent and unsupported result types', async () => {
    const absent = jest.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as RpcBody;
      return json(200, {
        jsonrpc: '2.0',
        id: body.id,
        result: {
          contents: [{ uri: RESOURCE_URI, text: '{"ok":true}' }],
        },
      });
    });
    await expect(client(absent as unknown as typeof fetch)
      .readResource(RESOURCE_URI))
      .resolves.toEqual([{ uri: RESOURCE_URI, text: '{"ok":true}' }]);

    const unknown = jest.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as RpcBody;
      return json(200, {
        jsonrpc: '2.0',
        id: body.id,
        result: { resultType: 'future', contents: [] },
      });
    });
    await expect(client(unknown as unknown as typeof fetch)
      .readResource(RESOURCE_URI))
      .rejects.toMatchObject({ code: 'MCP_RESULT_TYPE_INVALID' });

    const inputRequired = jest.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as RpcBody;
      return json(200, {
        jsonrpc: '2.0',
        id: body.id,
        result: {
          resultType: 'input_required',
          inputRequests: {},
        },
      });
    });
    await expect(client(inputRequired as unknown as typeof fetch)
      .callTool('fixture_read_a'))
      .rejects.toMatchObject({
        kind: 'unsupported',
        code: 'MCP_INPUT_REQUIRED_UNSUPPORTED',
      });
  });

  it('rejects a resource read without textual contents', async () => {
    const empty = fixtureFetch();
    empty.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as RpcBody;
      if (body.method === 'server/discover') {
        return rpc(body.id, discoveryResult());
      }
      return rpc(body.id, { contents: [] });
    });
    const api = client(empty as unknown as typeof fetch);
    await api.discover();
    await expect(api.readResource('mira://service/x/capabilities'))
      .rejects.toMatchObject({ code: 'MCP_RESOURCE_CONTENT_INVALID' });
  });
});
