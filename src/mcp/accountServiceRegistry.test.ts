import type { StoredCloudSession } from '../cloud/cloudSessionStore';
import type { OpenAiMessage, OpenAiTool } from '../provider/openAiStandardClient';
import { PiCoreAgentLoop } from '../runtime/piAgentLoop';
import {
  TOOL_DISCLOSURE_TOOL,
  ToolApprovalRequiredError,
  type ToolGatewayClient,
  type ToolManifest,
} from '../tools/toolGatewayClient';
import { LocalAgentToolGateway } from '../tools/localAgentToolGateway';
import {
  accountServiceIdentity,
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

const identity = (serviceId: string, appId = 'app-fixture-' + serviceId, resource = 'https://' + serviceId + '.example/mcp') => ({ appId, serviceId, resource });
const localId = (serviceId: string) => accountServiceIdentity(identity(serviceId));

const credentialToken = (input: {
  accountId?: string;
  serviceId: string;
  appId?: string;
  resource?: string;
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
      aud: input.audience ?? input.resource ?? identity(input.serviceId).resource,
      app_id: input.appId ?? identity(input.serviceId).appId,
      service_id: input.serviceId,
      resource: input.resource ?? identity(input.serviceId).resource,
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
  appId?: string;
  resource?: string;
  displayName?: string;
  protocolName?: string;
  protocolVersion?: string;
  endpoint?: string;
  scopes?: string[];
}) => {
  const serviceId = input.serviceId;
  return {
    ...identity(serviceId, input.appId, input.resource ?? input.endpoint),
    projectId: canonical(serviceId) ? serviceId : 'fixture-project',
    name: input.displayName ?? serviceId,
    type: 'mcp',
    protocol: {
      name: input.protocolName ?? 'mcp',
      version: input.protocolVersion ?? MCP_PROTOCOL_VERSION,
      endpoint: input.endpoint ?? `https://${serviceId}.example/mcp`,
    },
    scopes: input.scopes ?? canonical(serviceId)?.scopes ?? [`service:${serviceId}:read`],
  };
};

const catalogBody = (services: Array<{
  serviceId: string;
  appId?: string;
  resource?: string;
  displayName?: string;
  protocolName?: string;
  protocolVersion?: string;
  endpoint?: string;
  scopes?: string[];
  revision?: number;
}>) => ({
  services: services.map((entry) => ({
    ...definition(entry),
    revision: entry.revision ?? 1,
    manifestRevision: 1,
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
    if (url === `${BASE_URL}/v1/application-services`) {
      catalogCount += 1;
      return json(200, input.catalog());
    }
    const credentialMatch = url.match(/^https:\/\/cloud\.test\/v1\/application-services\/([^/]+)\/([^/]+)\/credential$/u);
    if (credentialMatch) {
      const appId = decodeURIComponent(credentialMatch[1]);
      const serviceId = decodeURIComponent(credentialMatch[2]);
      const body = JSON.parse(String(init?.body)) as { expectedRevision: number; resource: string };
      credentialCalls.push({ serviceId, expectedRevision: body.expectedRevision });
      const record = (input.catalog() as { services: ReturnType<typeof definition>[] }).services.find(e => e.appId === appId && e.serviceId === serviceId);
      expect(record?.resource).toBe(body.resource);
      if (input.credential) return input.credential(serviceId, body.expectedRevision);
      return json(200, {
        token: credentialToken({
          serviceId,
          appId, resource: body.resource,
          scopes: input.tokenScopes?.(serviceId) ?? canonical(serviceId)?.scopes ?? [`service:${serviceId}:read`],
        }),
        tokenType: 'Bearer',
        appId, resource: body.resource,
        scopes: input.tokenScopes?.(serviceId) ?? canonical(serviceId)?.scopes ?? ['service:' + serviceId + ':read'],
        expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
        serviceId,
        revision: body.expectedRevision,
      });
    }
    const serviceId = new URL(url).hostname.split('.')[0];
    if (serviceId === 'who-you' && new URL(url).pathname === '/.well-known/oauth-protected-resource/mcp') {
      expect(init?.headers).not.toHaveProperty('authorization');
      return json(200, { resource: 'https://who-you.example/mcp', authorization_servers: [BASE_URL], scopes_supported: ['whoyou.read'], bearer_methods_supported: ['header'] });
    }
    const request = parseRequest(init);
    if (request.method === 'server/discover') {
      return mcpRpc(request.id, {
        supportedVersions: [MCP_PROTOCOL_VERSION],
        capabilities: { tools: {} },
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: serviceId + '-server', version: '1.0.0' } },
      });
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
      if (serviceId === 'who-you') {
        const structuredContent = request.params?.name === 'whoyou_whoami'
          ? { accountId: ACCOUNT_ID, consumerId: ACCOUNT_ID, scopes: ['whoyou.read'] }
          : request.params?.name === 'whoyou_mailbox_list'
          ? { identities: [] }
          : { messages: [], nextCursor: 'page-two-fixture' };
        return mcpRpc(request.id, { content: [], structuredContent });
      }
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
        ...catalogBody([{ serviceId: 'notes', appId: 'app-fixture-one', revision: 2 },
          { serviceId: 'notes', appId: 'app-fixture-two', revision: 3 }]).services,
        { ...definition({ serviceId: 'broken' }), resource: 'mira:service:someone-else', revision: 1, manifestRevision: 1 },
        { definition: definition({ serviceId: 'legacy' }), revision: 1 },
        { ...definition({ serviceId: 'tasks' }), revision: 0, manifestRevision: 1 },
      ],
    });
    expect(parsed.map(entry => [entry.definition.appId, entry.definition.serviceId, entry.revision]))
      .toEqual([['app-fixture-one', 'notes', 2], ['app-fixture-two', 'notes', 3]]);
    expect(accountServiceIdentity(parsed[0].definition)).not.toBe(accountServiceIdentity(parsed[1].definition));
    expect(() => parseAccountServiceCatalog({ services: 'no' }))
      .toThrow('Mira ID returned an invalid service catalog');
  });

  it('consumes declared compatible services without hardcoded scope or audience mapping', async () => {
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
    expect(bindings.map(b => b.serviceTypeId)).toEqual([localId('cloud-guanlan'), localId('who-you')]);
    const parsed = parseAccountServiceCatalog(catalogBody([{ serviceId: 'cloud-guanlan', scopes: ['guanlan.read', 'guanlan.write'] }]));
    expect(parsed[0]?.definition.scopes).toEqual(['guanlan.read', 'guanlan.write']);
    const credential = await requestAccountServiceCredential(SESSION_TOKEN, {
      accountId: ACCOUNT_ID, ...identity('cloud-guanlan'), expectedRevision: 1,
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
      .toEqual([localId('notes'), localId('tasks'), localId('who-you')]);
    expect(fixture.catalogCalls()).toBe(1);
    const reused = await registry.bindings({ accountId: ACCOUNT_ID });
    expect(reused[0]).toBe(bindings[0]);
    expect(fixture.catalogCalls()).toBe(1);

    const notes = bindings[0];
    const ready = await notes.discover({ accountId: ACCOUNT_ID });
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') return;
    expect(ready.snapshot.service.id).toBe(localId('notes'));
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

  it('isolates identical tool names and service IDs belonging to different application instances', async () => {
    let now = NOW;
    const a = { serviceId: 'notes', appId: 'app-fixture-one', endpoint: 'https://one.example/mcp' };
    const b = { serviceId: 'notes', appId: 'app-fixture-two', endpoint: 'https://two.example/mcp' };
    let registrations = [a, b];
    const fixture = fetchFixture({
      catalog: () => catalogBody(registrations),
      toolsFor: () => toolsFor('notes'),
    });
    const registry = directory({ fetchImpl: fixture.fetchImpl, now: () => now });
    const bindings = await registry.bindings({ accountId: ACCOUNT_ID });
    expect(bindings).toHaveLength(2);
    expect(bindings[0].serviceTypeId).not.toBe(bindings[1].serviceTypeId);
    const left = await bindings[0].discover({ accountId: ACCOUNT_ID });
    const right = await bindings[1].discover({ accountId: ACCOUNT_ID });
    if (left.status !== 'ready' || right.status !== 'ready') throw new Error('both bindings must be ready');
    const call = { callId: 'lookup', name: 'notes_lookup', arguments: '{}' };
    await expect(left.gateway.callTool(call)).resolves.toEqual({ content: 'one:notes_lookup' });
    await expect(right.gateway.callTool(call)).resolves.toEqual({ content: 'two:notes_lookup' });
    registrations = [b];
    now += 5 * 60_000 + 1;
    expect((await registry.bindings({ accountId: ACCOUNT_ID })).map(binding => binding.serviceTypeId))
      .toEqual([bindings[1].serviceTypeId]);
    await expect(left.gateway.callTool(call)).rejects.toMatchObject({ code: 'MCP_SERVICE_UNAUTHORIZED' });
    await expect(right.gateway.callTool(call)).resolves.toEqual({ content: 'two:notes_lookup' });
    expect(fixture.mcpCalls.map(item => item.endpoint)).toEqual([a.endpoint, b.endpoint, b.endpoint]);
  });

  it('uses one registered Who You binding, only approved mail schemas, and one-shot consent for each page', async () => {
    let active = true;
    let now = NOW;
    const fixture = fetchFixture({
      catalog: () => catalogBody(active ? [{ serviceId: 'who-you' }] : []),
      toolsFor: () => ['whoyou_whoami', 'whoyou_mailbox_list', 'whoyou_mail_search', 'whoyou_mail_message_get', 'whoyou_mail_send'].map(name => ({
        name, description: name, inputSchema: { type: 'object' },
      })),
    });
    const registry = directory({ fetchImpl: fixture.fetchImpl, now: () => now });
    const bindings = await registry.bindings({ accountId: ACCOUNT_ID });
    expect(bindings.map(b => b.serviceTypeId)).toEqual([localId('who-you')]);
    const ready = await bindings[0].discover({ accountId: ACCOUNT_ID });
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') return;
    expect(ready.snapshot.tools.map(t => t.name).sort()).toEqual(['whoyou_mail_message_get', 'whoyou_mail_search']);
    expect(ready.snapshot.tools.every(t => Boolean(t.sensitiveResult))).toBe(true);
    const search = { callId: 'page-one', name: 'whoyou_mail_search', arguments: '{}' };
    let approval;
    try { await ready.gateway.callTool(search); } catch (error) {
      if (error instanceof ToolApprovalRequiredError) approval = error.approval;
      else throw error;
    }
    expect(approval).toBeDefined();
    expect(fixture.mcpCalls.map(c => c.tool)).toEqual(['whoyou_whoami']);
    if (!approval) throw new Error('missing approval');
    const approved = await ready.gateway.resolveApproval(approval, 'approved');
    expect(approved.status).toBe('completed');
    if (approved.status === 'completed') expect(JSON.parse(approved.result.content).nextCursor).toBe('page-two-fixture');
    await expect(ready.gateway.callTool({ ...search, callId: 'page-two', arguments: '{"cursor":"page-two-fixture"}' })).rejects.toBeInstanceOf(ToolApprovalRequiredError);
    await expect(ready.gateway.callTool({ ...search, name: 'whoyou_mail_send' })).rejects.toMatchObject({ code: 'TOOL_NOT_DECLARED' });
    const snapshot = await registry.loadWhoYouSnapshot({ accountId: ACCOUNT_ID, sessionToken: SESSION_TOKEN });
    expect(snapshot.identity.accountId).toBe(ACCOUNT_ID);
    expect(snapshot.mailboxes).toEqual([]);
    expect(fixture.credentialCalls.every(c => c.serviceId === 'who-you')).toBe(true);
    const previousCalls = fixture.mcpCalls.length;
    // Catalog refresh observes revocation while the original offline bearer
    // still has time left. Neither old approvals nor settings can bypass it.
    active = false;
    now += 5 * 60_000 + 1;
    expect(await registry.bindings({ accountId: ACCOUNT_ID })).toEqual([]);
    await expect(ready.gateway.callTool(search)).rejects.toBeDefined();
    await expect(registry.loadWhoYouSnapshot({ accountId: ACCOUNT_ID, sessionToken: SESSION_TOKEN }))
      .rejects.toMatchObject({ code: 'SERVICE_REGISTRATION_NOT_FOUND' });
    expect(fixture.mcpCalls).toHaveLength(previousCalls);

  });

  it('refreshes a previously empty settings catalog after active facility login and revokes an in-flight binding at the catalog deadline', async () => {
    let active = false;
    let now = NOW;
    const fixture = fetchFixture({
      catalog: () => catalogBody(active ? [{ serviceId: 'who-you' }] : []),
      toolsFor: () => ['whoyou_whoami', 'whoyou_mailbox_list', 'whoyou_mail_search', 'whoyou_mail_message_get'].map(name => ({
        name, description: name, inputSchema: { type: 'object' },
      })),
    });
    const registry = directory({ fetchImpl: fixture.fetchImpl, now: () => now });
    expect(await registry.bindings({ accountId: ACCOUNT_ID })).toEqual([]);
    active = true;
    await expect(registry.loadWhoYouSnapshot({ accountId: ACCOUNT_ID, sessionToken: SESSION_TOKEN }))
      .resolves.toMatchObject({ identity: { accountId: ACCOUNT_ID } });
    const [binding] = await registry.bindings({ accountId: ACCOUNT_ID });
    const ready = await binding.discover({ accountId: ACCOUNT_ID });
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') throw new Error('binding unavailable');
    active = false;
    now += 5 * 60_000 + 1;
    // No other run or settings refresh is needed to invalidate an old gateway.
    const before = fixture.mcpCalls.length;
    await expect(ready.gateway.callTool({callId:'revoked', name:'whoyou_mail_search', arguments:'{}'}))
      .rejects.toMatchObject({code:'MCP_SERVICE_UNAUTHORIZED'});
    expect(fixture.mcpCalls).toHaveLength(before);
  });

  it('does not let an invalidated in-flight catalog restore stale service authorization', async () => {
    let release: (response: Response) => void = () => undefined;
    const first = new Promise<Response>(resolve => { release = resolve; });
    const fetchImpl = jest.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce(json(200, catalogBody([]))) as unknown as typeof fetch;
    const cache = new AccountServiceCatalogCache({baseUrl:BASE_URL,fetchImpl,now:()=>NOW});
    const input = {accountId:ACCOUNT_ID,sessionToken:SESSION_TOKEN};
    const pending = cache.load(input);
    const rejected = expect(pending).rejects.toMatchObject({code:'SERVICE_CATALOG_SUPERSEDED'});
    await Promise.resolve();
    cache.invalidate();
    await expect(cache.load(input)).resolves.toEqual([]);
    release(json(200,catalogBody([{serviceId:'who-you'}])));
    await rejected;
    expect(cache.peek(input)).toEqual([]);
  });

  it('repairs a stale service revision once from a forced catalog refresh', async () => {
    let revision = 1;
    const fixture = fetchFixture({
      catalog: () => catalogBody([{ serviceId: 'notes', revision }]),
      toolsFor,
      credential: (serviceId, expectedRevision) => {
        if (expectedRevision === 1) {
          revision = 2;
          return json(409, { error: 'APPLICATION_SERVICE_CHANGED' });
        }
        return json(200, {
          token: credentialToken({
            serviceId,
            scopes: ['service:notes:read'],
          }),
          tokenType: 'Bearer',
          appId: identity('notes').appId, resource: identity('notes').resource, scopes: ['service:notes:read'],
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
    expect(JSON.parse(ready.snapshot.bindingKey!)).toContain(2);
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
          return json(404, { error: 'APPLICATION_SERVICE_NOT_FOUND' });
        }
        return json(200, {
          token: credentialToken({
            serviceId,
            scopes: ['service:tasks:read'],
          }),
          tokenType: 'Bearer',
          appId: identity('tasks').appId, resource: identity('tasks').resource, scopes: ['service:tasks:read'],
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
      serviceTypeId: localId('notes'),
    });
    await expect(tasks.discover({ accountId: ACCOUNT_ID })).resolves.toMatchObject({
      status: 'ready',
      serviceTypeId: localId('tasks'),
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
        appId: identity('notes').appId, resource: identity('notes').resource, scopes: ['service:notes:read'],
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
      appId: identity('notes').appId, resource: identity('notes').resource, scopes: ['service:notes:read'],
      expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
      serviceId: 'notes',
      revision: 2,
    };
    expect(parseIssuedAccountServiceCredential(valid, {
      accountId: ACCOUNT_ID,
      ...identity('notes'),
      revision: 2,
      nowMs: NOW,
    }).claims.scopes).toEqual(['service:notes:read']);

    for (const invalid of [
      { ...valid, serviceId: 'tasks' },
      { ...valid, resource: identity('tasks').resource },
      { ...valid, appId: identity('tasks').appId },
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
        ...identity('notes'),
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
        appId: identity('notes').appId, resource: identity('notes').resource, scopes: ['service:notes:read'],
        expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
        serviceId,
        revision: 4,
      }),
    });
    await expect(requestAccountServiceCredential(
      SESSION_TOKEN,
      {
        accountId: ACCOUNT_ID,
        ...identity('notes'),
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
            serviceId: localId('notes'),
            toolNames: ['notes_lookup'],
          });
          yield { type: 'finish' as const, reason: 'tool_calls' as const };
        })();
      }
      if (offered.length === 2) {
        return (async function* () {
          yield toolCall('disclose-tasks', TOOL_DISCLOSURE_TOOL, {
            serviceId: localId('tasks'),
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
      .toEqual(expect.arrayContaining([localId('notes'), localId('tasks')]));
    expect(discovery.services?.map((service) => service.id))
      .not.toContain(localId('legacy'));
    expect(fixture.catalogCalls()).toBe(1);
  });
});
