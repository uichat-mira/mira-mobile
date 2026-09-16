import { RemoteHostError } from '../api/remoteHttp';
import type { RemoteMiraHostClient } from '../api/remoteMiraHost';
import type { RemoteAgentRun } from '../protocol/remoteHostV1';
import { DurableHostAgentRuntimeAdapter } from '../runtime/durableHostAgentRuntime';
import {
  applyAgentRunAction,
  assertRunBelongsToThread,
  canApplyAgentRunAction,
  getAgentRunErrorMessage,
  getStableAgentRunId,
  loadAgentRunForMessages,
  shouldDisplayAgentRun,
} from './remoteAgentApproval';

const makeRun = (
  status: RemoteAgentRun['status'],
  overrides: Partial<RemoteAgentRun> = {},
): RemoteAgentRun => ({
  id: 'run-1',
  threadId: 'thread-1',
  userId: 1,
  status,
  traceId: 'trace-1',
  createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z',
  ...(status === 'waiting_approval'
    ? {
        pendingApproval: {
          id: 'approval-1',
          runId: 'run-1',
          stepId: 'step-1',
          toolId: 'terminal_session',
          reason: '需要执行终端命令',
          createdAt: '2026-08-29T00:00:00.000Z',
        },
      }
    : {}),
  ...overrides,
});

const makeRemote = (run: RemoteAgentRun) => {
  const getManifest = jest.fn(async () => ({
    protocolVersion: 1 as const,
    device: {
      id: 'device-1',
      name: 'Phone',
      platform: 'ios',
      scopes: ['agent:read', 'agent:approve', 'agent:control'] as const,
    },
    routes: {
        threads: [],
      messages: [],
      agent: [
        'GET /agent/runs/:runId',
        'POST /agent/runs/:runId/approve',
        'POST /agent/runs/:runId/reject',
        'POST /agent/runs/:runId/cancel',
      ],
      tools: [],
      artifacts: [],
    },
    reconnect: { mode: 'canonical-state-replay' as const, eventCursor: false as const },
    serverTime: '2026-08-29T00:00:00.000Z',
  }));
  const getAgentRun = jest.fn(async () => run);
  const approveAgentRun = jest.fn(async () => makeRun('running'));
  const rejectAgentRun = jest.fn(async () => makeRun('blocked'));
  const cancelAgentRun = jest.fn(async () => makeRun('cancelled'));
  const remote = {
    getManifest,
    getAgentRun,
    approveAgentRun,
    rejectAgentRun,
    cancelAgentRun,
  } as unknown as RemoteMiraHostClient;

  return {
    remote,
    runtime: new DurableHostAgentRuntimeAdapter(remote, 0),
    getManifest,
    getAgentRun,
    approveAgentRun,
    rejectAgentRun,
    cancelAgentRun,
  };
};

describe('remoteAgentApproval', () => {
  test('reads the latest stable runId only from assistant message metadata', () => {
    expect(
      getStableAgentRunId([
        { role: 'assistant', metadata: { agent: { runId: 'run-old' } } },
        { role: 'user', metadata: { agent: { runId: 'run-user' } } },
        { role: 'assistant', metadata: { agent: { runId: '  run-new  ' } } },
      ]),
    ).toBe('run-new');

    expect(
      getStableAgentRunId([
        { role: 'assistant', metadata: { agent: { runId: 'run-old' } } },
        { role: 'assistant', metadata: {} },
      ]),
    ).toBeNull();
  });

  test('loads canonical run and rejects a run from another thread', async () => {
    const valid = makeRemote(makeRun('waiting_approval'));
    await expect(
      loadAgentRunForMessages(
        'thread-1',
        [{ role: 'assistant', metadata: { agent: { runId: 'run-1' } } }],
        valid.runtime,
      ),
    ).resolves.toMatchObject({ id: 'run-1', threadId: 'thread-1' });

    const mismatch = makeRemote(
      makeRun('waiting_approval', { threadId: 'thread-other' }),
    );
    await expect(
      loadAgentRunForMessages(
        'thread-1',
        [{ role: 'assistant', metadata: { agent: { runId: 'run-1' } } }],
        mismatch.runtime,
      ),
    ).rejects.toMatchObject({ code: 'AGENT_RUN_THREAD_MISMATCH' });
  });

  test('allows only truthful actions for each canonical status', () => {
    const waiting = makeRun('waiting_approval');
    expect(canApplyAgentRunAction(waiting, 'approve')).toBe(true);
    expect(canApplyAgentRunAction(waiting, 'reject')).toBe(true);
    expect(canApplyAgentRunAction(waiting, 'cancel')).toBe(false);

    for (const status of ['queued', 'running'] as const) {
      const run = makeRun(status);
      expect(canApplyAgentRunAction(run, 'cancel')).toBe(true);
      expect(canApplyAgentRunAction(run, 'approve')).toBe(false);
    }

    for (const status of [
      'completed',
      'failed',
      'blocked',
      'cancelled',
    ] as const) {
      const run = makeRun(status);
      expect(canApplyAgentRunAction(run, 'approve')).toBe(false);
      expect(canApplyAgentRunAction(run, 'reject')).toBe(false);
      expect(canApplyAgentRunAction(run, 'cancel')).toBe(false);
      expect(shouldDisplayAgentRun(run)).toBe(false);
    }
  });

  test('does not call a mutation when canonical status cannot perform it', async () => {
    const fake = makeRemote(makeRun('completed'));

    await expect(
      applyAgentRunAction('thread-1', 'run-1', 'approve', fake.runtime),
    ).rejects.toMatchObject({ code: 'AGENT_RUN_ACTION_UNAVAILABLE' });
    expect(fake.approveAgentRun).not.toHaveBeenCalled();
  });

  test('uses Host result as the returned state after approve, reject and cancel', async () => {
    const approve = makeRemote(makeRun('waiting_approval'));
    await expect(
      applyAgentRunAction('thread-1', 'run-1', 'approve', approve.runtime),
    ).resolves.toMatchObject({ status: 'running' });
    expect(approve.approveAgentRun).toHaveBeenCalledTimes(1);

    const reject = makeRemote(makeRun('waiting_approval'));
    await expect(
      applyAgentRunAction('thread-1', 'run-1', 'reject', reject.runtime),
    ).resolves.toMatchObject({ status: 'blocked' });
    expect(reject.rejectAgentRun).toHaveBeenCalledTimes(1);

    const cancel = makeRemote(makeRun('running'));
    await expect(
      applyAgentRunAction('thread-1', 'run-1', 'cancel', cancel.runtime),
    ).resolves.toMatchObject({ status: 'cancelled' });
    expect(cancel.cancelAgentRun).toHaveBeenCalledTimes(1);
  });

  test('maps auth, missing run, network and thread mismatch errors truthfully', () => {
    expect(
      getAgentRunErrorMessage(
        new RemoteHostError('HTTP_401', 'unauthorized', 401),
      ),
    ).toContain('重新连接');
    expect(
      getAgentRunErrorMessage(new RemoteHostError('HTTP_403', 'forbidden', 403)),
    ).toContain('权限');
    expect(
      getAgentRunErrorMessage(new RemoteHostError('HTTP_404', 'missing', 404)),
    ).toContain('不存在');
    expect(
      getAgentRunErrorMessage(new RemoteHostError('NETWORK_ERROR', 'offline')),
    ).toContain('网络');
    expect(() =>
      assertRunBelongsToThread(
        makeRun('running', { threadId: 'thread-other' }),
        'thread-1',
      ),
    ).toThrow(RemoteHostError);
  });
});
