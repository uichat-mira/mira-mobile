import { RemoteHostError } from '../api/remoteHttp';
import type { RemoteMiraHostClient } from '../api/remoteMiraHost';
import type { RemoteAgentRun, RemoteManifest } from '../protocol/remoteHostV1';
import { DurableHostAgentRuntimeAdapter } from './durableHostAgentRuntime';

const makeRun = (
  status: RemoteAgentRun['status'],
  updatedAt: string,
): RemoteAgentRun => ({
  id: 'run-1',
  threadId: 'thread-1',
  userId: 1,
  status,
  traceId: 'trace-1',
  createdAt: '2026-09-07T00:00:00.000Z',
  updatedAt,
});

const manifest = (
  scopes: RemoteManifest['device']['scopes'] = [
    'agent:read',
    'agent:approve',
    'agent:control',
  ],
): RemoteManifest => ({
  protocolVersion: 1,
  device: {
    id: 'device-1',
    name: 'Phone',
    platform: 'ios',
    scopes,
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
  reconnect: { mode: 'canonical-state-replay', eventCursor: false },
  serverTime: '2026-09-07T00:00:00.000Z',
});

const makeRemote = (runs: RemoteAgentRun[]) => {
  let index = 0;
  const getManifest = jest.fn(async () => manifest());
  const getAgentRun = jest.fn(async () => {
    const run = runs[Math.min(index, runs.length - 1)]!;
    index += 1;
    return run;
  });
  const approveAgentRun = jest.fn(async () => makeRun('running', '2026-09-07T00:00:02.000Z'));
  const rejectAgentRun = jest.fn(async () => makeRun('blocked', '2026-09-07T00:00:02.000Z'));
  const cancelAgentRun = jest.fn(async () => makeRun('cancelled', '2026-09-07T00:00:02.000Z'));

  const remote = {
    getManifest,
    getAgentRun,
    approveAgentRun,
    rejectAgentRun,
    cancelAgentRun,
  } as unknown as RemoteMiraHostClient;

  return {
    remote,
    getManifest,
    getAgentRun,
    approveAgentRun,
    rejectAgentRun,
    cancelAgentRun,
  };
};

describe('DurableHostAgentRuntimeAdapter', () => {
  test('replays canonical Host state until a terminal run is reached', async () => {
    const fake = makeRemote([
      makeRun('running', '2026-09-07T00:00:00.000Z'),
      {
        ...makeRun('waiting_approval', '2026-09-07T00:00:01.000Z'),
        pendingApproval: {
          id: 'approval-1',
          runId: 'run-1',
          stepId: 'approval',
          toolId: 'terminal_session',
          reason: 'Needs approval',
          createdAt: '2026-09-07T00:00:01.000Z',
        },
      },
      makeRun('completed', '2026-09-07T00:00:02.000Z'),
    ]);
    const runtime = new DurableHostAgentRuntimeAdapter(fake.remote, 0);
    const seen: RemoteAgentRun['status'][] = [];

    for await (const run of runtime.observeRun('thread-1', 'run-1')) {
      seen.push(run.status);
    }

    expect(seen).toEqual(['running', 'waiting_approval', 'completed']);
    expect(fake.getManifest).toHaveBeenCalledTimes(1);
    expect(fake.getAgentRun).toHaveBeenCalledTimes(3);
  });

  test('stopping local observation does not cancel the Host run', async () => {
    const fake = makeRemote([makeRun('running', '2026-09-07T00:00:00.000Z')]);
    const runtime = new DurableHostAgentRuntimeAdapter(fake.remote, 10_000);
    const controller = new AbortController();
    const iterator = runtime.observeRun('thread-1', 'run-1', controller.signal)[
      Symbol.asyncIterator
    ]();

    await expect(iterator.next()).resolves.toMatchObject({
      value: { status: 'running' },
      done: false,
    });
    controller.abort();
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
    expect(fake.cancelAgentRun).not.toHaveBeenCalled();
  });

  test('aborts an in-flight Host read without cancelling the durable run', async () => {
    const controller = new AbortController();
    const getManifest = jest.fn(async (_signal?: AbortSignal) => manifest());
    const getAgentRun = jest.fn(
      (_runId: string, signal?: AbortSignal) =>
        new Promise<RemoteAgentRun>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new RemoteHostError('REQUEST_ABORTED', 'cancelled'));
            return;
          }
          signal?.addEventListener(
            'abort',
            () => reject(new RemoteHostError('REQUEST_ABORTED', 'cancelled')),
            { once: true },
          );
        }),
    );
    const cancelAgentRun = jest.fn();
    const remote = {
      getManifest,
      getAgentRun,
      cancelAgentRun,
    } as unknown as RemoteMiraHostClient;
    const runtime = new DurableHostAgentRuntimeAdapter(remote, 10_000);
    const iterator = runtime.observeRun('thread-1', 'run-1', controller.signal)[
      Symbol.asyncIterator
    ]();

    const pending = iterator.next();
    await Promise.resolve();
    await Promise.resolve();
    expect(getManifest).toHaveBeenCalledWith(controller.signal);
    expect(getAgentRun).toHaveBeenCalledWith('run-1', controller.signal);

    controller.abort();
    await expect(pending).resolves.toMatchObject({ done: true });
    expect(cancelAgentRun).not.toHaveBeenCalled();
  });

  test('requires advertised Agent scope and route before reading', async () => {
    const fake = makeRemote([makeRun('running', '2026-09-07T00:00:00.000Z')]);
    fake.getManifest.mockResolvedValue(manifest([]));
    const runtime = new DurableHostAgentRuntimeAdapter(fake.remote, 0);

    await expect(runtime.readRun('thread-1', 'run-1')).rejects.toMatchObject({
      code: 'REMOTE_SCOPE_REQUIRED',
      status: 403,
    });
    expect(fake.getAgentRun).not.toHaveBeenCalled();
  });

  test('rejects canonical runs that belong to another thread', async () => {
    const fake = makeRemote([
      { ...makeRun('running', '2026-09-07T00:00:00.000Z'), threadId: 'other-thread' },
    ]);
    const runtime = new DurableHostAgentRuntimeAdapter(fake.remote, 0);

    await expect(runtime.readRun('thread-1', 'run-1')).rejects.toMatchObject({
      code: 'AGENT_RUN_THREAD_MISMATCH',
    });
  });

  test('requires read capability before resolving an Agent action', async () => {
    const fake = makeRemote([makeRun('running', '2026-09-07T00:00:00.000Z')]);
    fake.getManifest.mockResolvedValue(manifest(['agent:control']));
    const runtime = new DurableHostAgentRuntimeAdapter(fake.remote, 0);

    await expect(runtime.resolve('thread-1', 'run-1', 'cancel')).rejects.toMatchObject({
      code: 'REMOTE_SCOPE_REQUIRED',
      status: 403,
    });
    expect(fake.getAgentRun).not.toHaveBeenCalled();
    expect(fake.cancelAgentRun).not.toHaveBeenCalled();
  });

  test('uses the Host control route for cancellation', async () => {
    const fake = makeRemote([makeRun('running', '2026-09-07T00:00:00.000Z')]);
    const runtime = new DurableHostAgentRuntimeAdapter(fake.remote, 0);

    await expect(runtime.resolve('thread-1', 'run-1', 'cancel')).resolves.toMatchObject({
      status: 'cancelled',
    });
    expect(fake.cancelAgentRun).toHaveBeenCalledWith('run-1');
  });
});
