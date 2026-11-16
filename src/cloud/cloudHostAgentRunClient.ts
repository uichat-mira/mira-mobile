import { RemoteHostError, type RemoteJsonRequest } from '../api/remoteHttp';
import { requestCloudRelayJson } from '../api/cloudRelay';
import {
  parseRemoteAgentRun,
  parseRemoteManifest,
  type RemoteAgentRun,
  type RemoteManifest,
} from '../protocol/remoteHostV1';
import type { HostAgentRunClient } from '../runtime/durableHostAgentRuntime';
import { useCloudAccountStore } from './cloudAccountStore';
import {
  cloudRelayEntry,
  type CloudRelayAccess,
  type CloudRelayEntry,
} from './cloudRelayEntry';

type AgentOperation<T> = Pick<
  RemoteJsonRequest<T>,
  'path' | 'method' | 'signal' | 'parse'
>;

/**
 * Cloud identity/transport adapter for the existing DurableHostAgentRuntime.
 * The Host's canonical Agent Run, scope and approval rules are unchanged.
 * The Cloud Relay ticket only authenticates transport and is never a Host
 * business bearer credential.
 */
export class CloudHostAgentRunClient implements HostAgentRunClient {
  private boundAccess: CloudRelayAccess | null = null;

  constructor(
    accountId: string,
    private readonly entry: Pick<CloudRelayEntry, 'discover' | 'assertCurrentAccess'> =
      cloudRelayEntry,
    private readonly json: typeof requestCloudRelayJson = requestCloudRelayJson,
    private readonly ownerIsActive: () => boolean = () => {
      const state = useCloudAccountStore.getState();
      return state.status === 'signed_in' && state.account?.id === accountId;
    },
  ) {}

  private assertOwner(): void {
    if (!this.ownerIsActive()) {
      throw new RemoteHostError('CLOUD_AGENT_SESSION_CHANGED',
        'Mira Cloud identity changed; reopen the Agent conversation', 403);
    }
  }

  private async request<T>(operation: AgentOperation<T>): Promise<T> {
    this.assertOwner();
    const access = await this.entry.discover();
    this.assertOwner();
    this.entry.assertCurrentAccess(access);
    if (this.boundAccess && this.boundAccess !== access) {
      throw new RemoteHostError('CLOUD_AGENT_SESSION_CHANGED',
        'Agent operation cannot switch to a different Cloud Host or session', 403);
    }
    this.boundAccess = access;
    const result = await this.json(access.target, access.tickets, {
      ...operation,
      hostUrl: access.target.endpoint,
      allowInsecureDevelopment: false,
      // No Authorization: Host business authority is the effective Cloud
      // grant verified by Desktop's Remote Gateway, not the Relay ticket.
    });
    this.assertOwner();
    this.entry.assertCurrentAccess(access);
    return result;
  }

  getManifest(signal?: AbortSignal): Promise<RemoteManifest> {
    return this.request({
      path: '/remote/v1/manifest',
      signal,
      parse: parseRemoteManifest,
    });
  }

  getAgentRun(runId: string, signal?: AbortSignal): Promise<RemoteAgentRun> {
    return this.agentRequest(runId, 'GET', '', signal);
  }

  approveAgentRun(runId: string): Promise<RemoteAgentRun> {
    return this.agentRequest(runId, 'POST', '/approve');
  }

  rejectAgentRun(runId: string): Promise<RemoteAgentRun> {
    return this.agentRequest(runId, 'POST', '/reject');
  }

  cancelAgentRun(runId: string): Promise<RemoteAgentRun> {
    return this.agentRequest(runId, 'POST', '/cancel');
  }

  private agentRequest(
    runId: string,
    method: 'GET' | 'POST',
    suffix: string,
    signal?: AbortSignal,
  ): Promise<RemoteAgentRun> {
    if (!runId.trim()) {
      throw new RemoteHostError('AGENT_RUN_ID_REQUIRED', 'Missing Agent Run id');
    }
    return this.request({
      path: '/agent/runs/' + encodeURIComponent(runId) + suffix,
      method,
      signal,
      parse: parseRemoteAgentRun,
    });
  }
}
