import type { StoredCloudSession } from '../cloud/cloudSessionStore';
import type { OpenAiMessage, OpenAiTool } from '../provider/openAiStandardClient';
import { PiCoreAgentLoop } from '../runtime/piAgentLoop';
import {
  TOOL_DISCLOSURE_TOOL,
  type ToolGatewayClient,
  type ToolManifest,
} from '../tools/toolGatewayClient';
import { LocalAgentToolGateway } from '../tools/localAgentToolGateway';
import {
  AccountMcpServiceDirectory,
  AccountServiceCatalogCache,
  parseAccountServiceCatalog,
  parseIssuedAccountServiceCredential,
  requestAccountServiceCredential,
} from './accountServiceRegistry';
import { MCP_PROTOCOL_VERSION } from './mcpProtocolClient';

const NOW = Date.parse('2026-11-24T10:00:00Z');
const BASE_URL = 'https://cloud.test';
const ACCOUNT_ID = 'account-a';
const SESSION_TOKEN = 'session-token-a';

const b64url = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

const credentialToken = (input: {
  accountId?: string;
  serviceId: string;
  audience?: string;
  scopes: string[];
  deviceId?: string;
  expiresInSeconds?: number;
  suffix?: string;
}): string => {
  const nowSeconds = Math.floor(NOW / 1000);
  return [
    b64url({ alg: 'EdDSA', typ: 'JWT', kid: 'fixture-key' }),
    b64url({
      iss: 'mira:cloud-auth',
      sub: input.accountId ?? ACCOUNT_ID,
      aud: input.audience ?? `mira:service:${input.serviceId}`,
      device_id: input.deviceId ?? 'device-a',
      scope: input.scopes,
      iat: nowSeconds,
      nbf: nowSeconds,
      exp: nowSeconds + (input.expiresInSeconds ?? 600),
    }),
    input.suffix ?? 'signature',
  ].join('.');
};

const canonical = (id: string) => {
  if (id === 'cloud-guanlan') return { audience: 'mira:cloud-guanlan', scopes: ['guanlan.read'] };
  if (id === 'cloud-shiyan') return { audience: 'mira:cloud-shiyan', scopes: ['shiyan:authenticate'] };
  if (id === 'who-you') return { audience: 'mira:who-you', scopes: ['whoyou.read'] };
  return undefined;
};

const definition = (input: {
  serviceId: string;
  displayName?: string;
  protocolName?: string;
  protocolVersion?: string;
  endpoint?: string;
  scopes?: string[];
}) => {
  const serviceId = input.serviceId;
  return {
    serviceId,
    projectId: canonical(serviceId) ? serviceId : 'fixture-project',
    displayName: input.displayName ?? serviceId,
    protocol: {
      name: input.protocolName ?? 'mcp',
      version: input.protocolVersion ?? MCP_PROTOCOL_VERSION,
      endpoint: input.endpoint ?? `https://${serviceId}.example/mcp`,
    },
    audience: canonical(serviceId)?.audience ?? `mira:service:${serviceId}`,
    scopes: input.scopes ?? canonical(serviceId)?.scopes ?? [`service:${serviceId}:read`],
  };
};

const catalogBody = (services: Array<{
  serviceId: string;
  displayName?: string;
  protocolName?: string;
  protocolVersion?: string;
  endpoint?: string;
  scopes?: string[];
  revision?: number;
}>) => ({
  services: services.map((entry) => ({
    definition: definition(entry),
    revision: entry.revision ?? 1,
  })),
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const mcpRpc = (id: unknown, result: unknown): Response =>
  json(200, { jsonrpc: '2.0', id, result });

const parseRequest = (init?: RequestInit): {
  id?: number;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
} => JSON.parse(String(init?.body)) as {
  id?: number;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
};

interface FetchFixture {
  fetchImpl: typeof fetch;
  catalogCalls: () => number;
  credentialCalls: Array<{ serviceId: string; expectedRevision: number }>;
  mcpCalls: Array<{ endpoint: string; tool: string; arguments: Record<string, unknown> }>;
}

const fetchFixture = (input: {
  catalog: () => unknown;
  toolsFor: (serviceId: string) => Array<Record<string, unknown>>;
  credential?: (serviceId: string, expectedRevision: number) => Response;
  tokenScopes?: (serviceId: string) => string[];
}): FetchFixture => {
  let catalogCount = 0;
  const credentialCalls: FetchFixture['credentialCalls'] = [];
  const mcpCalls: FetchFixture['mcpCalls'] = [];
  const fetchImpl = jest.fn(async (inputUrl: unknown, init?: RequestInit) => {
    const url = String(inputUrl);
    if (url === `${BASE_URL}/v1/services`) {
      catalogCount += 1;
      return json(200, input.catalog());
    }
    const credentialMatch = url.match(/^https:\/\/cloud\.test\/v1\/services\/([^/]+)\/credential$/u);
    if (credentialMatch) {
      const serviceId = decodeURIComponent(credentialMatch[1]);
      const body = JSON.parse(String(init?.body)) as { expectedRevision: number };
      credentialCalls.push({ serviceId, expectedRevision: body.expectedRevision });
      if (input.credential) return input.credential(serviceId, body.expectedRevision);
      return json(200, {
        token: credentialToken({
          serviceId,
          audience: canonical(serviceId)?.audience,
          scopes: input.tokenScopes?.(serviceId) ?? canonical(serviceId)?.scopes ?? [`service:${serviceId}:read`],
        }),
        tokenType: 'Bearer',
        audience: canonical(serviceId)?.audience ?? `mira:service:${serviceId}`,
        expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
        serviceId,
        revision: body.expectedRevision,
      });
    }
    const serviceId = new URL(url).hostname.split('.')[0];
    const request = parseRequest(init);
    if (request.method === 'initialize') {
      return mcpRpc(request.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: `${serviceId}-server`, version: '1.0.0' },
      });
    }
    if (request.method === 'notifications/initialized') {
      return new Response(null, { status: 202 });
    }
    if (request.method === 'tools/list') {
      return mcpRpc(request.id, { tools: input.toolsFor(serviceId) });
    }
    if (request.method === 'tools/call') {
      mcpCalls.push({
        endpoint: url,
        tool: request.params?.name ?? '',
        arguments: request.params?.arguments ?? {},
      });
      return mcpRpc(request.id, {
        content: [{ type: 'text', text: `${serviceId}:${request.params?.name}` }],
      });
    }
    return mcpRpc(request.id, { isError: true });
  }) as unknown as typeof fetch;
  return {
    fetchImpl,
    catalogCalls: () => catalogCount,
    credentialCalls,
    mcpCalls,
  };
};

const storedSession = (overrides: Partial<StoredCloudSession> = {}): StoredCloudSession => ({
  schemaVersion: 1,
  sessionToken: SESSION_TOKEN,
  account: { id: ACCOUNT_ID, username: 'mira-user' },
  expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
  savedAt: new Date(NOW).toISOString(),
  ...overrides,
});

const directory = (input: {
  fetchImpl: typeof fetch;
  loadSession?: () => Promise<StoredCloudSession | null>;
  currentCloud?: () => { status: string; accountId: string | null };
  now?: () => number;
}): AccountMcpServiceDirectory => {
  const now = input.now ?? (() => NOW);
  const catalog = new AccountServiceCatalogCache({
    baseUrl: BASE_URL,
    fetchImpl: input.fetchImpl,
    now,
  });
  return new AccountMcpServiceDirectory({
    loadSession: input.loadSession ?? (async () => storedSession()),
    currentCloud: input.currentCloud ?? (() => ({
      status: 'signed_in',
      accountId: ACCOUNT_ID,
    })),
    catalog,
    baseUrl: BASE_URL,
    fetchImpl: input.fetchImpl,
    now,
  });
};

const toolsFor = (serviceId: string) => [{
  name: `${serviceId}_lookup`,
  description: `${serviceId} lookup`,
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
}];

describe('Mira ID service registry catalog', () => {
  it('parses compatible and unknown entries but isolates malformed registrations', () => {
    const parsed = parseAccountServiceCatalog({
      services: [
        { definition: definition({ serviceId: 'notes' }), revision: 2 },
        { definition: definition({ serviceId: 'notes' }), revision: 3 },
        { definition: definition({ serviceId: 'legacy', protocolName: 'custom' }), revision: 1 },
        {
          definition: {
            ...definition({ serviceId: 'broken' }),
            audience: 'mira:service:someone-else',
          },
          revision: 1,
        },
        { definition: null, revision: 1 },
        { definition: definition({ serviceId: 'tasks' }), revision: 0 },
      ],
    });
    expect(parsed.map((entry) => [entry.definition.serviceId, entry.revision]))
      .toEqual([['notes', 2], ['legacy', 1]]);
    expect(() => parseAccountServiceCatalog({ services: 'no' }))
      .toThrow('Mira ID returned an invalid service catalog');
  });

  it('consumes canonical compatible services without admitting extra scopes or duplicate legacy mail', async () => {
    const fixture = fetchFixture({
      catalog: () => catalogBody([
        { serviceId: 'cloud-guanlan' },
        { serviceId: 'cloud-shiyan', protocolName: 'http' },
        { serviceId: 'who-you' },
      ]),
      toolsFor,
    });
    const registry = directory({ fetchImpl: fixture.fetchImpl });
    const bindings = await registry.bindings({ accountId: ACCOUNT_ID });
    expect(bindings).toHaveLength(1);
    const parsed = parseAccountServiceCatalog(catalogBody([{ serviceId: 'cloud-guanlan', scopes: ['guanlan.read', 'guanlan.write'] }]));
    expect(parsed).toEqual([]);
    const credential = await requestAccountServiceCredential(SESSION_TOKEN, {
      accountId: ACCOUNT_ID, serviceId: 'cloud-guanlan', expectedRevision: 1,
    }, { baseUrl: BASE_URL, fetchImpl: fixture.fetchImpl, now: () => NOW });
    expect(credential.claims.scopes).toEqual(['guanlan.read']);
  });

  it('maps only generic compatible MCP registrations and reuses one catalog lookup', async () => {
    const catalog = catalogBody([
      { serviceId: 'notes', revision: 2 },
      { serviceId: 'tasks', revision: 4 },
      { serviceId: 'legacy', protocolName: 'custom' },
      { serviceId: 'old', protocolVersion: '2024-01-01' },
      { serviceId: 'who-you', revision: 7 },
    ]);
    const fixture = fetchFixture({
      catalog: () => catalog,
      toolsFor,
    });
    const registry = directory({ fetchImpl: fixture.fetchImpl });

    const bindings = await registry.bindings({ accountId: ACCOUNT_ID });
    expect(bindings.map((binding) => binding.serviceTypeId))
      .toEqual(['notes', 'tasks']);
    expect(fixture.catalogCalls()).toBe(1);
    const reused = await registry.bindings({ accountId: ACCOUNT_ID });
    expect(reused[0]).toBe(bindings[0]);
    expect(fixture.catalogCalls()).toBe(1);

    const notes = bindings[0];
    const ready = await notes.discover({ accountId: ACCOUNT_ID });
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') return;
    expect(ready.snapshot.service.id).toBe('notes');
    expect(ready.snapshot.service.toolNames).toEqual(['notes_lookup']);
    expect(ready.snapshot.initialToolNames).toEqual([]);
    expect(ready.snapshot.expiresAt).toBe(NOW + 10 * 60_000);
    expect(fixture.credentialCalls).toEqual([
      { serviceId: 'notes', expectedRevision: 2 },
    ]);
    expect(fixture.catalogCalls()).toBe(1);
    await expect(ready.gateway.callTool({
      callId: 'notes-call',
      name: 'notes_lookup',
      arguments: '{"query":"mira"}',
    })).resolves.toEqual({ content: 'notes:notes_lookup' });
    expect(fixture.mcpCalls).toEqual([{
      endpoint: 'https://notes.example/mcp',
      tool: 'notes_lookup',
      arguments: { query: 'mira' },
    }]);
  });

  it('repairs a stale service revision once from a forced catalog refresh', async () => {
    let revision = 1;
    const fixture = fetchFixture({
      catalog: () => catalogBody([{ serviceId: 'notes', revision }]),
      toolsFor,
      credential: (serviceId, expectedRevision) => {
        if (expectedRevision === 1) {
          revision = 2;
          return json(409, { error: 'SERVICE_REGISTRATION_CHANGED' });
        }
        return json(200, {
          token: credentialToken({
            serviceId,
            scopes: ['service:notes:read'],
          }),
          tokenType: 'Bearer',
          audience: 'mira:service:notes',
          expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
          serviceId,
          revision: expectedRevision,
        });
      },
    });
    const registry = directory({ fetchImpl: fixture.fetchImpl });
    const [binding] = await registry.bindings({ accountId: ACCOUNT_ID });
    const ready = await binding.discover({ accountId: ACCOUNT_ID });
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') return;
    expect(fixture.catalogCalls()).toBe(2);
    expect(fixture.credentialCalls).toEqual([
      { serviceId: 'notes', expectedRevision: 1 },
      { serviceId: 'notes', expectedRevision: 2 },
    ]);
    expect(ready.snapshot.bindingKey).toContain(':2:');
  });

  it('isolates a revoked sibling and keeps the other authorized service usable', async () => {
    const fixture = fetchFixture({
      catalog: () => catalogBody([
        { serviceId: 'notes', revision: 2 },
        { serviceId: 'tasks', revision: 4 },
      ]),
      toolsFor,
      credential: (serviceId, expectedRevision) => {
        if (serviceId === 'notes') {
          return json(404, { error: 'SERVICE_REGISTRATION_NOT_FOUND' });
        }
        return json(200, {
          token: credentialToken({
            serviceId,
            scopes: ['service:tasks:read'],
          }),
          tokenType: 'Bearer',
          audience: 'mira:service:tasks',
          expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
          serviceId,
          revision: expectedRevision,
        });
      },
    });
    const registry = directory({ fetchImpl: fixture.fetchImpl });
    const [notes, tasks] = await registry.bindings({ accountId: ACCOUNT_ID });
    await expect(notes.discover({ accountId: ACCOUNT_ID })).resolves.toMatchObject({
      status: 'degraded',
      serviceTypeId: 'notes',
    });
    await expect(tasks.discover({ accountId: ACCOUNT_ID })).resolves.toMatchObject({
      status: 'ready',
      serviceTypeId: 'tasks',
    });
  });

  it('invalidates a cached binding on account, session, expiry or observed revision change', async () => {
    let session = storedSession();
    let cloud = { status: 'signed_in', accountId: ACCOUNT_ID };
    let now = NOW;
    let revision = 3;
    const fixture = fetchFixture({
      catalog: () => catalogBody([{ serviceId: 'notes', revision }]),
      toolsFor,
      credential: (serviceId, expectedRevision) => json(200, {
        token: credentialToken({
          serviceId,
          scopes: ['service:notes:read'],
        }),
        tokenType: 'Bearer',
        audience: 'mira:service:notes',
        expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
        serviceId,
        revision: expectedRevision,
      }),
    });
    const nowFn = () => now;
    const registry = directory({
      fetchImpl: fixture.fetchImpl,
      loadSession: async () => session,
      currentCloud: () => cloud,
      now: nowFn,
    });
    const [binding] = await registry.bindings({ accountId: ACCOUNT_ID });
    const ready = await binding.discover({ accountId: ACCOUNT_ID });
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') return;
    await expect(ready.snapshot.assertCurrent?.()).resolves.toBeUndefined();

    session = storedSession({ sessionToken: 'session-token-b' });
    await expect(ready.snapshot.assertCurrent?.()).rejects.toMatchObject({
      code: 'SERVICE_REGISTRY_SESSION_CHANGED',
    });

    session = storedSession();
    cloud = { status: 'signed_in', accountId: 'account-b' };
    await expect(ready.snapshot.assertCurrent?.()).rejects.toMatchObject({
      code: 'SERVICE_REGISTRY_ACCOUNT_CHANGED',
    });

    cloud = { status: 'signed_in', accountId: ACCOUNT_ID };
    revision = 4;
    // The bounded catalog cache expires before the service credential does;
    // another binding then observes the changed revision.
    now = NOW + 5 * 60_000 + 1;
    await registry.bindings({ accountId: ACCOUNT_ID });
    await expect(ready.snapshot.assertCurrent?.()).rejects.toMatchObject({
      code: 'SERVICE_REGISTRATION_CHANGED',
    });

    now = NOW + 11 * 60_000;
    await expect(ready.snapshot.assertCurrent?.()).rejects.toMatchObject({
      code: 'SERVICE_CREDENTIAL_EXPIRED',
    });
  });

  it('rejects credentials with the wrong service, audience, revision, scope or lifetime', async () => {
    const valid = {
      token: credentialToken({
        serviceId: 'notes',
        scopes: ['service:notes:read'],
      }),
      tokenType: 'Bearer',
      audience: 'mira:service:notes',
      expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
      serviceId: 'notes',
      revision: 2,
    };
    expect(parseIssuedAccountServiceCredential(valid, {
      accountId: ACCOUNT_ID,
      serviceId: 'notes',
      revision: 2,
      nowMs: NOW,
    }).claims.scopes).toEqual(['service:notes:read']);

    for (const invalid of [
      { ...valid, serviceId: 'tasks' },
      { ...valid, audience: 'mira:service:tasks' },
      { ...valid, revision: 3 },
      { ...valid, expiresAt: new Date(NOW + 20 * 60_000).toISOString() },
      {
        ...valid,
        token: credentialToken({
          serviceId: 'notes',
          scopes: ['service:tasks:read'],
        }),
      },
    ]) {
      expect(() => parseIssuedAccountServiceCredential(invalid, {
        accountId: ACCOUNT_ID,
        serviceId: 'notes',
        revision: 2,
        nowMs: NOW,
      })).toThrow('Mira ID returned an invalid service credential');
    }

  });

  it('sends the Cloud Session only to Cloud Auth, never to the service endpoint', async () => {
    const seen: Array<{ url: string; authorization: string | undefined }> = [];
    const fixture = fetchFixture({
      catalog: () => catalogBody([{ serviceId: 'notes' }]),
      toolsFor,
    });
    const wrappedFetch = (async (url: unknown, init?: RequestInit) => {
      seen.push({
        url: String(url),
        authorization: new Headers(init?.headers).get('authorization') ?? undefined,
      });
      return fixture.fetchImpl(url as RequestInfo, init);
    }) as typeof fetch;
    const registry = directory({ fetchImpl: wrappedFetch });
    const [binding] = await registry.bindings({ accountId: ACCOUNT_ID });
    const ready = await binding.discover({ accountId: ACCOUNT_ID });
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') return;
    await ready.gateway.callTool({
      callId: 'notes-call',
      name: 'notes_lookup',
      arguments: '{}',
    });
    const cloudCalls = seen.filter((entry) => entry.url.startsWith(BASE_URL));
    const serviceCalls = seen.filter((entry) => entry.url.includes('.example/mcp'));
    expect(cloudCalls.length).toBeGreaterThan(0);
    expect(serviceCalls.length).toBeGreaterThan(0);
    expect(cloudCalls.every((entry) =>
      entry.authorization === `Bearer ${SESSION_TOKEN}`)).toBe(true);
    expect(serviceCalls.every((entry) =>
      entry.authorization !== `Bearer ${SESSION_TOKEN}` &&
      entry.authorization?.startsWith('Bearer ') === true)).toBe(true);
  });

  it('requests a credential with the catalog revision and rejects a mismatched response', async () => {
    const fixture = fetchFixture({
      catalog: () => catalogBody([{ serviceId: 'notes', revision: 5 }]),
      toolsFor,
      credential: (serviceId) => json(200, {
        token: credentialToken({
          serviceId,
          scopes: ['service:notes:read'],
        }),
        tokenType: 'Bearer',
        audience: 'mira:service:notes',
        expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
        serviceId,
        revision: 4,
      }),
    });
    await expect(requestAccountServiceCredential(
      SESSION_TOKEN,
      {
        accountId: ACCOUNT_ID,
        serviceId: 'notes',
        expectedRevision: 5,
      },
      { baseUrl: BASE_URL, fetchImpl: fixture.fetchImpl, now: () => NOW },
    )).rejects.toMatchObject({ code: 'SERVICE_CREDENTIAL_INVALID' });
    expect(fixture.credentialCalls).toEqual([{
      serviceId: 'notes',
      expectedRevision: 5,
    }]);
  });

  it('runs a real Pi Core turn over two newly registered services and hides an incompatible one', async () => {
    const fixture = fetchFixture({
      catalog: () => catalogBody([
        { serviceId: 'notes', displayName: 'Notes', revision: 2 },
        { serviceId: 'tasks', displayName: 'Tasks', revision: 4 },
        { serviceId: 'legacy', protocolName: 'custom' },
      ]),
      toolsFor,
    });
    const registry = directory({ fetchImpl: fixture.fetchImpl });
    const localTool: ToolManifest = {
      name: 'web',
      description: 'Web page',
      parameters: { type: 'object' },
    };
    const localCall = jest.fn(async () => ({ content: 'local-result' }));
    const local: ToolGatewayClient = {
      listTools: async () => [localTool],
      callTool: localCall,
    };
    const gateway = new LocalAgentToolGateway({
      local,
      mcp: [],
      mcpDirectory: registry,
      cloudContext: () => ({
        accountId: ACCOUNT_ID,
        explicitlySignedOut: false,
        desktopMode: 'none',
      }),
    });
    const offered: string[][] = [];
    const toolCall = (
      callId: string,
      name: string,
      args: Record<string, unknown>,
    ) => ({
      type: 'tool-call' as const,
      callId,
      name,
      arguments: JSON.stringify(args),
    });
    const modelCall = jest.fn(async (
      _messages: readonly OpenAiMessage[],
      tools: readonly OpenAiTool[],
    ) => {
      offered.push(tools.map((tool) => tool.function.name));
      if (offered.length === 1) {
        return (async function* () {
          yield toolCall('disclose-notes', TOOL_DISCLOSURE_TOOL, {
            serviceId: 'notes',
            toolNames: ['notes_lookup'],
          });
          yield { type: 'finish' as const, reason: 'tool_calls' as const };
        })();
      }
      if (offered.length === 2) {
        return (async function* () {
          yield toolCall('disclose-tasks', TOOL_DISCLOSURE_TOOL, {
            serviceId: 'tasks',
            toolNames: ['tasks_lookup'],
          });
          yield { type: 'finish' as const, reason: 'tool_calls' as const };
        })();
      }
      if (offered.length === 3) {
        return (async function* () {
          yield toolCall('call-notes', 'notes_lookup', { query: 'mira' });
          yield toolCall('call-tasks', 'tasks_lookup', { query: 'registry' });
          yield toolCall('call-local', 'web', { url: 'https://example.test' });
          yield { type: 'finish' as const, reason: 'tool_calls' as const };
        })();
      }
      return (async function* () {
        yield { type: 'text-delta' as const, delta: 'both services complete' };
        yield { type: 'finish' as const, reason: 'stop' as const };
      })();
    });
    const events: Array<{ type: string; name?: string; content?: string }> = [];
    for await (const event of await new PiCoreAgentLoop(gateway).run(
      [{ role: 'user', content: 'use both newly registered services' }],
      modelCall,
    )) {
      events.push(event);
    }

    expect(offered[0]).toEqual(expect.arrayContaining([
      'web',
      TOOL_DISCLOSURE_TOOL,
    ]));
    expect(offered[0]).not.toContain('notes_lookup');
    expect(offered[0]).not.toContain('tasks_lookup');
    expect(offered[2]).toEqual(expect.arrayContaining(['notes_lookup']));
    expect(offered[3]).toEqual(expect.arrayContaining(['tasks_lookup']));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool-result', name: 'notes_lookup' }),
      expect.objectContaining({ type: 'tool-result', name: 'tasks_lookup' }),
      expect.objectContaining({ type: 'tool-result', name: 'web' }),
    ]));
    expect(localCall).toHaveBeenCalledTimes(1);
    expect(fixture.mcpCalls.map((call) => call.endpoint)).toEqual([
      'https://notes.example/mcp',
      'https://tasks.example/mcp',
    ]);
    const discovery = await gateway.discoverTools();
    expect(discovery.services?.map((service) => service.id))
      .toEqual(expect.arrayContaining(['notes', 'tasks']));
    expect(discovery.services?.map((service) => service.id))
      .not.toContain('legacy');
    expect(fixture.catalogCalls()).toBe(1);
  });
});
