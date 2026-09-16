import { RemoteHostError } from '../api/remoteHttp';
import {
  remoteMiraHostClient,
  type RemoteMiraHostClient,
} from '../api/remoteMiraHost';
import type {
  RemoteAgentRun,
  RemoteDeviceScope,
  RemoteManifest,
} from '../protocol/remoteHostV1';

export type DurableHostAgentAction = 'approve' | 'reject' | 'cancel';

const AGENT_ROUTES = {
  read: 'GET /agent/runs/:runId',
  approve: 'POST /agent/runs/:runId/approve',
  reject: 'POST /agent/runs/:runId/reject',
  cancel: 'POST /agent/runs/:runId/cancel',
} as const;

const TERMINAL_STATUSES = new Set<RemoteAgentRun['status']>([
  'completed',
  'failed',
  'blocked',
  'cancelled',
]);

const capabilityForAction = (
  action: 'read' | DurableHostAgentAction,
): { scope: RemoteDeviceScope; route: string } =>
  action === 'read'
    ? { scope: 'agent:read', route: AGENT_ROUTES.read }
    : action === 'cancel'
      ? { scope: 'agent:control', route: AGENT_ROUTES.cancel }
      : {
          scope: 'agent:approve',
          route: action === 'approve' ? AGENT_ROUTES.approve : AGENT_ROUTES.reject,
        };

const waitForPoll = (delayMs: number, signal?: AbortSignal) =>
  new Promise<void>(resolve => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };

    timer = setTimeout(finish, delayMs);
    signal?.addEventListener('abort', finish, { once: true });
  });

const fingerprintRun = (run: RemoteAgentRun) =>
  JSON.stringify([
    run.updatedAt,
    run.status,
    run.pendingApproval?.id ?? null,
    run.blockedReason ?? null,
    run.terminalReason ?? null,
  ]);

export function assertDurableHostRunBelongsToThread(
  run: RemoteAgentRun,
  threadId: string,
): RemoteAgentRun {
  if (run.threadId !== threadId) {
    throw new RemoteHostError(
      'AGENT_RUN_THREAD_MISMATCH',
      'Mira Host returned an Agent Run that does not belong to this thread',
    );
  }
  return run;
}

export class DurableHostAgentRuntimeAdapter {
  constructor(
    private readonly remote: RemoteMiraHostClient = remoteMiraHostClient,
    private readonly pollIntervalMs = 1_200,
  ) {}

  private assertCapability(
    manifest: RemoteManifest,
    action: 'read' | DurableHostAgentAction,
  ) {
    const required = capabilityForAction(action);
    if (!manifest.device.scopes.includes(required.scope)) {
      throw new RemoteHostError(
        'REMOTE_SCOPE_REQUIRED',
        `Paired device is missing required scope: ${required.scope}`,
        403,
        { scope: required.scope },
      );
    }
    if (!manifest.routes.agent.includes(required.route)) {
      throw new RemoteHostError(
        'AGENT_ROUTE_UNAVAILABLE',
        `Mira Host does not advertise required Agent route: ${required.route}`,
        403,
        { route: required.route },
      );
    }
  }

  async readRun(threadId: string, runId: string): Promise<RemoteAgentRun> {
    const manifest = await this.remote.getManifest();
    this.assertCapability(manifest, 'read');
    return assertDurableHostRunBelongsToThread(
      await this.remote.getAgentRun(runId),
      threadId,
    );
  }

  async resolve(
    threadId: string,
    runId: string,
    action: DurableHostAgentAction,
  ): Promise<RemoteAgentRun> {
    const manifest = await this.remote.getManifest();
    this.assertCapability(manifest, 'read');
    this.assertCapability(manifest, action);

    const current = assertDurableHostRunBelongsToThread(
      await this.remote.getAgentRun(runId),
      threadId,
    );
    const updated =
      action === 'approve'
        ? await this.remote.approveAgentRun(runId)
        : action === 'reject'
          ? await this.remote.rejectAgentRun(runId)
          : await this.remote.cancelAgentRun(runId);

    return assertDurableHostRunBelongsToThread(updated, current.threadId);
  }

  async *observeRun(
    threadId: string,
    runId: string,
    signal?: AbortSignal,
  ): AsyncIterable<RemoteAgentRun> {
    try {
      const manifest = await this.remote.getManifest(signal);
      if (signal?.aborted) return;
      this.assertCapability(manifest, 'read');

      let lastFingerprint: string | null = null;
      while (!signal?.aborted) {
        const run = assertDurableHostRunBelongsToThread(
          await this.remote.getAgentRun(runId, signal),
          threadId,
        );
        if (signal?.aborted) return;
        const fingerprint = fingerprintRun(run);
        if (fingerprint !== lastFingerprint) {
          lastFingerprint = fingerprint;
          yield run;
        }
        if (TERMINAL_STATUSES.has(run.status)) return;
        await waitForPoll(this.pollIntervalMs, signal);
      }
    } catch (error) {
      if (
        signal?.aborted &&
        error instanceof RemoteHostError &&
        error.code === 'REQUEST_ABORTED'
      ) {
        return;
      }
      throw error;
    }
  }
}

export const durableHostAgentRuntime = new DurableHostAgentRuntimeAdapter();
