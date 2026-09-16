import type { RemoteJsonRequest } from './remoteHttp';
import { RemoteHostError } from './remoteHttp';
import { RemoteMiraHostClient, type PendingPairing } from './remoteMiraHost';
import type { PostSseRequest, PostSseSession } from './postSse';
import { MemoryDeviceCredentialStore } from '../security/deviceCredentialStore';
import type { RemoteRelayEndpoint } from '../protocol/remotePairingV1';

type JsonTransport = <T>(request: RemoteJsonRequest<T>) => Promise<T>;
type RelayJsonTransport = <T>(
  relay: RemoteRelayEndpoint,
  request: RemoteJsonRequest<T>,
) => Promise<T>;

const relay: RemoteRelayEndpoint = {
  endpoint: 'https://relay.tomz.io',
  relayId: 'relay_1234567890abcdef',
  token: 'r'.repeat(43),
};

const pending: PendingPairing = {
  descriptor: {
    version: 1,
    hostUrl: 'https://mira.example.ts.net',
    relay: null,
    challengeId: 'challenge-1',
    code: 'ABCD2345',
  },
  transport: 'direct',
  claimId: 'claim-1',
  pollToken: 'poll-token',
  expiresAt: '2026-08-02T00:05:00.000Z',
};

const pollPayload = {
  status: 'approved',
  expiresAt: pending.expiresAt,
  deviceId: 'device-1',
  scopes: ['threads:read'],
  credential: 'mira_device_device-1.secret',
};

const manifestPayload = {
  protocolVersion: 1,
  device: {
    id: 'device-1',
    name: 'Android phone',
    platform: 'android',
    scopes: ['threads:read'],
  },
  routes: {
    threads: ['GET /threads'],
    messages: [],
    agent: [],
    tools: [],
    artifacts: [],
  },
  reconnect: {
    mode: 'canonical-state-replay',
    eventCursor: false,
  },
  serverTime: '2026-08-02T00:00:00.000Z',
};

const createdThreadPayload = {
  id: 'thread-new',
  title: '新对话',
  modelName: null,
  workspaceId: null,
  knowledgeBaseId: null,
  roleId: null,
  agentEnabled: false,
  status: 'active',
  createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z',
  messageCount: 0,
};

const pairingDescriptor = {
  version: 1 as const,
  hostUrl: 'https://mira.example.ts.net',
  relay,
  challengeId: 'challenge-1',
  code: 'ABCD2345',
};

const claimPayload = {
  claimId: 'claim-1',
  pollToken: 'poll-token',
  status: 'claimed' as const,
  expiresAt: '2026-08-02T00:05:00.000Z',
};

describe('RemoteMiraHostClient pairing credential retention', () => {
  it('persists the one-time credential before manifest verification', async () => {
    const store = new MemoryDeviceCredentialStore();
    const transport = async <T>(request: RemoteJsonRequest<T>): Promise<T> => {
      if (request.path.endsWith('/poll')) {
        return request.parse(pollPayload);
      }
      expect((await store.load())?.credential).toBe(pollPayload.credential);
      return request.parse(manifestPayload);
    };
    const client = new RemoteMiraHostClient(store, transport);

    await client.pollPairing(pending);

    expect(await store.load()).toMatchObject({
      hostUrl: pending.descriptor.hostUrl,
      relay: null,
      credential: pollPayload.credential,
      deviceId: 'device-1',
      scopes: ['threads:read'],
    });
    await expect(client.getStoredHostUrl()).resolves.toBe(
      pending.descriptor.hostUrl,
    );
  });

  it('keeps the credential when manifest verification has a network failure', async () => {
    const store = new MemoryDeviceCredentialStore();
    const transport = async <T>(request: RemoteJsonRequest<T>): Promise<T> => {
      if (request.path.endsWith('/poll')) {
        return request.parse(pollPayload);
      }
      throw new RemoteHostError('NETWORK_ERROR', 'offline');
    };
    const client = new RemoteMiraHostClient(store, transport);

    await expect(client.pollPairing(pending)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    expect(await store.load()).toMatchObject({
      credential: pollPayload.credential,
      deviceId: 'device-1',
    });
  });

  it('clears a credential explicitly rejected by the Host', async () => {
    const store = new MemoryDeviceCredentialStore();
    const transport = async <T>(request: RemoteJsonRequest<T>): Promise<T> => {
      if (request.path.endsWith('/poll')) {
        return request.parse(pollPayload);
      }
      throw new RemoteHostError('HTTP_403', 'revoked', 403);
    };
    const client = new RemoteMiraHostClient(store, transport);

    await expect(client.pollPairing(pending)).rejects.toMatchObject({
      status: 403,
    });
    await expect(store.load()).resolves.toBeNull();
  });
});

describe('RemoteMiraHostClient transport selection', () => {
  it('prefers Relay for pairing and reports the selected transport', async () => {
    const store = new MemoryDeviceCredentialStore();
    const directMock = jest.fn();
    const direct: JsonTransport = async request => {
      directMock(request);
      return request.parse({ status: 'ok' });
    };
    const relayJsonMock = jest.fn();
    const relayJson: RelayJsonTransport = async (endpoint, request) => {
      relayJsonMock(endpoint, request);
      return request.path === '/health'
        ? request.parse({ status: 'ok' })
        : request.parse(claimPayload);
    };
    const client = new RemoteMiraHostClient(store, direct, undefined, relayJson);

    await expect(
      client.claimPairing(pairingDescriptor, {
        name: 'Android phone',
        platform: 'android',
      }),
    ).resolves.toMatchObject({ ...claimPayload, transport: 'relay' });
    expect(directMock).not.toHaveBeenCalled();
    expect(relayJsonMock.mock.calls.map(call => call[1].path)).toEqual([
      '/health',
      '/remote/pairing/claim',
    ]);
    expect(relayJsonMock.mock.calls[1][1].body).toMatchObject({ transport: 'relay' });
  });

  it('falls back to Direct only when the Relay preflight fails', async () => {
    const store = new MemoryDeviceCredentialStore();
    const directMock = jest.fn();
    const direct: JsonTransport = async request => {
      directMock(request);
      return request.path === '/health'
        ? request.parse({ status: 'ok' })
        : request.parse(claimPayload);
    };
    const relayJsonMock = jest.fn();
    const relayJson: RelayJsonTransport = async (endpoint, request) => {
      relayJsonMock(endpoint, request);
      throw new RemoteHostError('RELAY_NETWORK_ERROR', 'relay unavailable');
    };
    const client = new RemoteMiraHostClient(store, direct, undefined, relayJson);

    await expect(
      client.claimPairing(pairingDescriptor, {
        name: 'Android phone',
        platform: 'android',
      }),
    ).resolves.toMatchObject({ ...claimPayload, transport: 'direct' });
    expect(relayJsonMock).toHaveBeenCalledTimes(1);
    expect(directMock.mock.calls.map(call => call[0].path)).toEqual([
      '/health',
      '/remote/pairing/claim',
    ]);
    expect(directMock.mock.calls[1][0].body).toMatchObject({ transport: 'direct' });
  });

  it('does not retry a dispatched Relay claim through Direct', async () => {
    const store = new MemoryDeviceCredentialStore();
    const directMock = jest.fn();
    const direct: JsonTransport = async request => {
      directMock(request);
      return request.parse(claimPayload);
    };
    const relayJsonMock = jest.fn();
    const relayJson: RelayJsonTransport = async (endpoint, request) => {
      relayJsonMock(endpoint, request);
      if (request.path === '/health') return request.parse({ status: 'ok' });
      throw new RemoteHostError('RELAY_DISCONNECTED', 'relay disconnected');
    };
    const client = new RemoteMiraHostClient(store, direct, undefined, relayJson);

    await expect(
      client.claimPairing(pairingDescriptor, {
        name: 'Android phone',
        platform: 'android',
      }),
    ).rejects.toMatchObject({ code: 'PAIRING_CLAIM_UNCERTAIN' });
    expect(relayJsonMock).toHaveBeenCalledTimes(2);
    expect(directMock).not.toHaveBeenCalled();
  });

  it('falls back from Direct network failure to Relay for idempotent JSON requests', async () => {
    const store = new MemoryDeviceCredentialStore();
    await store.save({
      hostUrl: 'https://mira.example.ts.net',
      relay,
      credential: 'mira_device_device-1.secret',
      deviceId: 'device-1',
      scopes: ['threads:read'],
      savedAt: '2026-08-02T00:00:00.000Z',
    });

    const directMock = jest.fn();
    const direct: JsonTransport = async _request => {
      directMock();
      throw new RemoteHostError('NETWORK_ERROR', 'tailnet unavailable');
    };
    const relayJsonMock = jest.fn();
    const relayJson: RelayJsonTransport = async (_relay, request) => {
      relayJsonMock(_relay, request);
      if (request.path === '/remote/v1/manifest') {
        return request.parse(manifestPayload);
      }
      return request.parse([]);
    };
    const client = new RemoteMiraHostClient(
      store,
      direct,
      undefined,
      relayJson,
    );

    await expect(client.restoreConnection()).resolves.toMatchObject({
      manifest: manifestPayload,
    });
    expect(directMock).toHaveBeenCalledTimes(1);
    expect(relayJsonMock).toHaveBeenCalledTimes(1);
  });

  it('selects a reachable transport and sends an empty body for untitled thread creation', async () => {
    const store = new MemoryDeviceCredentialStore();
    await store.save({
      hostUrl: 'https://mira.example.ts.net',
      relay,
      credential: 'mira_device_device-1.secret',
      deviceId: 'device-1',
      scopes: ['threads:read', 'messages:write'],
      savedAt: '2026-08-29T00:00:00.000Z',
    });

    const directMock = jest.fn();
    const direct: JsonTransport = async request => {
      directMock(request);
      throw new RemoteHostError('NETWORK_ERROR', 'tailnet unavailable');
    };
    const relayJsonMock = jest.fn();
    const relayJson: RelayJsonTransport = async (_relay, request) => {
      relayJsonMock(_relay, request);
      if (request.path === '/remote/v1/manifest') {
        return request.parse(manifestPayload);
      }
      return request.parse(createdThreadPayload);
    };
    const client = new RemoteMiraHostClient(
      store,
      direct,
      undefined,
      relayJson,
    );

    await expect(client.createThread()).resolves.toMatchObject({
      id: 'thread-new',
      title: '新对话',
    });
    expect(directMock).toHaveBeenCalledTimes(1);
    expect(relayJsonMock.mock.calls.map(call => call[1].path)).toEqual([
      '/remote/v1/manifest',
      '/threads',
    ]);
    expect(relayJsonMock.mock.calls[1][1].body).toEqual({});
  });

  it('does not replay an uncertain dispatched thread create through Relay', async () => {
    const store = new MemoryDeviceCredentialStore();
    await store.save({
      hostUrl: 'https://mira.example.ts.net',
      relay,
      credential: 'mira_device_device-1.secret',
      deviceId: 'device-1',
      scopes: ['threads:read', 'messages:write'],
      savedAt: '2026-08-29T00:00:00.000Z',
    });

    const directMock = jest.fn();
    const direct: JsonTransport = async request => {
      directMock(request);
      if (request.path === '/remote/v1/manifest') {
        return request.parse(manifestPayload);
      }
      throw new RemoteHostError('NETWORK_ERROR', 'response lost');
    };
    const relayJsonMock = jest.fn();
    const relayJson: RelayJsonTransport = async (_relay, request) => {
      relayJsonMock(_relay, request);
      return request.parse(createdThreadPayload);
    };
    const client = new RemoteMiraHostClient(
      store,
      direct,
      undefined,
      relayJson,
    );

    await expect(client.createThread()).rejects.toMatchObject({
      code: 'THREAD_CREATE_UNCERTAIN',
    });
    expect(directMock.mock.calls.map(call => call[0].path)).toEqual([
      '/remote/v1/manifest',
      '/threads',
    ]);
    expect(relayJsonMock).not.toHaveBeenCalled();
  });

  it('does not hide Host authorization errors behind Relay fallback', async () => {
    const store = new MemoryDeviceCredentialStore();
    await store.save({
      hostUrl: 'https://mira.example.ts.net',
      relay,
      credential: 'mira_device_device-1.secret',
      deviceId: 'device-1',
      scopes: ['threads:read'],
      savedAt: '2026-08-02T00:00:00.000Z',
    });

    const direct: JsonTransport = async _request => {
      throw new RemoteHostError('HTTP_403', 'revoked', 403);
    };
    const relayJsonMock = jest.fn();
    const relayJson: RelayJsonTransport = async (_relay, request) => {
      relayJsonMock(_relay, request);
      return request.parse(manifestPayload);
    };
    const client = new RemoteMiraHostClient(
      store,
      direct,
      undefined,
      relayJson,
    );

    await expect(client.restoreConnection()).rejects.toMatchObject({ status: 403 });
    expect(relayJsonMock).not.toHaveBeenCalled();
    await expect(store.load()).resolves.toBeNull();
  });
});

describe('RemoteMiraHostClient tool gateway', () => {
  const toolManifestPayload = {
    ...manifestPayload,
    device: {
      ...manifestPayload.device,
      scopes: [
        'threads:read',
        'tools:read',
        'tools:invoke',
        'tools:approve',
        'tools:control',
      ],
    },
    routes: {
      ...manifestPayload.routes,
      tools: [
        'GET /remote/v1/tools',
        'POST /remote/v1/tool-invocations/stream',
        'POST /remote/v1/tool-invocations/:invocationId/approval',
        'POST /remote/v1/tool-invocations/:invocationId/cancel',
      ],
    },
  };

  it('does not clear an existing pairing when the device lacks a tool scope', async () => {
    const store = new MemoryDeviceCredentialStore();
    await store.save({
      hostUrl: 'https://mira.example.ts.net',
      relay: null,
      credential: 'mira_device_device-1.secret',
      deviceId: 'device-1',
      scopes: ['threads:read'],
      savedAt: '2026-09-07T00:00:00.000Z',
    });
    const jsonMock = jest.fn();
    const client = new RemoteMiraHostClient(store, jsonMock as JsonTransport);

    await expect(client.listRemoteTools()).rejects.toMatchObject({
      code: 'REMOTE_SCOPE_REQUIRED',
      status: 403,
    });
    expect(jsonMock).not.toHaveBeenCalled();
    await expect(store.load()).resolves.toMatchObject({
      deviceId: 'device-1',
      scopes: ['threads:read'],
    });
  });

  it('keeps pairing when Host denies only the tool scope', async () => {
    const store = new MemoryDeviceCredentialStore();
    await store.save({
      hostUrl: 'https://mira.example.ts.net',
      relay: null,
      credential: 'mira_device_device-1.secret',
      deviceId: 'device-1',
      scopes: ['threads:read', 'tools:read'],
      savedAt: '2026-09-07T00:00:00.000Z',
    });
    const json: JsonTransport = async _request => {
      throw new RemoteHostError('HTTP_403', 'forbidden', 403);
    };
    const client = new RemoteMiraHostClient(store, json);

    await expect(client.listRemoteTools()).rejects.toMatchObject({
      status: 403,
    });
    await expect(store.load()).resolves.toMatchObject({
      deviceId: 'device-1',
      scopes: ['threads:read', 'tools:read'],
    });
  });

  it('lists tools through the paired-device credential', async () => {
    const store = new MemoryDeviceCredentialStore();
    await store.save({
      hostUrl: 'https://mira.example.ts.net',
      relay: null,
      credential: 'mira_device_device-1.secret',
      deviceId: 'device-1',
      scopes: ['tools:read'],
      savedAt: '2026-09-07T00:00:00.000Z',
    });
    const jsonMock = jest.fn();
    const json: JsonTransport = async request => {
      jsonMock(request);
      if (request.path === '/remote/v1/manifest') {
        return request.parse(toolManifestPayload);
      }
      return request.parse([
        {
          id: 'web_search',
          name: 'web_search',
          description: 'Search the public web',
          parameters: { type: 'object' },
          destructive: false,
          requiresApproval: false,
        },
      ]);
    };
    const client = new RemoteMiraHostClient(store, json);

    await expect(client.listRemoteTools()).resolves.toMatchObject([
      { id: 'web_search', name: 'web_search' },
    ]);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/remote/v1/tools',
        credential: 'mira_device_device-1.secret',
      }),
    );
  });

  it('does not call tool routes that the Host manifest does not advertise', async () => {
    const store = new MemoryDeviceCredentialStore();
    await store.save({
      hostUrl: 'https://mira.example.ts.net',
      relay: null,
      credential: 'mira_device_device-1.secret',
      deviceId: 'device-1',
      scopes: ['tools:read', 'tools:invoke'],
      savedAt: '2026-09-07T00:00:00.000Z',
    });
    const jsonMock = jest.fn();
    const json: JsonTransport = async request => {
      jsonMock(request);
      return request.parse(manifestPayload);
    };
    const sseMock = jest.fn();
    const sse = <T>(request: PostSseRequest<T>): PostSseSession<T> => {
      sseMock(request);
      return {
        abort: jest.fn(),
        events: (async function* () {})(),
      };
    };
    const client = new RemoteMiraHostClient(store, json, sse);

    await expect(client.listRemoteTools()).rejects.toMatchObject({
      code: 'REMOTE_TOOL_ROUTE_UNAVAILABLE',
    });
    expect(jsonMock.mock.calls.map(call => call[0].path)).toEqual([
      '/remote/v1/manifest',
    ]);

    await expect(
      client.openToolInvocation({ toolId: 'web_search', args: {} }),
    ).rejects.toMatchObject({
      code: 'REMOTE_TOOL_ROUTE_UNAVAILABLE',
    });
    expect(sseMock).not.toHaveBeenCalled();
  });

  it('probes a reachable transport before opening the side-effecting tool stream', async () => {
    const store = new MemoryDeviceCredentialStore();
    await store.save({
      hostUrl: 'https://mira.example.ts.net',
      relay: null,
      credential: 'mira_device_device-1.secret',
      deviceId: 'device-1',
      scopes: ['tools:invoke'],
      savedAt: '2026-09-07T00:00:00.000Z',
    });
    const jsonMock = jest.fn();
    const json: JsonTransport = async request => {
      jsonMock(request);
      return request.parse(toolManifestPayload);
    };
    const sseMock = jest.fn();
    const sse = <T>(request: PostSseRequest<T>): PostSseSession<T> => {
      sseMock(request);
      return {
        abort: jest.fn(),
        events: (async function* () {})(),
      };
    };
    const client = new RemoteMiraHostClient(store, json, sse);

    await client.openToolInvocation({
      toolId: 'web_search',
      args: { query: 'mira' },
    });

    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/remote/v1/manifest' }),
    );
    expect(sseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/remote/v1/tool-invocations/stream',
        body: {
          toolId: 'web_search',
          args: { query: 'mira' },
        },
      }),
    );
  });

  it('requires tools:control before cancelling a remote tool invocation', async () => {
    const store = new MemoryDeviceCredentialStore();
    await store.save({
      hostUrl: 'https://mira.example.ts.net',
      relay: null,
      credential: 'mira_device_device-1.secret',
      deviceId: 'device-1',
      scopes: ['tools:read'],
      savedAt: '2026-09-07T00:00:00.000Z',
    });
    const jsonMock = jest.fn();
    const client = new RemoteMiraHostClient(store, jsonMock as JsonTransport);

    await expect(client.cancelToolInvocation('inv-1')).rejects.toMatchObject({
      code: 'REMOTE_SCOPE_REQUIRED',
      status: 403,
    });
    expect(jsonMock).not.toHaveBeenCalled();
  });

  it('rejects malformed tool cancellation responses', async () => {
    const store = new MemoryDeviceCredentialStore();
    await store.save({
      hostUrl: 'https://mira.example.ts.net',
      relay: null,
      credential: 'mira_device_device-1.secret',
      deviceId: 'device-1',
      scopes: ['tools:control'],
      savedAt: '2026-09-07T00:00:00.000Z',
    });
    const json: JsonTransport = async request => {
      if (request.path === '/remote/v1/manifest') {
        return request.parse(toolManifestPayload);
      }
      return request.parse({
        invocationId: 'inv-1',
        status: 'cancelling',
      });
    };
    const client = new RemoteMiraHostClient(store, json);

    await expect(client.cancelToolInvocation('inv-1')).rejects.toThrow(
      'Tool cancellation response is incomplete',
    );
  });

  it('falls back from Direct to Relay for idempotent tool cancellation', async () => {
    const store = new MemoryDeviceCredentialStore();
    await store.save({
      hostUrl: 'https://mira.example.ts.net',
      relay,
      credential: 'mira_device_device-1.secret',
      deviceId: 'device-1',
      scopes: ['tools:control'],
      savedAt: '2026-09-07T00:00:00.000Z',
    });

    const directMock = jest.fn();
    const direct: JsonTransport = async request => {
      directMock(request);
      if (request.path === '/remote/v1/manifest') {
        return request.parse(toolManifestPayload);
      }
      throw new RemoteHostError('NETWORK_ERROR', 'tailnet unavailable');
    };
    const relayJsonMock = jest.fn();
    const relayJson: RelayJsonTransport = async (_relay, request) => {
      relayJsonMock(_relay, request);
      if (request.path === '/remote/v1/manifest') {
        return request.parse(toolManifestPayload);
      }
      return request.parse({
        invocationId: 'inv-1',
        accepted: true,
        status: 'cancelling',
      });
    };
    const client = new RemoteMiraHostClient(
      store,
      direct,
      undefined,
      relayJson,
    );

    await expect(client.cancelToolInvocation('inv-1')).resolves.toEqual({
      invocationId: 'inv-1',
      accepted: true,
      status: 'cancelling',
    });
    expect(directMock.mock.calls.map(call => call[0].path)).toEqual([
      '/remote/v1/manifest',
      '/remote/v1/tool-invocations/inv-1/cancel',
    ]);
    expect(relayJsonMock).toHaveBeenCalledWith(
      relay,
      expect.objectContaining({
        path: '/remote/v1/tool-invocations/inv-1/cancel',
        method: 'POST',
      }),
    );
  });

  it('does not replay an uncertain approved invocation through another transport', async () => {
    const store = new MemoryDeviceCredentialStore();
    await store.save({
      hostUrl: 'https://mira.example.ts.net',
      relay,
      credential: 'mira_device_device-1.secret',
      deviceId: 'device-1',
      scopes: ['tools:approve'],
      savedAt: '2026-09-07T00:00:00.000Z',
    });

    const directMock = jest.fn();
    const direct: JsonTransport = async request => {
      directMock(request);
      if (request.path === '/remote/v1/manifest') {
        return request.parse(toolManifestPayload);
      }
      throw new RemoteHostError('NETWORK_ERROR', 'response lost');
    };
    const relayJsonMock = jest.fn();
    const relayJson: RelayJsonTransport = async (_relay, request) => {
      relayJsonMock(_relay, request);
      return request.parse(toolManifestPayload);
    };
    const client = new RemoteMiraHostClient(
      store,
      direct,
      undefined,
      relayJson,
    );

    await expect(
      client.resolveToolApproval({
        invocationId: 'inv-1',
        decision: 'approved',
        toolId: 'terminal_session',
        args: { command: 'pwd' },
      }),
    ).rejects.toMatchObject({
      code: 'TOOL_APPROVAL_UNCERTAIN',
    });
    expect(directMock.mock.calls.map(call => call[0].path)).toEqual([
      '/remote/v1/manifest',
      '/remote/v1/tool-invocations/inv-1/approval',
    ]);
    expect(relayJsonMock).not.toHaveBeenCalled();
  });
});

describe('RemoteMiraHostClient chat request', () => {
  it('forwards the supplied canonical history in the SSE request body', async () => {
    const store = new MemoryDeviceCredentialStore();
    await store.save({
      hostUrl: 'https://mira.example.ts.net',
      relay: null,
      credential: 'mira_device_device-1.secret',
      deviceId: 'device-1',
      scopes: ['threads:read', 'messages:read', 'messages:write'],
      savedAt: '2026-08-27T00:00:00.000Z',
    });

    const json: JsonTransport = async request => request.parse(manifestPayload);
    const sseMock = jest.fn();
    const sse = <T>(request: PostSseRequest<T>): PostSseSession<T> => {
      sseMock(request);
      return {
        abort: jest.fn(),
        events: (async function* () {})(),
      };
    };
    const client = new RemoteMiraHostClient(store, json, sse);
    await client.restoreConnection();

    await client.sendMessage({
      threadId: 'thread-1',
      messageId: 'user-new',
      content: 'continue',
      messages: [
        {
          id: 'user-old',
          role: 'user',
          parts: [{ type: 'text', text: 'remember this' }],
        },
        {
          id: 'assistant-old',
          role: 'assistant',
          parts: [{ type: 'text', text: 'I remember' }],
        },
        {
          id: 'user-new',
          role: 'user',
          parts: [{ type: 'text', text: 'continue' }],
        },
      ],
    });

    expect(sseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/proxy/chat/default',
        body: expect.objectContaining({
          id: 'thread-1',
          messageId: 'user-new',
          messages: [
            {
              id: 'user-old',
              role: 'user',
              parts: [{ type: 'text', text: 'remember this' }],
            },
            {
              id: 'assistant-old',
              role: 'assistant',
              parts: [{ type: 'text', text: 'I remember' }],
            },
            {
              id: 'user-new',
              role: 'user',
              parts: [{ type: 'text', text: 'continue' }],
            },
          ],
        }),
      }),
    );
  });
});


describe('RemoteMiraHostClient abortable durable reads', () => {
  it('forwards AbortSignal to manifest and Agent Run JSON requests', async () => {
    const store = new MemoryDeviceCredentialStore();
    await store.save({
      hostUrl: 'https://mira.example.ts.net',
      relay: null,
      credential: 'mira_device_device-1.secret',
      deviceId: 'device-1',
      scopes: ['agent:read'],
      savedAt: '2026-09-07T00:00:00.000Z',
    });
    const requests: RemoteJsonRequest<unknown>[] = [];
    const json: JsonTransport = async request => {
      requests.push(request as RemoteJsonRequest<unknown>);
      if (request.path === '/remote/v1/manifest') {
        return request.parse({
          ...manifestPayload,
          device: { ...manifestPayload.device, scopes: ['agent:read'] },
          routes: {
            ...manifestPayload.routes,
            agent: ['GET /agent/runs/:runId'],
          },
        });
      }
      return request.parse({
        id: 'run-1',
        threadId: 'thread-1',
        userId: 1,
        status: 'running',
        traceId: 'trace-1',
        createdAt: '2026-09-07T00:00:00.000Z',
        updatedAt: '2026-09-07T00:00:01.000Z',
      });
    };
    const client = new RemoteMiraHostClient(store, json);
    const controller = new AbortController();

    await client.getManifest(controller.signal);
    await client.getAgentRun('run-1', controller.signal);

    expect(requests).toHaveLength(2);
    expect(requests[0]?.signal).toBe(controller.signal);
    expect(requests[1]?.signal).toBe(controller.signal);
  });
});
