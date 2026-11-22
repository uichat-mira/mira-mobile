import { WhoYouMcpClient } from './whoYouMcpClient';
import type { IssuedWhoYouReadCredential } from './whoYouCredential';

const MCP_URL = 'https://who-you.example.test/mcp';
const METADATA_URL =
  'https://who-you.example.test/.well-known/oauth-protected-resource/mcp';
const CLOUD_AUTH_URL = 'https://cloud-auth.example.test';
const SESSION = 'mcs_v1.session-id.session-secret';
const READ_TOKEN = 'who-you-read-token';

const credential: IssuedWhoYouReadCredential = {
  token: READ_TOKEN,
  tokenType: 'Bearer',
  audience: 'mira:who-you',
  expiresAt: '2026-11-22T00:05:00.000Z',
  claims: {
    accountId: 'account-1',
    deviceId: 'device-mobile-1',
    scopes: ['whoyou.read'],
    expiresAt: '2026-11-22T00:05:00.000Z',
  },
};

const metadata = {
  resource: MCP_URL,
  authorization_servers: [CLOUD_AUTH_URL],
  scopes_supported: ['whoyou.read'],
  bearer_methods_supported: ['header'],
};

const whoami = {
  accountId: 'account-1',
  consumerId: 'account-1',
  scopes: ['whoyou.read'],
};

const identities = {
  identities: [
    {
      mailboxId: 'mailbox-gmail-1',
      address: 'alice@example.test',
      kind: 'third_party',
      provider: 'gmail',
      status: 'active',
      credentialStatus: 'active',
      quotaBytes: 1000,
      bytesUsed: 20,
      messageCount: 3,
      createdAt: 1_790_000_000_000,
    },
    {
      mailboxId: 'mailbox-own-1',
      address: 'alice@tomlab.cn',
      kind: 'own_domain',
      provider: null,
      status: 'active',
      credentialStatus: null,
      quotaBytes: 1000,
      bytesUsed: 0,
      messageCount: 0,
      createdAt: 1_790_000_000_000,
    },
  ],
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const sseResponse = (value: unknown) =>
  new Response(`event: message\ndata: ${JSON.stringify(value)}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

const rpcResult = (id: unknown, result: unknown) =>
  jsonResponse(200, { jsonrpc: '2.0', id, result });

const workingFetch = (
  overrides: {
    metadata?: unknown;
    whoamiContent?: unknown;
    identitiesContent?: unknown;
    mcpStatus?: number;
  } = {},
) =>
  jest.fn(async (url: string, init?: RequestInit) => {
    if (url === METADATA_URL) {
      return jsonResponse(200, overrides.metadata ?? metadata);
    }
    if (url !== MCP_URL) {
      throw new Error(`unexpected URL ${url}`);
    }
    if (overrides.mcpStatus) {
      return jsonResponse(overrides.mcpStatus, { error: 'unauthorized' });
    }
    const body = JSON.parse(String(init?.body)) as {
      id?: number;
      method: string;
      params?: { name?: string };
    };
    if (body.method === 'initialize') {
      return rpcResult(body.id, {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'who-you', version: 'test' },
      });
    }
    if (body.method === 'notifications/initialized') {
      return new Response(null, { status: 202 });
    }
    if (body.method === 'tools/call' && body.params?.name === 'whoyou_whoami') {
      return rpcResult(body.id, {
        content: [{ type: 'text', text: 'identity' }],
        structuredContent: overrides.whoamiContent ?? whoami,
      });
    }
    if (
      body.method === 'tools/call' &&
      body.params?.name === 'whoyou_mailbox_list'
    ) {
      return sseResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          content: [{ type: 'text', text: 'mailboxes' }],
          structuredContent: overrides.identitiesContent ?? identities,
        },
      });
    }
    throw new Error(`unexpected method ${body.method}`);
  });

const client = (fetchImpl: jest.Mock, requester = jest.fn(async () => credential)) =>
  new WhoYouMcpClient({
    mcpUrl: MCP_URL,
    baseUrl: CLOUD_AUTH_URL,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    credentialRequester: requester,
  });

describe('Who You read-only MCP client', () => {
  it('discovers the resource, then uses only the short-lived read bearer for whoami and mailbox list', async () => {
    const fetchMock = workingFetch();
    const requester = jest.fn(async () => credential);
    const snapshot = await client(fetchMock, requester).load({
      sessionToken: SESSION,
      accountId: 'account-1',
    });

    expect(snapshot.identity).toEqual(whoami);
    expect(snapshot.mailboxes).toEqual([
      {
        ...identities.identities[0],
        createdAt: new Date(1_790_000_000_000).toISOString(),
      },
      {
        ...identities.identities[1],
        createdAt: new Date(1_790_000_000_000).toISOString(),
      },
    ]);
    expect(requester).toHaveBeenCalledWith(SESSION, 'account-1', {
      baseUrl: CLOUD_AUTH_URL,
      fetchImpl: fetchMock,
      now: expect.any(Function),
      timeoutMs: undefined,
    });

    type CapturedInit = (RequestInit & { redirect?: string }) | undefined;
    const [metadataCall, ...mcpCalls] = fetchMock.mock.calls as unknown as [
      string,
      CapturedInit,
    ][];
    expect(metadataCall[0]).toBe(METADATA_URL);
    expect(
      (metadataCall[1]?.headers as Record<string, string> | undefined)
        ?.authorization,
    ).toBeUndefined();
    expect(metadataCall[1]?.redirect).toBe('error');

    const methods: string[] = [];
    const toolNames: string[] = [];
    for (const [url, init] of mcpCalls) {
      expect(url).toBe(MCP_URL);
      expect(init?.redirect).toBe('error');
      expect((init?.headers as Record<string, string>).authorization).toBe(
        `Bearer ${READ_TOKEN}`,
      );
      expect(String(init?.body)).not.toContain(SESSION);
      expect(String(init?.body)).not.toContain(READ_TOKEN);
      const body = JSON.parse(String(init?.body)) as {
        method: string;
        params?: { name?: string };
      };
      methods.push(body.method);
      if (body.method === 'tools/call' && body.params?.name) {
        toolNames.push(body.params.name);
      }
    }

    expect(methods).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/call',
      'tools/call',
    ]);
    expect(toolNames).toEqual(['whoyou_whoami', 'whoyou_mailbox_list']);
    expect(toolNames).not.toContain('whoyou_mailbox_provision');
    expect(toolNames).not.toContain('whoyou_mail_send');
  });

  it('rejects a different discovered resource before issuing a credential', async () => {
    const fetchMock = workingFetch({
      metadata: { ...metadata, resource: 'https://evil.example/mcp' },
    });
    const requester = jest.fn(async () => credential);
    await expect(
      client(fetchMock, requester).load({
        sessionToken: SESSION,
        accountId: 'account-1',
      }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });
    expect(requester).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when discovery omits the read scope or the Cloud Auth issuer', async () => {
    for (const broken of [
      { ...metadata, scopes_supported: [] },
      { ...metadata, authorization_servers: ['https://elsewhere.example'] },
      { ...metadata, bearer_methods_supported: ['body'] },
    ]) {
      await expect(
        client(workingFetch({ metadata: broken })).load({
          sessionToken: SESSION,
          accountId: 'account-1',
        }),
      ).rejects.toMatchObject({ kind: 'invalid_response' });
    }
  });

  it('maps MCP 401 to an unauthorized read credential and a tool error to a safe code', async () => {
    await expect(
      client(workingFetch({ mcpStatus: 401 })).load({
        sessionToken: SESSION,
        accountId: 'account-1',
      }),
    ).rejects.toMatchObject({ kind: 'unauthorized' });

    // whoami succeeds, then mailbox list reports an explicit tool error.
    const withToolError = jest.fn(
      async (url: string, init?: RequestInit) => {
        if (url === METADATA_URL) return jsonResponse(200, metadata);
        const body = JSON.parse(String(init?.body)) as {
          id?: number;
          method: string;
          params?: { name?: string };
        };
        if (body.method === 'initialize') {
          return rpcResult(body.id, { protocolVersion: '2025-06-18' });
        }
        if (body.method === 'notifications/initialized') {
          return new Response(null, { status: 202 });
        }
        if (body.params?.name === 'whoyou_whoami') {
          return rpcResult(body.id, { structuredContent: whoami });
        }
        return rpcResult(body.id, {
          isError: true,
          structuredContent: { error: 'insufficient_scope' },
        });
      },
    );
    await expect(
      client(withToolError).load({
        sessionToken: SESSION,
        accountId: 'account-1',
      }),
    ).rejects.toMatchObject({
      kind: 'rejected',
      code: 'insufficient_scope',
    });
  });

  it('rejects an identity or mailbox list bound to another account or an unknown shape', async () => {
    await expect(
      client(
        workingFetch({
          whoamiContent: { ...whoami, consumerId: 'another-account' },
        }),
      ).load({ sessionToken: SESSION, accountId: 'account-1' }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });

    await expect(
      client(
        workingFetch({
          identitiesContent: {
            identities: [{ ...identities.identities[0], provider: 'unknown' }],
          },
        }),
      ).load({ sessionToken: SESSION, accountId: 'account-1' }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});
