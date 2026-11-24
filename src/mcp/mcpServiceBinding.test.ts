import { McpServiceBinding } from './mcpServiceBinding';
import type { ToolGatewayClient } from '../tools/toolGatewayClient';
import type { WhoYouMcpServiceDiscovery } from './whoYouMcpService';

const executor = (): ToolGatewayClient => ({
  listTools: jest.fn(async () => []),
  callTool: jest.fn(async () => ({ content: 'ok' })),
});

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  service: {
    id: 'fixture-svc',
    name: 'Fixture',
    toolNames: ['fixture_read'],
  },
  tools: [{
    name: 'fixture_read',
    description: 'Read fixture',
    parameters: { type: 'object' },
  }],
  catalogRevision: 'rev-1',
  degradation: 'none' as const,
  accountId: 'account-a',
  initialToolNames: ['fixture_read'],
  expiresAt: 1_000_000,
  bindingKey: 'account-a:instance-1',
  executionGateway: executor(),
  assertCurrent: () => undefined,
  ...overrides,
});

const discovery = (
  snapshots: ReturnType<typeof snapshot>[] = [snapshot()],
): WhoYouMcpServiceDiscovery & { discover: jest.Mock } => {
  let index = 0;
  return {
    discover: jest.fn(async () => {
      const value = snapshots[Math.min(index, snapshots.length - 1)];
      index += 1;
      return value;
    }),
  } as WhoYouMcpServiceDiscovery & { discover: jest.Mock };
};

describe('McpServiceBinding', () => {
  it('reuses valid metadata within the bounded window and refreshes after it', async () => {
    let now = 1_000;
    const adapter = discovery();
    const binding = new McpServiceBinding({
      serviceTypeId: 'fixture-svc',
      discovery: adapter,
      maxAgeMs: 500,
      now: () => now,
    });

    const first = await binding.discover({ accountId: 'account-a' });
    const second = await binding.discover({ accountId: 'account-a' });
    expect(first.status).toBe('ready');
    expect(second.status).toBe('ready');
    if (first.status !== 'ready' || second.status !== 'ready') return;
    expect(second.fromCache).toBe(true);
    expect(second.gateway).toBe(first.gateway);
    expect(adapter.discover).toHaveBeenCalledTimes(1);
    expect(binding.discoveryMetrics).toEqual({ discoveryCount: 1, cacheHits: 1 });

    now += 501;
    const refreshed = await binding.discover({ accountId: 'account-a' });
    expect(refreshed.status).toBe('ready');
    if (refreshed.status !== 'ready') return;
    expect(refreshed.gateway).not.toBe(first.gateway);
    expect(adapter.discover).toHaveBeenCalledTimes(2);
    // The replaced generation cannot execute a previously disclosed tool.
    await expect(first.gateway.callTool({
      callId: 'stale',
      name: 'fixture_read',
      arguments: '{}',
    })).rejects.toMatchObject({ code: 'MCP_SERVICE_UNAUTHORIZED' });
  });

  it('never reuses metadata past its credential/snapshot expiry or account change', async () => {
    let now = 1_000;
    const adapter = discovery([
      snapshot({ expiresAt: 1_100 }),
      snapshot({ expiresAt: 2_000 }),
      snapshot({ expiresAt: 2_000 }),
    ]);
    const binding = new McpServiceBinding({
      serviceTypeId: 'fixture-svc',
      discovery: adapter,
      maxAgeMs: 10_000,
      now: () => now,
    });

    await binding.discover({ accountId: 'account-a' });
    now = 1_101;
    const expired = await binding.discover({ accountId: 'account-a' });
    expect(expired.status).toBe('ready');
    expect(adapter.discover).toHaveBeenCalledTimes(2);

    const otherAccount = await binding.discover({ accountId: 'account-b' });
    expect(otherAccount.status).toBe('ready');
    expect(adapter.discover).toHaveBeenCalledTimes(3);
  });

  it('rejects a binding whose discovered service type does not match its stable type', async () => {
    const binding = new McpServiceBinding({
      serviceTypeId: 'fixture-svc',
      discovery: discovery([snapshot({
        service: {
          id: 'different-service',
          name: 'Different',
          toolNames: ['fixture_read'],
        },
      })]),
    });
    await expect(binding.discover({ accountId: 'account-a' })).resolves.toEqual({
      status: 'degraded',
      serviceTypeId: 'fixture-svc',
      notice: 'mcp-service-degraded',
    });
  });

  it('rejects a cancelled disclosure without touching the execution adapter', async () => {
    const binding = new McpServiceBinding({
      serviceTypeId: 'fixture-svc',
      discovery: discovery(),
    });
    const ready = await binding.discover({ accountId: 'account-a' });
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') return;
    const controller = new AbortController();
    controller.abort();
    await expect(ready.gateway.discloseTools({
      serviceId: 'fixture-svc',
    }, { signal: controller.signal })).rejects.toMatchObject({
      code: 'TOOL_CANCELLED',
    });
    expect(ready.snapshot.executionGateway?.callTool).not.toHaveBeenCalled();
  });

  it('drops only itself when its credential binding no longer validates', async () => {
    let valid = true;
    const adapter = discovery([
      snapshot({
        assertCurrent: () => {
          if (!valid) throw new Error('credential changed');
        },
      }),
    ]);
    const binding = new McpServiceBinding({
      serviceTypeId: 'fixture-svc',
      discovery: adapter,
    });
    const first = await binding.discover({ accountId: 'account-a' });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;

    valid = false;
    // A cached snapshot that no longer validates is dropped, not reused.
    await expect(binding.discover({ accountId: 'account-a' })).resolves.toMatchObject({
      status: 'degraded',
    });
    await expect(first.gateway.callTool({
      callId: 'after-revoke',
      name: 'fixture_read',
      arguments: '{}',
    })).rejects.toMatchObject({ code: 'MCP_SERVICE_UNAUTHORIZED' });
  });
});
