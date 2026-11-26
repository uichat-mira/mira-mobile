import { cloudSessionStore } from '../cloud/cloudSessionStore';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import { AccountServiceCatalogCache, accountServiceIdentity, discoverAccountMcpService, type IssuedAccountServiceCredential } from './accountServiceRegistry';
const WHO_YOU_MCP_RESOURCE_URI = 'mira://service/who-you/capabilities';
const APP_ID = 'app-whoyou-fixture';
const MCP_URL = 'https://who-you.example.test/mcp';
const CLOUD_AUTH_URL = 'https://cloud-auth.example.test';
const SESSION = 'mcs_v1.session.secret';
const ACCOUNT = 'account-1';

const credential: IssuedAccountServiceCredential = {
  token: 'who-you-read-token',
  tokenType: 'Bearer',
  appId: APP_ID, resource: MCP_URL,
  serviceId: 'who-you',
  revision: 1,
  expiresAt: '2099-01-01T00:00:00.000Z',
  claims: {
    accountId: ACCOUNT,
    deviceId: 'device-1',
    scopes: ['whoyou.read'],
    expiresAt: '2099-01-01T00:00:00.000Z',
  },
};

const tool = (
  name: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({
  name,
  description: name + ' description',
  inputSchema: {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  },
});

const tools = [
  tool('whoyou_whoami', {}),
  tool('whoyou_mailbox_list', {}),
  tool('whoyou_mail_search', { query: { type: 'string' } }),
  tool('whoyou_mail_message_get', { messageId: { type: 'string' } }, ['messageId']),
  tool('whoyou_mail_send', { draftId: { type: 'string' } }),
  tool('whoyou_mailbox_delete', { confirm: { type: 'boolean' } }),
];

const capability = (
  id: string,
  access: 'read' | 'write' | 'send' | 'destructive',
  toolNames: string[],
  confirmation = 'none',
) => ({
  id,
  title: id,
  description: id + ' description',
  access,
  requiredScopes: access === 'read'
    ? ['whoyou.read']
    : ['whoyou.read', 'whoyou.mail.write'],
  confirmation,
  tools: toolNames,
});

const manifest = {
  schema: 'mira.service-capabilities/v1',
  version: '1.0.0',
  service: {
    id: 'who-you',
    name: 'Who You',
    description: 'Who You service',
    documentation: 'https://example.test/who-you',
    mcp: {
      serverName: 'who-you',
      serverVersion: '0.1.0',
      sdk: '@modelcontextprotocol/server@2.4.0',
      protocolVersions: ['2026-07-28'],
    },
  },
  capabilities: [
    capability('who-you.identity', 'read', ['whoyou_whoami']),
    capability('who-you.mailbox.read', 'read', ['whoyou_mailbox_list']),
    capability('who-you.mail.read', 'read', [
      'whoyou_mail_search',
      'whoyou_mail_message_get',
    ]),
    capability('who-you.mail.send', 'send', ['whoyou_mail_send'], 'draft-credential'),
    capability('who-you.mailbox.delete', 'destructive', ['whoyou_mailbox_delete']),
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

const fixtureFetch = (options: {
  resource?: unknown | null;
  whoami?: unknown;
  tools?: unknown[];
} = {}) =>
  jest.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (url !== MCP_URL) throw new Error('unexpected URL ' + url);
    const body = JSON.parse(String(init?.body)) as {
      id?: number;
      method: string;
      params?: { name?: string; uri?: string };
    };
    if (body.method === 'server/discover') {
      return rpc(body.id, {
        supportedVersions: ['2026-07-28'],
        capabilities: { tools: {}, resources: {} },
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'who-you', version: '0.1.0' } },
      });
    }
    if (body.method === 'tools/list') {
      return rpc(body.id, { tools: options.tools ?? tools });
    }
    if (body.method === 'resources/list') {
      return rpc(body.id, {
        resources: options.resource === null
          ? []
          : [{
              uri: WHO_YOU_MCP_RESOURCE_URI,
              name: 'who-you-service-capabilities',
              mimeType: 'application/json',
            }],
      });
    }
    if (body.method === 'resources/read') {
      return rpc(body.id, {
        contents: [{
          uri: WHO_YOU_MCP_RESOURCE_URI,
          mimeType: 'application/json',
          text: JSON.stringify(options.resource ?? manifest),
        }],
      });
    }
    if (body.method === 'tools/call' && body.params?.name === 'whoyou_whoami') {
      return rpc(body.id, {
        content: [{ type: 'text', text: 'identity' }],
        structuredContent: options.whoami ?? {
          accountId: ACCOUNT,
          consumerId: ACCOUNT,
          scopes: ['whoyou.read'],
        },
      });
    }
    return rpc(body.id, { isError: true });
  });

const discover = (
  fetchImpl: jest.Mock,
  overrides: { credential?: IssuedAccountServiceCredential; accountId?: string; liveSession?: boolean } = {},
) => {
  const accountId = overrides.accountId ?? ACCOUNT;
  const stored = { schemaVersion: 1 as const, account: { id: accountId, username:'fixture' }, sessionToken: SESSION, expiresAt: '2099-01-01T00:00:00.000Z', savedAt:'2026-11-24T00:00:00.000Z' };
  const catalogFetch = jest.fn(async () => json(200, { services:[{ appId:APP_ID, serviceId:'who-you', projectId:'independent-mail', name:'Fixture Mail', type:'mcp', protocol:{name:'mcp',version:'2026-07-28',endpoint:MCP_URL},resource:MCP_URL,scopes:['whoyou.read'],revision:1,manifestRevision:1}]})) as unknown as typeof fetch;
  return discoverAccountMcpService({accountId,serviceId:accountServiceIdentity({appId:APP_ID,serviceId:'who-you',resource:MCP_URL})},{
    loadSession: overrides.liveSession ? () => cloudSessionStore.load() : async () => stored,
    currentCloud: overrides.liveSession ? () => ({status:useCloudAccountStore.getState().status,accountId:useCloudAccountStore.getState().account?.id ?? null}) : () => ({status:'signed_in',accountId}),
    catalog: new AccountServiceCatalogCache({baseUrl:CLOUD_AUTH_URL,fetchImpl:catalogFetch}),
    baseUrl:CLOUD_AUTH_URL,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    credentialRequester: jest.fn(async () => overrides.credential ?? credential),
  });
};
describe('Who You trusted MCP service discovery', () => {
  it('maps the real read tools and verified v1 resource into a trusted read-only catalog', async () => {
    const fetchImpl = fixtureFetch();
    const snapshot = await discover(fetchImpl);
    expect(snapshot.service.name).toBe('Fixture Mail');
    expect(snapshot.service.id).toBe(accountServiceIdentity({appId:APP_ID,serviceId:'who-you',resource:MCP_URL}));
    expect(snapshot.tools.map((entry) => entry.name)).toEqual([
      'whoyou_mail_search',
      'whoyou_mail_message_get',
    ]);
    expect(snapshot.tools[0].parameters).toEqual(tools[2].inputSchema);
    expect(snapshot.tools[1].parameters).toEqual(tools[3].inputSchema);
    expect(snapshot.tools[0].sensitiveResult).toBe('mail-search');
    expect(snapshot.tools[1].sensitiveResult).toBe('mail-body');
    expect(snapshot.service.capabilities).toEqual([{
      id: 'who-you.mail.read',
      name: 'who-you.mail.read',
      description: 'who-you.mail.read description',
      toolNames: ['whoyou_mail_search', 'whoyou_mail_message_get'],
    }]);
    expect(snapshot.degradation).toBe('none');
    expect(snapshot.initialToolNames).toEqual(['whoyou_mail_search']);
    expect(snapshot.expiresAt).toBe(Date.parse(credential.expiresAt));

    // The manifest is only read on the authenticated MCP surface; the session
    // token never reaches the MCP endpoint.
    const mcpCalls = fetchImpl.mock.calls.filter(
      (entry: [string, RequestInit?]) => entry[0] === MCP_URL,
    );
    expect(mcpCalls.length).toBeGreaterThan(0);
    for (const [, init] of mcpCalls as [string, RequestInit][]) {
      expect((init.headers as Record<string, string>).authorization)
        .toBe('Bearer who-you-read-token');
      expect(String(init.body)).not.toContain(SESSION);
      expect(String(init.body)).not.toContain('who-you-read-token');
    }
    expect(snapshot.tools.map((entry) => entry.name))
      .not.toContain('whoyou_mail_send');
    expect(snapshot.tools.map((entry) => entry.name))
      .not.toContain('whoyou_mailbox_delete');
  });

  it('degrades flat for a missing or unknown resource without inventing capabilities', async () => {
    for (const [resource, degradation] of [
      [null, 'no-resource'],
      [{ schema: 'mira.service-capabilities/v9' }, 'unknown-schema'],
      [{ ...manifest, service: { ...manifest.service, id: 'other' } }, 'identity-mismatch'],
    ] as const) {
      const snapshot = await discover(fixtureFetch({ resource }));
      expect(snapshot.degradation).toBe(degradation);
      expect(snapshot.service.capabilities).toBeUndefined();
      expect(snapshot.tools.map((entry) => entry.name)).toEqual([
        'whoyou_mail_search',
        'whoyou_mail_message_get',
      ]);
    }
  });

  it('rejects an identity or credential bound to another Cloud account', async () => {
    await expect(discover(fixtureFetch({
      whoami: {
        accountId: 'another',
        consumerId: 'another',
        scopes: ['whoyou.read'],
      },
    }))).rejects.toMatchObject({ kind: 'invalid_response' });

    await expect(discover(fixtureFetch(), {
      credential: {
        ...credential,
        claims: { ...credential.claims, accountId: 'another' },
      },
    })).rejects.toMatchObject({ code: 'SERVICE_CREDENTIAL_IDENTITY_MISMATCH' });

    await expect(discover(fixtureFetch(), {
      credential: {
        ...credential,
        claims: {
          ...credential.claims,
          scopes: ['whoyou.read', 'whoyou.mail.write'] as unknown as
            IssuedAccountServiceCredential['claims']['scopes'],
        },
      },
    })).rejects.toMatchObject({ code: 'SERVICE_CREDENTIAL_SCOPE_MISMATCH' });
  });

  it('does not expose mail writes when the real service omits both approved readers', async () => {
    const snapshot = await discover(fixtureFetch({
      tools: tools.filter(entry => !['whoyou_mail_search', 'whoyou_mail_message_get'].includes(entry.name)),
    }));
    expect(snapshot.tools).toEqual([]);
  });

  it('fails closed when the declared mail readers lack the identity proof tool', async () => {
    await expect(discover(fixtureFetch({
      tools: tools.filter(entry => entry.name !== 'whoyou_whoami'),
    }))).rejects.toMatchObject({ code: 'SERVICE_MAIL_IDENTITY_REQUIRED' });
  });

  it('omits permitted tools that the real tools/list no longer declares', async () => {
    const snapshot = await discover(fixtureFetch({
      tools: tools.filter((entry) => entry.name !== 'whoyou_mail_message_get'),
    }));
    expect(snapshot.tools.map((entry) => entry.name)).toEqual(['whoyou_mail_search']);
    expect(snapshot.service.capabilities).toEqual([{
      id: 'who-you.mail.read',
      name: 'who-you.mail.read',
      description: 'who-you.mail.read description',
      toolNames: ['whoyou_mail_search'],
    }]);
  });
  it('rejects an old session after a same-account re-login or account change', async () => {
    const previous = useCloudAccountStore.getState();
    const storeSession = {
      schemaVersion: 1 as const,
      account: { id: ACCOUNT, username: 'fixture' },
      sessionToken: SESSION,
      expiresAt: '2099-01-01T00:00:00.000Z',
      savedAt: '2026-11-24T00:00:00.000Z',
    };
    const load = jest.spyOn(cloudSessionStore, 'load').mockResolvedValue(storeSession);
    useCloudAccountStore.setState({
      status: 'signed_in',
      account: storeSession.account,
    });
    try {
      const snapshot = await discover(fixtureFetch(), {liveSession:true});
      await expect(snapshot.assertCurrent?.()).resolves.toBeUndefined();
      load.mockResolvedValue({ ...storeSession, sessionToken: 'new-session-same-account' });
      await expect(snapshot.assertCurrent?.()).rejects.toMatchObject({
        code: 'SERVICE_REGISTRY_SESSION_CHANGED',
      });
      load.mockResolvedValue({ ...storeSession, expiresAt: '2020-01-01T00:00:00.000Z' });
      await expect(snapshot.assertCurrent?.()).rejects.toMatchObject({
        code: 'SERVICE_REGISTRY_SESSION_EXPIRED',
      });
      load.mockResolvedValue(storeSession);
      useCloudAccountStore.setState({ account: { id: 'account-2', username: 'other' } });
      await expect(snapshot.assertCurrent?.()).rejects.toMatchObject({
        code: 'SERVICE_REGISTRY_ACCOUNT_CHANGED',
      });
    } finally {
      load.mockRestore();
      useCloudAccountStore.setState(previous);
    }
  });

});
