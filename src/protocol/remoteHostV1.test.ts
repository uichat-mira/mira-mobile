import {
  normalizeHostUrl,
  parsePairingUri,
  parseRemoteManifest,
  parseRemoteThread,
  parseRemoteToolGatewayStreamEvent,
  parseRemoteToolInvocationProjection,
  parseRemoteToolManifest,
  unwrapApiEnvelope,
} from './remoteHostV1';

describe('remoteHostV1 protocol', () => {
  it('parses the desktop pairing URI without inventing fields', () => {
    const uri =
      'mira://pair?host=https%3A%2F%2Fmira-host.example.ts.net&challenge=challenge-1&code=ab23cd45&version=1';

    expect(parsePairingUri(uri)).toEqual({
      version: 1,
      hostUrl: 'https://mira-host.example.ts.net',
      challengeId: 'challenge-1',
      code: 'AB23CD45',
    });
  });

  it('rejects insecure production host addresses', () => {
    expect(() => normalizeHostUrl('http://100.64.0.1:8787')).toThrow(
      'Mira Host must use HTTPS',
    );
    expect(
      normalizeHostUrl('http://127.0.0.1:8787/', {
        allowInsecureDevelopment: true,
      }),
    ).toBe('http://127.0.0.1:8787');
  });

  it('rejects pairing hosts that only resemble the pair endpoint', () => {
    expect(() =>
      parsePairingUri(
        'mira://pair.evil?host=https%3A%2F%2Fmira.example.ts.net&challenge=challenge-1&code=ABCD2345&version=1',
      ),
    ).toThrow('Pairing link must start with mira://pair');
  });

  it('validates the manifest reconnect and scope contract', () => {
    expect(
      parseRemoteManifest({
        protocolVersion: 1,
        device: {
          id: 'device-1',
          name: 'K70',
          platform: 'android',
          scopes: ['threads:read', 'messages:read'],
        },
        routes: {
          threads: ['GET /threads'],
          messages: ['GET /threads/:id/messages'],
          agent: [],
          tools: ['GET /remote/v1/tools'],
          artifacts: [],
        },
        reconnect: {
          mode: 'canonical-state-replay',
          eventCursor: false,
        },
        serverTime: '2026-08-01T10:00:00.000Z',
      }),
    ).toMatchObject({
      protocolVersion: 1,
      device: { id: 'device-1' },
      routes: { tools: ['GET /remote/v1/tools'] },
      reconnect: { eventCursor: false },
    });
  });

  it('keeps Remote V1 compatible when an older Host does not advertise tool routes', () => {
    expect(
      parseRemoteManifest({
        protocolVersion: 1,
        device: {
          id: 'device-legacy',
          name: 'Legacy phone',
          platform: 'android',
          scopes: ['threads:read'],
        },
        routes: {
          threads: ['GET /threads'],
          messages: [],
          agent: [],
          artifacts: [],
        },
        reconnect: {
          mode: 'canonical-state-replay',
          eventCursor: false,
        },
        serverTime: '2026-09-07T00:00:00.000Z',
      }),
    ).toMatchObject({
      routes: { tools: [] },
    });
  });

  it('parses the mobile-safe remote tool manifest', () => {
    expect(
      parseRemoteToolManifest({
        id: 'web_search',
        name: 'web_search',
        description: 'Search the public web',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
        },
        destructive: false,
        requiresApproval: false,
      }),
    ).toMatchObject({
      id: 'web_search',
      name: 'web_search',
      requiresApproval: false,
    });
  });

  it('rejects malformed remote tool capability flags', () => {
    expect(() =>
      parseRemoteToolManifest({
        id: 'terminal_session',
        name: 'terminal_session',
        description: 'Run a command',
        parameters: { type: 'object' },
        destructive: 'yes',
        requiresApproval: true,
      }),
    ).toThrow('capability flags must be booleans');
  });

  it('rejects remote tool names that are not model-safe', () => {
    for (const name of ['mcp:terminal', 'tool name', 'a'.repeat(65)]) {
      expect(() =>
        parseRemoteToolManifest({
          id: 'tool-id',
          name,
          description: 'Unsafe alias',
          parameters: { type: 'object' },
          destructive: false,
          requiresApproval: false,
        }),
      ).toThrow('Remote tool name must match ^[A-Za-z0-9_-]{1,64}$');
    }
  });

  it('parses approval and completed tool stream events', () => {
    expect(
      parseRemoteToolGatewayStreamEvent({
        type: 'tool:approval_required',
        invocationId: 'inv-1',
        message: 'Approval required',
        scope: 'terminal',
      }),
    ).toEqual({
      type: 'tool:approval_required',
      invocationId: 'inv-1',
      message: 'Approval required',
      scope: 'terminal',
    });

    expect(
      parseRemoteToolGatewayStreamEvent({
        type: 'tool:complete',
        invocation: {
          invocationId: 'inv-2',
          toolId: 'web_search',
          status: 'completed',
          content: 'done',
        },
      }),
    ).toEqual({
      type: 'tool:complete',
      invocation: {
        invocationId: 'inv-2',
        toolId: 'web_search',
        status: 'completed',
        content: 'done',
      },
    });
  });

  it('parses a safe terminal tool gateway error event', () => {
    expect(
      parseRemoteToolGatewayStreamEvent({
        type: 'tool:error',
        code: 'REMOTE_TOOL_REQUEST_FAILED',
        message: 'Remote tool request failed',
      }),
    ).toEqual({
      type: 'tool:error',
      code: 'REMOTE_TOOL_REQUEST_FAILED',
      message: 'Remote tool request failed',
    });
  });

  it('rejects unsupported remote tool invocation statuses', () => {
    expect(() =>
      parseRemoteToolInvocationProjection({
        invocationId: 'inv-1',
        toolId: 'web_search',
        status: 'running',
      }),
    ).toThrow('Unsupported remote tool invocation status');
  });

  it('normalizes canonical thread timestamps as strings', () => {
    expect(
      parseRemoteThread({
        id: 'thread-1',
        title: 'Mira',
        modelName: null,
        workspaceId: null,
        status: 'active',
        createdAt: '2026-08-01T09:00:00.000Z',
        updatedAt: '2026-08-01T10:00:00.000Z',
        messageCount: 2,
        lastMessage: 'hello',
      }),
    ).toEqual(
      expect.objectContaining({
        id: 'thread-1',
        updatedAt: '2026-08-01T10:00:00.000Z',
        messageCount: 2,
      }),
    );
  });

  it('unwraps only successful Mira API envelopes', () => {
    expect(
      unwrapApiEnvelope({ success: true, data: { value: 1 } }, data => data),
    ).toEqual({ value: 1 });
    expect(() =>
      unwrapApiEnvelope(
        { success: false, message: 'denied', code: 'FORBIDDEN' },
        data => data,
      ),
    ).toThrow('denied');
  });
});
