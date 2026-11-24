import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import {
  useDesktopConnectionStore,
  type DesktopConnectionMode,
} from '../connectivity/desktopConnectionAuthority';
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
import {
  whoYouMcpServiceDiscovery,
  type WhoYouMcpServiceDiscovery,
} from '../mcp/whoYouMcpService';
import { McpProtocolError } from '../mcp/mcpProtocolClient';
import { WhoYouError } from '../whoYou/whoYouError';
import { CloudToolHostClient } from './cloudToolHostClient';
import { CompositeToolGatewayClient } from './compositeToolGatewayClient';
import { localToolGatewayClient } from './localToolGatewayClient';
import { McpServiceToolGateway } from './mcpServiceToolGateway';
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
  type ToolDisclosureRequest,
  type ToolDisclosureResult,
  type ToolGatewayClient,
  type ToolManifest,
  type ToolServiceDescriptor,
} from './toolGatewayClient';
import { resolveToolDisclosureTarget } from './toolDisclosure';

export interface CloudToolAccountContext {
  accountId: string | null;
  explicitlySignedOut: boolean;
  /** The single active Desktop transport; independent Cloud services stay local. */
  desktopMode: DesktopConnectionMode;
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
  /**
   * Trusted cloud MCP service discovery. `null` disables the dynamic MCP slice;
   * omitted uses the verified Who You service binding.
   */
  mcp?: WhoYouMcpServiceDiscovery | null;
}

type McpDiscovery =
  | { status: 'ready'; gateway: McpServiceToolGateway }
  | { status: 'degraded'; notice: 'mcp-service-degraded' | null }
  | { status: 'disabled' };

/** Bounds optional cloud discovery so an ordinary Local chat cannot hang. */
const MCP_DISCOVERY_TIMEOUT_MS = 12_000;

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

/**
 * These catalogs describe real sources only. They deliberately do not invent
 * business capability groups for Host V1 or a plain MCP server.
 */
const serviceFor = (
  id: string,
  name: string,
  description: string,
  tools: readonly ToolManifest[],
): ToolServiceDescriptor => ({
  id,
  name,
  description,
  toolNames: tools.map(tool => tool.name),
});

const localService = (tools: readonly ToolManifest[]): ToolServiceDescriptor =>
  serviceFor(
    'mira-mobile-local',
    'Mira Mobile 本机',
    '手机本机编译期注册的工具；mira_desktop_hosts 只发现已授权 Desktop，不授予工具执行权限。',
    tools,
  );

const pairedService = (tools: readonly ToolManifest[]): ToolServiceDescriptor =>
  serviceFor(
    'mira-paired-host',
    '已配对 Mira Host',
    '当前启用的 Tailscale 直连 Desktop；不包含 Cloud 账号工具。',
    tools,
  );

const desktopService = (tools: readonly ToolManifest[]): ToolServiceDescriptor =>
  serviceFor(
    'mira-desktop',
    'Mira Desktop',
    '当前 Cloud 账号下已授权 Desktop 的 Remote V1 工具；没有额外语义能力声明。',
    tools,
  );

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
    desktopMode: useDesktopConnectionStore.getState().mode,
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
  private readonly mcp: WhoYouMcpServiceDiscovery | null;
  private pendingHostSelectionAccount: string | null = null;
  private active: ToolGatewayClient | null = null;
  private pendingDiscovery: Promise<ToolDiscoveryResult> | null = null;
  private services: readonly ToolServiceDescriptor[] = [];
  private catalogRevision: string | undefined;
  private revision = 0;
  /** Desktop transport captured by discovery; local tools stay independent. */
  private desktopTransportMode: 'direct' | 'cloud' | null = null;
  private desktopToolNames: ReadonlySet<string> = new Set();
  private mcpGateway: McpServiceToolGateway | null = null;
  private mcpOwnedToolNames: ReadonlySet<string> = new Set();

  constructor(options: LocalAgentToolGatewayOptions = {}) {
    this.local = options.local ?? localToolGatewayClient;
    this.paired = options.paired ?? mobileToolGatewayClient;
    this.entry = options.entry ?? cloudRelayEntry;
    this.cloudContext = options.cloudContext ?? currentCloudContext;
    this.json = options.json ?? requestCloudRelayJson;
    this.sse = options.sse ?? openCloudRelayPostSse;
    this.selectionText = normalizeMatchText(options.selectionText ?? '');
    this.previousAssistantText = options.previousAssistantText ?? '';
    this.mcp = options.mcp === undefined ? whoYouMcpServiceDiscovery : options.mcp;
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

  async discloseTools(
    request: ToolDisclosureRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ToolDisclosureResult> {
    const active = this.requireActive();
    if (this.catalogRevision !== undefined &&
        request.catalogRevision !== this.catalogRevision) {
      throw new ToolGatewayError(
        'TOOL_DISCLOSURE_STALE',
        'The trusted tool catalog changed before disclosure',
      );
    }
    if (this.mcpGateway && request.serviceId === this.mcpGateway.serviceId) {
      const disclosed = await this.mcpGateway.discloseTools({
        ...request, catalogRevision: this.mcpGateway.catalogRevision,
      }, options);
      return { ...disclosed, catalogRevision: this.catalogRevision };
    }
    const target = resolveToolDisclosureTarget(this.services, request);
    target.toolNames.forEach(name => this.assertDesktopToolStillActive(name));
    const tools = await active.listTools();
    target.toolNames.forEach(name => this.assertDesktopToolStillActive(name));
    if (options?.signal?.aborted) {
      throw new ToolGatewayError('TOOL_CANCELLED', 'Tool disclosure was cancelled');
    }
    const byName = new Map(tools.map(tool => [tool.name, tool]));
    const disclosed = target.toolNames.flatMap(name => {
      const tool = byName.get(name);
      return tool ? [tool] : [];
    });
    if (disclosed.length !== target.toolNames.length) {
      throw new ToolGatewayError(
        'TOOL_DISCLOSURE_NOT_AVAILABLE',
        'A declared tool schema is no longer available',
      );
    }
    return {
      tools: disclosed,
      ...(this.catalogRevision !== undefined
        ? { catalogRevision: this.catalogRevision }
        : {}),
    };
  }

  async callTool(
    request: ToolCallRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ToolCallResult> {
    if (request.name === DESKTOP_HOST_DISCOVERY_TOOL) {
      const current = this.cloudContext();
      if (current.desktopMode !== 'cloud' ||
          !this.pendingHostSelectionAccount ||
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
          refreshedServices: discovery.services,
          ...(discovery.catalogRevision !== undefined
            ? { refreshedCatalogRevision: discovery.catalogRevision }
            : {}),
        };
      }
      return {
        content: 'Desktop candidates verified',
        hostSelectionRequired: true,
        hostCandidates: candidateProjection(usable),
      };
    }
    if (this.mcpGateway && this.mcpOwnedToolNames.has(request.name)) {
      return this.mcpGateway.callTool(request, options);
    }
    this.assertDesktopToolStillActive(request.name);
    return this.requireActive().callTool(request, options);
  }

  async resolveApproval(
    approval: ToolApprovalRequest,
    decision: ToolApprovalDecision,
    options?: { signal?: AbortSignal },
  ): Promise<ToolApprovalResolution> {
    if (this.mcpGateway && this.mcpOwnedToolNames.has(approval.name)) {
      return this.mcpGateway.resolveApproval(approval, decision, options);
    }
    this.assertDesktopToolStillActive(approval.name);
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

  /** An already-disclosed Desktop tool cannot run on a replaced transport. */
  private assertDesktopToolStillActive(toolName: string): void {
    if (!this.desktopToolNames.has(toolName) || !this.desktopTransportMode) {
      return;
    }
    if (this.cloudContext().desktopMode !== this.desktopTransportMode) {
      throw new RemoteHostError(
        'DESKTOP_CONNECTION_INACTIVE',
        'The active Desktop connection changed during the Agent run',
        409,
      );
    }
  }

  private withCatalog(
    discovery: ToolDiscoveryResult,
    services: readonly ToolServiceDescriptor[],
    catalogRevision?: string,
  ): ToolDiscoveryResult {
    this.services = services;
    this.catalogRevision = catalogRevision ?? String(++this.revision);
    return {
      ...discovery,
      services,
      catalogRevision: this.catalogRevision,
    };
  }

  private async discoverOnce(): Promise<ToolDiscoveryResult> {
    this.clearMcp();
    const context = this.cloudContext();

    if (context.desktopMode === 'none') {
      // No Desktop transport is active. Local/compiled-in tools (including
      // independent Cloud services such as Who-You mail) remain usable.
      this.desktopTransportMode = null;
      this.desktopToolNames = new Set();
      this.active = this.local;
      this.pendingHostSelectionAccount = null;
      const tools = await this.local.listTools();
      return this.withIndependentMcp({ tools, notices: [] }, [localService(tools)]);
    }

    if (context.desktopMode === 'direct') {
      // Direct pairing is independent from Cloud login. A signed-in Cloud
      // account must not reroute Desktop tools through Cloud Relay.
      this.desktopTransportMode = 'direct';
      this.active = this.paired;
      const discovery = await discoveryOf(this.paired);
      const localNames = new Set(
        (await this.local.listTools()).map(tool => tool.name),
      );
      this.desktopToolNames = new Set(
        discovery.tools
          .map(tool => tool.name)
          .filter(name => !localNames.has(name)),
      );
      const localTools = discovery.tools.filter(tool => localNames.has(tool.name));
      const desktopTools = discovery.tools.filter(tool => !localNames.has(tool.name));
      return this.withIndependentMcp(discovery, [
        ...(localTools.length ? [localService(localTools)] : []),
        ...(desktopTools.length ? [pairedService(desktopTools)] : []),
      ]);
    }

    this.desktopTransportMode = 'cloud';
    this.desktopToolNames = new Set();
    if (context.explicitlySignedOut) {
      // Cloud Relay cannot be active without a Cloud account. Do not silently
      // fall back to Direct; the user explicitly chose Cloud mode.
      this.active = this.local;
      const tools = await this.local.listTools();
      return this.withCatalog({
        tools,
        notices: [{ code: 'cloud-tools-session-invalid' }],
      }, [localService(tools)]);
    }
    if (!context.accountId) {
      this.active = this.local;
      const tools = await this.local.listTools();
      return this.withCatalog({
        tools,
        notices: [{
          code: context.cloudSessionInvalid
            ? 'cloud-tools-session-invalid'
            : 'cloud-tools-unavailable',
        }],
      }, [localService(tools)]);
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
    const localTools = await this.local.listTools();
    this.active = this.local;
    if (localTools.some(tool => tool.name === DESKTOP_HOST_DISCOVERY_TOOL)) {
      throw new ToolGatewayError('TOOL_NAME_COLLISION',
        'Desktop discovery tool collides with an existing local tool');
    }
    const tools = [...localTools, DESKTOP_HOST_DISCOVERY_MANIFEST];
    return this.withIndependentMcp({ tools, notices: [] }, [localService(tools)]);
  }

  /** Compose the existing independent MCP service with the selected Desktop
   * transport. Desktop availability is not an authorization for Who-You. */
  private async withIndependentMcp(
    discovery: ToolDiscoveryResult,
    services: readonly ToolServiceDescriptor[],
  ): Promise<ToolDiscoveryResult> {
    const context = this.cloudContext();
    if (!context.accountId || context.explicitlySignedOut || context.cloudSessionInvalid) {
      this.clearMcp();
      return this.withCatalog(discovery, services);
    }
    const mcp = this.mcpGateway
      ? { status: 'ready' as const, gateway: this.mcpGateway }
      : await this.discoverMcp(context.accountId);
    const current = this.cloudContext();
    if (current.accountId !== context.accountId || current.explicitlySignedOut || current.cloudSessionInvalid) {
      this.clearMcp();
      throw hostChanged();
    }
    this.mcpGateway = mcp.status === 'ready' ? mcp.gateway : null;
    this.mcpOwnedToolNames = this.mcpGateway?.ownedToolNames ?? new Set();
    if (!this.mcpGateway) {
      return this.withCatalog({
        ...discovery,
        notices: [...discovery.notices, ...(mcp.status === 'degraded' && mcp.notice ? [{ code: mcp.notice }] : [])],
      }, services);
    }
    const gateway = this.mcpGateway;
    const visible = await gateway.listTools();
    const existing = services.map(service => {
      // The old compiled-in read-only wrappers remain the authorized fallback;
      // the verified MCP binding owns those names when available.
      if (service.id === 'mira-mobile-local') return {
        ...service, toolNames: service.toolNames.filter(name => !this.mcpOwnedToolNames.has(name)),
      };
      if (service.toolNames.some(name => this.mcpOwnedToolNames.has(name))) {
        throw new ToolGatewayError('TOOL_NAME_COLLISION', 'Independent MCP and Desktop tool names collide');
      }
      return service;
    });
    if (this.mcpOwnedToolNames.has(DESKTOP_HOST_DISCOVERY_TOOL)) {
      throw new ToolGatewayError('TOOL_NAME_COLLISION', 'MCP tool collides with Desktop discovery');
    }
    const revision = this.catalogRevision === undefined
      ? gateway.catalogRevision : gateway.catalogRevision + ':' + String(++this.revision);
    const tools = discovery.tools.filter(tool => !this.mcpOwnedToolNames.has(tool.name));
    // Preserve the existing public initial order: local tools, MCP visible
    // tools, then optional Desktop discovery.
    const discoverDesktop = tools.filter(tool => tool.name === DESKTOP_HOST_DISCOVERY_TOOL);
    return this.withCatalog({
      ...discovery,
      tools: [...tools.filter(tool => tool.name !== DESKTOP_HOST_DISCOVERY_TOOL), ...visible, ...discoverDesktop],
    }, [...existing, gateway.service], revision);
  }

  /**
   * Discovers the optional trusted cloud MCP service for this run. A lost
   * session, changed account/identity, unsupported declaration or missing
   * permitted tool degrades to the compiled-in local tools; it never keeps a
   * stale MCP catalog or credential binding.
   */
  private async discoverMcp(accountId: string): Promise<McpDiscovery> {
    if (!this.mcp) return { status: 'disabled' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MCP_DISCOVERY_TIMEOUT_MS);
    try {
      const snapshot = await this.mcp.discover({
        accountId,
        signal: controller.signal,
      });
      if (snapshot.tools.length === 0) {
        return { status: 'degraded', notice: 'mcp-service-degraded' };
      }
      const executor = snapshot.executionGateway ?? this.local;
      const resolveLocalApproval = executor.resolveApproval?.bind(executor);
      const initialNames = new Set(snapshot.initialToolNames ?? []);
      const gateway = new McpServiceToolGateway({
        snapshot: {
          service: snapshot.service,
          tools: snapshot.tools,
          catalogRevision: snapshot.catalogRevision,
          // Only tools already known to the existing Agent entry path are
          // visible; other declared schemas require an explicit disclosure.
          visibleTools: snapshot.tools.filter(
            (tool) => initialNames.has(tool.name),
          ),
          degradation: snapshot.degradation,
          assertCurrent: snapshot.assertCurrent,
        },
        executeTool: (request, options) =>
          executor.callTool(request, options),
        ...(resolveLocalApproval
          ? { resolveToolApproval: resolveLocalApproval }
          : {}),
      });
      return { status: 'ready', gateway };
    } catch (error) {
      if (error instanceof WhoYouError) {
        // Ordinary session/network unavailability is not a catalog defect:
        // keep the compiled-in read tools usable without a noisy notice.
        const catalogDefect = error.kind === 'invalid_response';
        return {
          status: 'degraded',
          notice: catalogDefect ? 'mcp-service-degraded' : null,
        };
      }
      if (error instanceof McpProtocolError) {
        const catalogDefect = error.kind === 'invalid_response' ||
          error.kind === 'unsupported' ||
          error.kind === 'rejected';
        return {
          status: 'degraded',
          notice: catalogDefect ? 'mcp-service-degraded' : null,
        };
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private clearMcp(): void {
    this.mcpGateway = null;
    this.mcpOwnedToolNames = new Set();
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
    this.desktopTransportMode = 'cloud';
    this.desktopToolNames = new Set();
    this.active = this.local;
    const localTools = await this.local.listTools();
    if (localTools.some(tool => tool.name === DESKTOP_HOST_DISCOVERY_TOOL)) {
      throw new ToolGatewayError('TOOL_NAME_COLLISION',
        'Desktop discovery tool collides with an existing local tool');
    }
    const tools = [...localTools, DESKTOP_HOST_DISCOVERY_MANIFEST];
    return this.withIndependentMcp({
      tools,
      notices: [],
      hostCandidates: candidateProjection(usable),
    }, [localService(tools)]);
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
    // Desktop binding replaces only Desktop transport authority; unrelated MCP
    // services retain their account-owned binding.
    const localTools = await this.local.listTools();
    const composite = new CompositeToolGatewayClient(
      this.local,
      this.remoteGateway(accountId, hostId),
    );
    const discovery = await composite.discoverTools();
    this.active = composite;
    const localNames = new Set(localTools.map(tool => tool.name));
    const remoteTools = discovery.tools.filter(tool => !localNames.has(tool.name));
    this.desktopTransportMode = 'cloud';
    this.desktopToolNames = new Set(remoteTools.map(tool => tool.name));
    return this.withIndependentMcp(discovery, [
      localService(localTools),
      ...(remoteTools.length > 0 ? [desktopService(remoteTools)] : []),
    ]);
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
            current.desktopMode === 'cloud' &&
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
    this.desktopTransportMode = null;
    this.desktopToolNames = new Set();
    this.active = this.local;
    const tools = await this.local.listTools();
    return this.withIndependentMcp({
      tools,
      notices: [{ code }],
    }, [localService(tools)]);
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
