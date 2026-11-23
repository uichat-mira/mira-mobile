import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import {
  cloudRelayEntry,
  type CloudRelayEntry,
  type CloudRelayHostCandidate,
} from '../cloud/cloudRelayEntry';
import {
  openCloudRelayPostSse,
  requestCloudRelayJson,
} from '../api/cloudRelay';
import { RemoteHostError } from '../api/remoteHttp';
import { CloudToolHostClient } from './cloudToolHostClient';
import { CompositeToolGatewayClient } from './compositeToolGatewayClient';
import { localToolGatewayClient } from './localToolGatewayClient';
import { mobileToolGatewayClient } from './mobileToolGatewayClient';
import { RemoteToolGatewayClient } from './remoteToolGatewayClient';
import {
  ToolGatewayError,
  DESKTOP_HOST_DISCOVERY_TOOL,
  type ToolApprovalDecision,
  type ToolApprovalRequest,
  type ToolApprovalResolution,
  type ToolCallRequest,
  type ToolCallResult,
  type ToolDiscoveryHostCandidate,
  type ToolDiscoveryNoticeCode,
  type ToolDiscoveryResult,
  type ToolGatewayClient,
  type ToolManifest,
} from './toolGatewayClient';

export interface CloudToolAccountContext {
  accountId: string | null;
  explicitlySignedOut: boolean;
  /** A revoked/rejected Cloud identity is not an intentional switch to pairing. */
  cloudSessionInvalid?: boolean;
}

type CloudToolEntry = Pick<
  CloudRelayEntry,
  'listHostCandidates' | 'discoverHost' | 'assertCurrentAccess'
>;

export interface LocalAgentToolGatewayOptions {
  local?: ToolGatewayClient;
  /** Existing Local + Legacy paired Host toolset, used only when signed out. */
  paired?: ToolGatewayClient;
  entry?: CloudToolEntry;
  cloudContext?: () => CloudToolAccountContext;
  json?: typeof requestCloudRelayJson;
  sse?: typeof openCloudRelayPostSse;
  /**
   * The current user turn only. It lets the Mobile side bind an explicitly
   * named Host; absence is never an instruction to pick a recent one.
   */
  selectionText?: string;
  /** The immediately preceding local assistant message, if any. */
  previousAssistantText?: string;
}

type ProbedHost =
  | { status: 'usable'; candidate: CloudRelayHostCandidate; toolNames: string[] }
  | { status: 'unauthorized'; candidate: CloudRelayHostCandidate }
  | { status: 'unavailable'; candidate: CloudRelayHostCandidate };

const normalizeMatchText = (value: string): string =>
  value.replace(/\s+/gu, ' ').trim().toLowerCase();

const sortHostCandidates = (
  hosts: readonly CloudRelayHostCandidate[],
): CloudRelayHostCandidate[] =>
  [...hosts].sort((left, right) => {
    const byName = (left.name ?? '').localeCompare(right.name ?? '');
    return byName !== 0 ? byName : left.hostId.localeCompare(right.hostId);
  });

const hostMentionedIn = (
  candidate: CloudRelayHostCandidate,
  text: string,
): boolean => {
  const name = candidate.name ? normalizeMatchText(candidate.name) : '';
  // Very short names would match ordinary prose and could silently bind the
  // wrong Host; require an id instead in that case.
  if (name.length >= 2 && text.includes(name)) return true;
  const id = candidate.hostId.toLowerCase();
  if (id.length >= 4 && text.includes(id)) return true;
  const shortId = id.slice(0, 12);
  return shortId.length >= 4 && text.includes(shortId);
};

const DESKTOP_HOST_DISCOVERY_MANIFEST: ToolManifest = {
  name: DESKTOP_HOST_DISCOVERY_TOOL,
  description: 'Discover authorized Mira Desktop computers when a user task needs tools on a Desktop. Do not call for ordinary chat or phone-only tools. With multiple Desktops, the user chooses in this chat before any remote execution.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
};

// Numbered selection only refers to a list in the immediately previous genuine
// assistant response. Resolve its displayed Host ID against today's account
// directory, never by a freshly sorted index or by a stored tool credential.
const previousHostChoice = (
  input: string,
  previousAssistantText: string,
  hosts: readonly CloudRelayHostCandidate[],
): CloudRelayHostCandidate | null => {
  if (!/^[1-9][0-9]?$/u.test(input)) return null;
  if (!previousAssistantText.startsWith(
    '检测到同一 Mira Cloud 账号下有多台可用的 Mira Desktop Host。请回复要使用哪一台：',
  ) || !previousAssistantText.includes(
    '请直接回复设备名称或 Host ID；确认后我会在下一轮使用该设备的工具。',
  )) return null;
  const line = previousAssistantText.split('\n').find(
    item => item.startsWith(input + '. '),
  );
  const hostPrefix = line?.match(/（Host ID：([^；]+)；在线；/u)?.[1];
  if (!hostPrefix) return null;
  const matched = hosts.filter(host => host.hostId === hostPrefix ||
    host.hostId.startsWith(hostPrefix));
  return matched.length === 1 ? matched[0] : null;
};

const isExplicitHostSelectionReply = (
  selectionText: string,
  previousAssistantText: string,
): boolean => {
  if (!selectionText || !previousAssistantText.startsWith(
    '检测到同一 Mira Cloud 账号下有多台可用的 Mira Desktop Host。请回复要使用哪一台：',
  ) || !previousAssistantText.includes(
    '请直接回复设备名称或 Host ID；确认后我会在下一轮使用该设备的工具。',
  )) return false;

  return previousAssistantText.split('\n').some(line => {
    const match = line.match(/^([1-9][0-9]?)\. (.+?)（Host ID：([^；]+)；在线；/u);
    if (!match) return false;
    const [, number, name, hostId] = match;
    const shortId = normalizeMatchText(hostId);
    const label = normalizeMatchText(name);
    return selectionText === number ||
      (label.length >= 2 && selectionText.includes(label)) ||
      (shortId.length >= 4 && selectionText.includes(shortId));
  });
};

const candidateProjection = (
  probes: readonly Extract<ProbedHost, { status: 'usable' }>[],
): ToolDiscoveryHostCandidate[] =>
  sortHostCandidates(probes.map(probe => probe.candidate)).map(candidate => {
    const probe = probes.find(item => item.candidate.hostId === candidate.hostId);
    return {
      hostId: candidate.hostId,
      name: candidate.name,
      toolNames: probe?.toolNames ?? [],
    };
  });

const probeFailure = (
  error: unknown,
): 'unauthorized' | 'unavailable' | null => {
  if (!(error instanceof RemoteHostError)) return null;
  // Account/Host identity drift is never a candidate-level permission result.
  if (error.code === 'CLOUD_TOOL_HOST_CHANGED') return null;
  if (UNAUTHORIZED_CODES.has(error.code) || error.status === 403) {
    return 'unauthorized';
  }
  if (UNAVAILABLE_CODES.has(error.code) || (error.status ?? 0) >= 500) {
    return 'unavailable';
  }
  return null;
};

const currentCloudContext = (): CloudToolAccountContext => {
  const state = useCloudAccountStore.getState();
  return {
    accountId: state.account?.id ?? null,
    explicitlySignedOut: state.status === 'signed_out',
    cloudSessionInvalid:
      state.status === 'session_rejected' ||
      state.status === 'device_revoked',
  };
};

const UNAUTHORIZED_CODES = new Set([
  'CLOUD_TOOL_GRANT_REQUIRED',
  'CLOUD_TOOL_ROUTE_UNAVAILABLE',
  'CLOUD_HOST_GRANT_REQUIRED',
  'RELAY_CLOUD_GRANT_REQUIRED',
  'REMOTE_SCOPE_REQUIRED',
  'REMOTE_TOOL_ROUTE_UNAVAILABLE',
  'HTTP_403',
  'FORBIDDEN',
  'CLOUD_RELAY_TICKET_DENIED',
  'CLOUD_RELAY_TICKET_REJECTED',
]);

/** Only actual transport/Host availability faults may downgrade to local tools. */
const UNAVAILABLE_CODES = new Set([
  'CLOUD_RELAY_HOST_NOT_FOUND',
  'CLOUD_RELAY_HOST_OFFLINE',
  'CLOUD_RELAY_AUTH_UNAVAILABLE',
  'RELAY_HOST_OFFLINE',
  'RELAY_DISCONNECTED',
  'RELAY_NETWORK_ERROR',
  'RELAY_CONNECT_TIMEOUT',
  'RELAY_HANDSHAKE_TIMEOUT',
]);

const cloudNoticeFor = (
  error: unknown,
): ToolDiscoveryNoticeCode | null => {
  if (error instanceof ToolGatewayError) return null;
  if (!(error instanceof RemoteHostError)) return null;
  if (error.code === 'CLOUD_RELAY_HOST_AMBIGUOUS') {
    return 'cloud-tools-host-ambiguous';
  }
  if (
    error.code === 'CLOUD_RELAY_SESSION_REJECTED' ||
    error.code === 'CLOUD_RELAY_SESSION_REQUIRED'
  ) {
    return 'cloud-tools-session-invalid';
  }
  if (UNAUTHORIZED_CODES.has(error.code)) {
    return 'cloud-tools-unauthorized';
  }
  if (UNAVAILABLE_CODES.has(error.code)) {
    return 'cloud-tools-unavailable';
  }
  return null;
};

const discoveryOf = async (
  gateway: ToolGatewayClient,
): Promise<ToolDiscoveryResult> => {
  if (gateway.discoverTools) return gateway.discoverTools();
  return { tools: await gateway.listTools(), notices: [] };
};

/**
 * Resolves the Local Agent toolset once per run.
 *
 * The same instance must not be reused across runs: it captures the Cloud
 * account/Host access that produced the tool aliases, and a later run must
 * discover authority again instead of reusing a stale list or invocation.
 */
export class LocalAgentToolGateway implements ToolGatewayClient {
  private readonly local: ToolGatewayClient;
  private readonly paired: ToolGatewayClient;
  private readonly entry: CloudToolEntry;
  private readonly cloudContext: () => CloudToolAccountContext;
  private readonly json: typeof requestCloudRelayJson;
  private readonly sse: typeof openCloudRelayPostSse;
  private readonly selectionText: string;
  private readonly previousAssistantText: string;
  private pendingHostSelectionAccount: string | null = null;
  private active: ToolGatewayClient | null = null;
  private pendingDiscovery: Promise<ToolDiscoveryResult> | null = null;

  constructor(options: LocalAgentToolGatewayOptions = {}) {
    this.local = options.local ?? localToolGatewayClient;
    this.paired = options.paired ?? mobileToolGatewayClient;
    this.entry = options.entry ?? cloudRelayEntry;
    this.cloudContext = options.cloudContext ?? currentCloudContext;
    this.json = options.json ?? requestCloudRelayJson;
    this.sse = options.sse ?? openCloudRelayPostSse;
    this.selectionText = normalizeMatchText(options.selectionText ?? '');
    this.previousAssistantText = options.previousAssistantText ?? '';
  }

  async listTools(): Promise<readonly ToolManifest[]> {
    return (await this.discoverTools()).tools;
  }

  async discoverTools(): Promise<ToolDiscoveryResult> {
    if (this.pendingDiscovery) return this.pendingDiscovery;
    const pending = this.discoverOnce();
    this.pendingDiscovery = pending;
    try {
      return await pending;
    } finally {
      if (this.pendingDiscovery === pending) this.pendingDiscovery = null;
    }
  }

  async callTool(
    request: ToolCallRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ToolCallResult> {
    if (request.name === DESKTOP_HOST_DISCOVERY_TOOL) {
      const current = this.cloudContext();
      if (!this.pendingHostSelectionAccount ||
          current.cloudSessionInvalid || current.explicitlySignedOut ||
          current.accountId !== this.pendingHostSelectionAccount) {
        throw hostChanged();
      }
      // A model-discovered Host list is a clarification, not permission to run
      // any Desktop mutation. Confirm the Cloud account still owns its directory.
      const directory = await this.entry.listHostCandidates();
      if (directory.accountId !== this.pendingHostSelectionAccount) {
        throw hostChanged();
      }
      const probes = await Promise.all(directory.hosts
        .filter(candidate => candidate.availability === 'available')
        .map(candidate => this.probeHost(directory.accountId, candidate)));
      const usable = probes.filter(
        (probe): probe is Extract<ProbedHost, { status: 'usable' }> =>
          probe.status === 'usable',
      );
      if (usable.length === 0) {
        if (directory.hosts.length > 0 && probes.length > 0 &&
            probes.every(probe => probe.status === 'unauthorized')) {
          throw new RemoteHostError('CLOUD_TOOL_GRANT_REQUIRED',
            'No Desktop grants this Mobile permission to execute tools', 403);
        }
        throw new RemoteHostError('CLOUD_RELAY_HOST_OFFLINE',
          'No authorized Desktop tool Host is currently reachable');
      }
      if (usable.length === 1) {
        // Only an Agent-requested discovery may hydrate Host tool schemas.
        // Keep their credential and Host binding inside the existing gateway.
        const selected = usable[0].candidate;
        const discovery = await this.bindHost(directory.accountId, selected.hostId);
        return {
          content: 'Mira Desktop connected: ' + (selected.name ?? selected.hostId) +
            '. Authorized tools are now available for this Agent run.',
          refreshedTools: discovery.tools,
        };
      }
      return {
        content: 'Desktop candidates verified',
        hostSelectionRequired: true,
        hostCandidates: candidateProjection(usable),
      };
    }
    return this.requireActive().callTool(request, options);
  }

  async resolveApproval(
    approval: ToolApprovalRequest,
    decision: ToolApprovalDecision,
    options?: { signal?: AbortSignal },
  ): Promise<ToolApprovalResolution> {
    const active = this.requireActive();
    const resolve = active.resolveApproval;
    if (!resolve) {
      throw new ToolGatewayError(
        'TOOL_APPROVAL_UNSUPPORTED',
        'The active tool gateway does not support approval',
      );
    }
    return resolve.call(active, approval, decision, options);
  }

  private requireActive(): ToolGatewayClient {
    if (!this.active) {
      throw new ToolGatewayError(
        'TOOL_CHANNEL_UNAVAILABLE',
        'Local Agent tools were not discovered for this run',
      );
    }
    return this.active;
  }

  private async discoverOnce(): Promise<ToolDiscoveryResult> {
    const context = this.cloudContext();
    if (context.explicitlySignedOut) {
      this.active = this.paired;
      return discoveryOf(this.paired);
    }
    if (!context.accountId) {
      this.active = this.local;
      return {
        tools: await this.local.listTools(),
        notices: [{
          code: context.cloudSessionInvalid
            ? 'cloud-tools-session-invalid'
            : 'cloud-tools-unavailable',
        }],
      };
    }

    if (context.cloudSessionInvalid) {
      return this.localOnly('cloud-tools-session-invalid');
    }
    const accountId = context.accountId;
    // A numbered/name reply to our immediately preceding Host list is explicit
    // selection. All other turns must reach the model before any Cloud RPC.
    if (isExplicitHostSelectionReply(
      this.selectionText, this.previousAssistantText,
    )) {
      try {
        return await this.discoverCloudHost(accountId);
      } catch (error) {
        const notice = cloudNoticeFor(error);
        if (!notice) throw error;
        return this.localOnly(notice);
      }
    }
    this.pendingHostSelectionAccount = accountId;
    this.active = this.local;
    const tools = await this.local.listTools();
    if (tools.some(tool => tool.name === DESKTOP_HOST_DISCOVERY_TOOL)) {
      throw new ToolGatewayError('TOOL_NAME_COLLISION',
        'Desktop discovery tool collides with an existing local tool');
    }
    return {
      tools: [...tools, DESKTOP_HOST_DISCOVERY_MANIFEST],
      notices: [],
    };
  }

  private async discoverCloudHost(accountId: string): Promise<ToolDiscoveryResult> {
    const directory = await this.entry.listHostCandidates();
    if (directory.accountId !== accountId) throw hostChanged();
    if (directory.hosts.length === 0) {
      return this.localOnly('cloud-tools-unavailable');
    }

    const numbered = previousHostChoice(
      this.selectionText,
      this.previousAssistantText,
      directory.hosts,
    );
    const mentioned = numbered ? [numbered] : this.selectionText
      ? directory.hosts.filter(candidate =>
          hostMentionedIn(candidate, this.selectionText))
      : [];
    if (mentioned.length === 1) {
      return this.resolveMentionedHost(accountId, mentioned[0]);
    }

    const online = sortHostCandidates(
      directory.hosts.filter(candidate => candidate.availability === 'available'),
    );
    if (online.length === 0) {
      return this.localOnly('cloud-tools-unavailable');
    }
    if (online.length === 1) {
      return this.resolveMentionedHost(accountId, online[0]);
    }
    if (mentioned.length > 1) {
      // The user text points at more than one real Host; do not guess.
      const probes = await Promise.all(
        online.map(candidate => this.probeHost(accountId, candidate)),
      );
      return this.ambiguousHosts(probes);
    }

    const probes = await Promise.all(
      online.map(candidate => this.probeHost(accountId, candidate)),
    );
    const usable = probes.filter(
      (probe): probe is Extract<ProbedHost, { status: 'usable' }> =>
        probe.status === 'usable',
    );
    if (usable.length === 1) {
      return this.bindHost(accountId, usable[0].candidate.hostId);
    }
    if (usable.length > 1) {
      return this.ambiguousHosts(usable);
    }
    return this.localOnly(
      probes.every(probe => probe.status === 'unauthorized')
        ? 'cloud-tools-unauthorized'
        : 'cloud-tools-unavailable',
    );
  }

  private async resolveMentionedHost(
    accountId: string,
    candidate: CloudRelayHostCandidate,
  ): Promise<ToolDiscoveryResult> {
    if (candidate.availability !== 'available') {
      return this.localOnly('cloud-tools-unavailable');
    }
    const probe = await this.probeHost(accountId, candidate);
    if (probe.status === 'usable') {
      return this.bindHost(accountId, candidate.hostId);
    }
    return this.localOnly(
      probe.status === 'unauthorized'
        ? 'cloud-tools-unauthorized'
        : 'cloud-tools-unavailable',
    );
  }

  private async probeHost(
    accountId: string,
    candidate: CloudRelayHostCandidate,
  ): Promise<ProbedHost> {
    try {
      const tools = await this.remoteGateway(accountId, candidate.hostId).listTools();
      return {
        status: 'usable',
        candidate,
        toolNames: tools.map(tool => tool.name),
      };
    } catch (error) {
      const status = probeFailure(error);
      if (!status) throw error;
      return { status, candidate };
    }
  }

  private async ambiguousHosts(
    probes: readonly ProbedHost[],
  ): Promise<ToolDiscoveryResult> {
    const usable = probes.filter(
      (probe): probe is Extract<ProbedHost, { status: 'usable' }> =>
        probe.status === 'usable',
    );
    if (usable.length < 2) {
      return this.localOnly(
        probes.length > 0 && probes.every(probe => probe.status === 'unauthorized')
          ? 'cloud-tools-unauthorized'
          : 'cloud-tools-unavailable',
      );
    }
    this.pendingHostSelectionAccount = this.cloudContext().accountId;
    this.active = this.local;
    const localTools = await this.local.listTools();
    if (localTools.some(tool => tool.name === DESKTOP_HOST_DISCOVERY_TOOL)) {
      throw new ToolGatewayError('TOOL_NAME_COLLISION',
        'Desktop discovery tool collides with an existing local tool');
    }
    return {
      tools: [...localTools, DESKTOP_HOST_DISCOVERY_MANIFEST],
      notices: [],
      hostCandidates: candidateProjection(usable),
    };
  }

  private async bindHost(
    accountId: string,
    hostId: string,
  ): Promise<ToolDiscoveryResult> {
    const access = await this.entry.discoverHost(hostId);
    if (access.accountId !== accountId || access.target.hostId !== hostId) {
      throw hostChanged();
    }
    this.entry.assertCurrentAccess(access);
    const composite = new CompositeToolGatewayClient(
      this.local,
      this.remoteGateway(accountId, hostId),
    );
    const discovery = await composite.discoverTools();
    this.active = composite;
    return discovery;
  }

  private remoteGateway(accountId: string, hostId: string): RemoteToolGatewayClient {
    return new RemoteToolGatewayClient(
      new CloudToolHostClient(
        accountId,
        hostId,
        this.entry,
        this.json,
        this.sse,
        changedAccountId => {
          const current = this.cloudContext();
          return (
            !current.explicitlySignedOut &&
            current.accountId === changedAccountId
          );
        },
      ),
    );
  }

  private async localOnly(
    code: ToolDiscoveryNoticeCode,
  ): Promise<ToolDiscoveryResult> {
    this.active = this.local;
    return {
      tools: await this.local.listTools(),
      notices: [{ code }],
    };
  }
}

const hostChanged = (): RemoteHostError =>
  new RemoteHostError(
    'CLOUD_TOOL_HOST_CHANGED',
    'The authorized Cloud Host changed during the Agent run',
    403,
  );

/** A fresh gateway per Local Agent run keeps Cloud authority and tool IDs scoped. */
export const createLocalAgentToolGateway = (
  selectionText?: string,
  previousAssistantText?: string,
): ToolGatewayClient =>
  new LocalAgentToolGateway({ selectionText, previousAssistantText });
