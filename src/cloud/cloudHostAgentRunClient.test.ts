import { RemoteHostError } from '../api/remoteHttp';
import type { RemoteJsonRequest } from '../api/remoteHttp';
import type { RemoteManifest } from '../protocol/remoteHostV1';
import { DurableHostAgentRuntimeAdapter } from '../runtime/durableHostAgentRuntime';
import { CloudHostAgentRunClient } from './cloudHostAgentRunClient';

const now = '2026-11-16T09:00:00.000Z';
const makeRun = (status: string = 'waiting_approval') => ({
  id: 'run-1', threadId: 'thread-1', userId: 1, status,
  traceId: 'trace-1', createdAt: now, updatedAt: now,
  ...(status === 'waiting_approval' ? {
    pendingApproval: {
      id: 'approval-1', runId: 'run-1', stepId: 'step-1',
      toolId: 'terminal_session', reason: 'Approval required', createdAt: now,
    },
  } : {}),
});

const makeManifest = (
  scopes: RemoteManifest['device']['scopes'] = [
    'agent:read', 'agent:approve', 'agent:control',
  ],
) => ({
  protocolVersion: 1,
  device: { id: 'cloud-device', name: 'Cloud Client', platform: 'android', scopes },
  routes: {
    threads: [], messages: [],
    agent: [
      'GET /agent/runs/:runId',
      'POST /agent/runs/:runId/approve',
      'POST /agent/runs/:runId/reject',
      'POST /agent/runs/:runId/cancel',
    ],
    tools: [], artifacts: [],
  },
  reconnect: { mode: 'canonical-state-replay', eventCursor: false },
  serverTime: now,
});

const fixture = (
  scopes?: RemoteManifest['device']['scopes'],
  state = { current: true },
) => {
  const access = {
    target: {
      endpoint: 'https://cloud-relay.tomz.io', room: 'room-1', hostId: 'host-1',
    },
    tickets: { acquireClientTicket: jest.fn(async () => 'transport-ticket') },
  };
  const entry = {
    discover: jest.fn(async () => access),
    assertCurrentAccess: jest.fn((seen: unknown) => {
      if (!state.current || seen !== access) {
        throw new RemoteHostError('CLOUD_RELAY_SESSION_REJECTED', 'stale cloud session');
      }
    }),
  };
  const json = jest.fn(async (_target, _tickets, operation: RemoteJsonRequest<unknown>) => {
    if (operation.path === '/remote/v1/manifest') {
      return operation.parse(makeManifest(scopes));
    }
    if (operation.path?.startsWith('/agent/runs/')) {
      return operation.parse(makeRun(operation.path.endsWith('/cancel')
        ? 'cancelled'
        : operation.path.endsWith('/approve')
          ? 'running'
          : operation.path.endsWith('/reject')
            ? 'blocked' : 'waiting_approval'));
    }
    throw new Error('Unexpected Cloud Agent path ' + operation.path);
  });
  const client = new CloudHostAgentRunClient(
    'account-a', entry as never, json as never, () => state.current,
  );
  return { access, entry, json, client, runtime: new DurableHostAgentRuntimeAdapter(client, 0) };
};

describe('Cloud Host Agent Run transport uses existing durable business runtime', () => {
  it('discovers manifest and reads canonical run without paired credential', async () => {
    const f = fixture();
    const run = await f.runtime.readRun('thread-1', 'run-1');
    expect(run).toMatchObject({
      id: 'run-1', threadId: 'thread-1', status: 'waiting_approval',
    });
    expect(f.json).toHaveBeenCalledTimes(2);
    const calls = f.json.mock.calls;
    expect(calls.map(([, , req]) => req.path)).toEqual([
      '/remote/v1/manifest', '/agent/runs/run-1',
    ]);
    for (const [target, tickets, request] of calls) {
      expect(target).toBe(f.access.target);
      expect(tickets).toBe(f.access.tickets);
      expect(request).not.toHaveProperty('credential');
      expect(request).not.toHaveProperty('headers');
      expect(request.hostUrl).toBe('https://cloud-relay.tomz.io');
      expect(request.allowInsecureDevelopment).toBe(false);
    }
  });

  it('reuses Host Run approval and rejection with exact run ownership', async () => {
    const approve = fixture();
    const approved = await approve.runtime.resolve('thread-1', 'run-1', 'approve');
    expect(approved.status).toBe('running');
    expect(approve.json.mock.calls.at(-1)?.[2]).toMatchObject({
      path: '/agent/runs/run-1/approve', method: 'POST',
    });
    const reject = fixture();
    const rejected = await reject.runtime.resolve('thread-1', 'run-1', 'reject');
    expect(rejected.status).toBe('blocked');
    expect(reject.json.mock.calls.at(-1)?.[2]).toMatchObject({
      path: '/agent/runs/run-1/reject', method: 'POST',
    });
  });

  it('cancels an active Host run via existing control gate', async () => {
    const f = fixture();
    const run = await f.runtime.resolve('thread-1', 'run-1', 'cancel');
    expect(run.status).toBe('cancelled');
    expect(f.json.mock.calls.at(-1)?.[2]).toMatchObject({
      path: '/agent/runs/run-1/cancel', method: 'POST',
    });
  });

  it('rejects missing effective scopes before any Agent mutation', async () => {
    const f = fixture(['agent:read']);
    await expect(f.runtime.resolve('thread-1', 'run-1', 'approve'))
      .rejects.toMatchObject({ code: 'REMOTE_SCOPE_REQUIRED', status: 403 });
    expect(f.json.mock.calls.map(([, , req]) => req.path))
      .not.toContain('/agent/runs/run-1/approve');
  });

  it('rejects wrong-thread Run before permitting approval', async () => {
    const f = fixture();
    await expect(f.runtime.resolve('thread-other', 'run-1', 'approve'))
      .rejects.toMatchObject({ code: 'AGENT_RUN_THREAD_MISMATCH' });
    expect(f.json.mock.calls.map(([, , req]) => req.path))
      .not.toContain('/agent/runs/run-1/approve');
  });

  it('fails closed on account revocation while run details are being read', async () => {
    const state = { current: true };
    const f = fixture(undefined, state);
    const original = f.json.getMockImplementation()!;
    f.json.mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[2].path === '/agent/runs/run-1') state.current = false;
      return result;
    });
    await expect(f.runtime.resolve('thread-1', 'run-1', 'approve'))
      .rejects.toMatchObject({ code: 'CLOUD_AGENT_SESSION_CHANGED' });
    expect(f.json.mock.calls.map(([, , req]) => req.path))
      .not.toContain('/agent/runs/run-1/approve');
  });

  it('does not switch authenticated Host midway through approval', async () => {
    const f = fixture();
    const otherAccess = { ...f.access, target: { ...f.access.target, room: 'room-b' } };
    f.entry.discover.mockResolvedValueOnce(f.access).mockResolvedValue(otherAccess as never);
    await expect(f.runtime.resolve('thread-1', 'run-1', 'approve'))
      .rejects.toMatchObject({ code: 'CLOUD_RELAY_SESSION_REJECTED' });
    expect(f.json.mock.calls.map(([, , req]) => req.path))
      .not.toContain('/agent/runs/run-1/approve');
  });
});
