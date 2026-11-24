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
import { defaultMcpServiceBindings } from '../mcp/defaultMcpServiceBindings';
import {
  createCloudDesktopMcpDiscovery,
  createDirectDesktopMcpDiscovery,
  DESKTOP_MCP_SERVICE_ID,
} from '../mcp/desktopMcpService';
import {
  McpServiceBinding,
  type McpServiceBindingOutcome,
  type McpServiceDiscovery,
} from '../mcp/mcpServiceBinding';
import { McpProtocolError } from '../mcp/mcpProtocolClient';
import { localToolGatewayClient } from './localToolGatewayClient';
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
  /**
   * Increments on every committed Desktop connection transition. A same-mode
   * re-pair/disconnect/reconnect is a new binding instance even though the
   * service type stays `mira-desktop`.
   */
  desktopGeneration?: number;
}

type CloudToolEntry = Pick<
  CloudRelayEntry,
  'listHostCandidates' | 'discoverHost' | 'assertCurrentAccess'
>;

export interface DesktopMcpBindingFactory {
  direct(generation: number): McpServiceBinding;
  cloud(input: {
    accountId: string;
    hostId: string;
    generation: number;
    entry: CloudToolEntry;
    json: typeof requestCloudRelayJson;
    sse: typeof openCloudRelayPostSse;
  }): McpServiceBinding;
}

export const createDesktopMcpBindingFactory = (deps: {
  directDiscovery?: typeof createDirectDesktopMcpDiscovery;
  cloudDiscovery?: typeof createCloudDesktopMcpDiscovery;
} = {}): DesktopMcpBindingFactory => {
  const directDiscovery = deps.directDiscovery ?? createDirectDesktopMcpDiscovery;
  const cloudDiscovery = deps.cloudDiscovery ?? createCloudDesktopMcpDiscovery;
  let cachedDirect:
    | { generation: number; binding: McpServiceBinding }
    | null = null;
  const cachedCloud = new Map<string, McpServiceBinding>();

  return {
    direct: generation => {
      if (cachedDirect?.generation === generation) return cachedDirect.binding;
      const binding = new McpServiceBinding({
        serviceTypeId: DESKTOP_MCP_SERVICE_ID,
        discovery: directDiscovery(generation),
      });
      cachedDirect = { generation, binding };
      return binding;
    },
    cloud: input => {
      const key = `${input.accountId}:${input.hostId}:${input.generation}`;
      const cached = cachedCloud.get(key);
      if (cached) return cached;
      if (cachedCloud.size >= 8) cachedCloud.clear();
      const binding = new McpServiceBinding({
        serviceTypeId: DESKTOP_MCP_SERVICE_ID,
        discovery: cloudDiscovery(input),
        requiresCloudAccount: true,
      });
      cachedCloud.set(key, binding);
      return binding;
    },
  };
};

const defaultDesktopMcpBindingFactory = createDesktopMcpBindingFactory();


export interface LocalAgentToolGatewayOptions {
  local?: ToolGatewayClient;
  entry?: CloudToolEntry;
  cloudContext?: () => CloudToolAccountContext;
  json?: typeof requestCloudRelayJson;
  sse?: typeof openCloudRelayPostSse;
  /** Desktop MCP is transport-bound here; Pi Core stays service-generic. */
  desktopMcp?: DesktopMcpBindingFactory;
  /**
   * The current user turn only. It lets the Mobile side bind an explicitly
   * named Host; absence is never an instruction to pick a recent one.
   */
  selectionText?: string;
  /** The immediately preceding local assistant message, if any. */
  previousAssistantText?: string;
  /**
   * Trusted cloud MCP service bindings. `null` disables the dynamic MCP slice;
   * omitted uses the verified default service collection. A single discovery
   * adapter remains accepted for focused adapters/tests.
   */
  mcp?: McpServiceDiscovery | readonly (McpServiceDiscovery | McpServiceBinding)[] | null;
}

type ActiveMcpBinding = Extract<McpServiceBindingOutcome, { status: 'ready' }> & {
  binding: McpServiceBinding;
};

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

const desktopMcpProbeFailure = (
  error: unknown,
): 'unauthorized' | 'unavailable' | null => {
  if (error instanceof McpProtocolError) {
    if (error.kind === 'unauthorized') return 'unauthorized';
    if (error.kind === 'network' || error.kind === 'unavailable') {
      return 'unavailable';
    }
  }
  return probeFailure(error);
};

const currentCloudContext = (): CloudToolAccountContext => {
  const state = useCloudAccountStore.getState();
  const desktop = useDesktopConnectionStore.getState();
  return {
    accountId: state.account?.id ?? null,
    explicitlySignedOut: state.status === 'signed_out',
    cloudSessionInvalid:
      state.status === 'session_rejected' ||
      state.status === 'device_revoked',
    desktopMode: desktop.mode,
    desktopGeneration: desktop.generation,
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

const normalizeMcpBindings = (
  input:
    | McpServiceDiscovery
    | readonly (McpServiceDiscovery | McpServiceBinding)[]
    | null,
  fallbackExecution: ToolGatewayClient,
): readonly McpServiceBinding[] => {
  if (input === null) return [];
  const list: readonly (McpServiceDiscovery | McpServiceBinding)[] =
    Array.isArray(input) ? input : [input as McpServiceDiscovery];
  return list.map((item) =>
    item instanceof McpServiceBinding
      ? item
      : new McpServiceBinding({
          discovery: item,
          fallbackExecution,
          requiresCloudAccount: true,
        }),
  );
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
  private readonly entry: CloudToolEntry;
  private readonly cloudContext: () => CloudToolAccountContext;
  private readonly json: typeof requestCloudRelayJson;
  private readonly sse: typeof openCloudRelayPostSse;
  private readonly desktopMcp: DesktopMcpBindingFactory;
  private readonly selectionText: string;
  private readonly previousAssistantText: string;
  private readonly mcp: readonly McpServiceBinding[];
  private pendingHostSelectionAccount: string | null = null;
  private active: ToolGatewayClient | null = null;
  private pendingDiscovery: Promise<ToolDiscoveryResult> | null = null;
  private services: readonly ToolServiceDescriptor[] = [];
  private catalogRevision: string | undefined;
  private revision = 0;
  /** Desktop transport captured by discovery; local tools stay independent. */
  private desktopTransportMode: 'direct' | 'cloud' | null = null;
  private desktopGeneration = 0;
  private desktopToolNames: ReadonlySet<string> = new Set();
  private mcpBindings: readonly ActiveMcpBinding[] = [];
  /** Tools owned by a binding that was active earlier in this run. */
  private orphanedMcpToolNames: Set<string> = new Set();

  constructor(options: LocalAgentToolGatewayOptions = {}) {
    this.local = options.local ?? localToolGatewayClient;
    this.entry = options.entry ?? cloudRelayEntry;
    this.cloudContext = options.cloudContext ?? currentCloudContext;
    this.json = options.json ?? requestCloudRelayJson;
    this.sse = options.sse ?? openCloudRelayPostSse;
    this.desktopMcp = options.desktopMcp ?? defaultDesktopMcpBindingFactory;
    this.selectionText = normalizeMatchText(options.selectionText ?? '');
    this.previousAssistantText = options.previousAssistantText ?? '';
    this.mcp = normalizeMcpBindings(
      options.mcp === undefined ? defaultMcpServiceBindings : options.mcp,
      this.local,
    );
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
    const mcpBinding = this.mcpBindingForService(request.serviceId);
    if (mcpBinding) {
      const disclosed = await mcpBinding.gateway.discloseTools({
        ...request, catalogRevision: mcpBinding.gateway.catalogRevision,
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
    const mcpBinding = this.mcpBindingForTool(request.name);
    if (mcpBinding) {
      return mcpBinding.gateway.callTool(request, options);
    }
    this.assertMcpBindingNotOrphaned(request.name);
    this.assertDesktopToolStillActive(request.name);
    return this.requireActive().callTool(request, options);
  }

  async resolveApproval(
    approval: ToolApprovalRequest,
    decision: ToolApprovalDecision,
    options?: { signal?: AbortSignal },
  ): Promise<ToolApprovalResolution> {
    const mcpBinding = this.mcpBindingForTool(approval.name);
    if (mcpBinding) {
      return mcpBinding.gateway.resolveApproval(approval, decision, options);
    }
    this.assertMcpBindingNotOrphaned(approval.name);
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
    const current = this.cloudContext();
    if (current.desktopMode !== this.desktopTransportMode ||
        (current.desktopGeneration ?? 0) !== this.desktopGeneration) {
      throw new RemoteHostError(
        'DESKTOP_CONNECTION_INACTIVE',
        'The active Desktop connection changed during the Agent run',
        409,
      );
    }
  }

  private mcpBindingForService(serviceId: string): ActiveMcpBinding | null {
    const matches = this.mcpBindings.filter(
      binding => binding.gateway.serviceId === serviceId,
    );
    if (matches.length > 1) {
      throw new ToolGatewayError(
        'TOOL_NAME_COLLISION',
        `More than one MCP binding claims service ${serviceId}`,
      );
    }
    return matches[0] ?? null;
  }

  private mcpBindingForTool(toolName: string): ActiveMcpBinding | null {
    const matches = this.mcpBindings.filter(
      binding => binding.gateway.ownedToolNames.has(toolName),
    );
    if (matches.length > 1) {
      throw new ToolGatewayError(
        'TOOL_NAME_COLLISION',
        `More than one MCP binding claims tool ${toolName}`,
      );
    }
    return matches[0] ?? null;
  }

  /**
   * A tool disclosed by a binding that has since lost authority must never be
   * silently dispatched to a local/Desktop adapter that happens to share the
   * name.
   */
  private assertMcpBindingNotOrphaned(toolName: string): void {
    if (!this.orphanedMcpToolNames.has(toolName)) return;
    throw new ToolGatewayError(
      'MCP_SERVICE_BINDING_LOST',
      `The MCP service binding that owned ${toolName} is no longer active`,
    );
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
      this.desktopGeneration = 0;
      this.desktopToolNames = new Set();
      this.active = this.local;
      this.pendingHostSelectionAccount = null;
      const tools = await this.local.listTools();
      return this.withIndependentMcp({ tools, notices: [] }, [localService(tools)]);
    }

    if (context.desktopMode === 'direct') {
      // Direct and Cloud are transports for one Desktop MCP service. Keep the
      // transport binding here; Pi Core and disclosure remain service-generic.
      this.desktopTransportMode = 'direct';
      this.desktopGeneration = context.desktopGeneration ?? 0;
      this.desktopToolNames = new Set();
      this.active = this.local;
      const localTools = await this.local.listTools();
      const desktopBinding = this.desktopMcp.direct(this.desktopGeneration);
      return this.withIndependentMcp(
        { tools: localTools, notices: [] },
        [localService(localTools)],
        [desktopBinding],
      );
    }

    this.desktopTransportMode = 'cloud';
    this.desktopGeneration = context.desktopGeneration ?? 0;
    this.desktopToolNames = new Set();
    if (context.explicitlySignedOut) {
      // Cloud Relay cannot be active without a Cloud account. Do not silently
      // fall back to Direct; the user explicitly chose Cloud mode.
      this.active = this.local;
      const tools = await this.local.listTools();
      return this.withIndependentMcp({
        tools,
        notices: [{ code: 'cloud-tools-session-invalid' }],
      }, [localService(tools)]);
    }
    if (!context.accountId) {
      this.active = this.local;
      const tools = await this.local.listTools();
      return this.withIndependentMcp({
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

  /**
   * Composes the trusted MCP service collection with the selected Desktop
   * transport. Each binding is discovered and degraded independently: one
   * unavailable/untrusted service must not remove another service or local
   * ordinary chat.
   */
  private async withIndependentMcp(
    discovery: ToolDiscoveryResult,
    services: readonly ToolServiceDescriptor[],
    additionalBindings: readonly McpServiceBinding[] = [],
  ): Promise<ToolDiscoveryResult> {
    const context = this.cloudContext();
    const eligible = [...this.mcp, ...additionalBindings].filter((binding) => {
      if (!binding.requiresCloudAccount) return true;
      return Boolean(context.accountId) &&
        !context.explicitlySignedOut &&
        !context.cloudSessionInvalid;
    });
    if (eligible.length === 0) {
      this.clearMcp();
      return this.withCatalog(discovery, services);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MCP_DISCOVERY_TIMEOUT_MS);
    let outcomes: McpServiceBindingOutcome[];
    try {
      outcomes = await Promise.all(eligible.map((binding) =>
        binding.discover({ accountId: context.accountId, signal: controller.signal }),
      ));
    } finally {
      clearTimeout(timer);
    }

    const current = this.cloudContext();
    const hasCloudBoundService = eligible.some(
      binding => binding.requiresCloudAccount,
    );
    if (
      hasCloudBoundService &&
      (current.accountId !== context.accountId ||
        current.explicitlySignedOut ||
        (current.cloudSessionInvalid ?? false) !==
          (context.cloudSessionInvalid ?? false))
    ) {
      this.clearMcp();
      throw hostChanged();
    }

    const notices: Array<{ code: ToolDiscoveryNoticeCode }> = [
      ...discovery.notices,
    ];
    const ready: Array<ActiveMcpBinding & { visibleTools: readonly ToolManifest[] }> = [];
    for (let index = 0; index < outcomes.length; index += 1) {
      const outcome = outcomes[index];
      if (outcome.status !== 'ready') {
        if (outcome.notice) notices.push({ code: outcome.notice });
        continue;
      }
      if (outcome.snapshot.tools.length === 0) {
        notices.push({ code: 'mcp-service-degraded' });
        continue;
      }
      try {
        const visibleTools = await outcome.gateway.listTools();
        ready.push({ ...outcome, binding: eligible[index], visibleTools });
      } catch {
        // Lost authority discovered after the async handshake affects only
        // this binding; sibling services and local tools stay usable.
      }
    }

    ready.sort((left, right) => {
      const byId = left.serviceTypeId.localeCompare(right.serviceTypeId);
      return byId !== 0
        ? byId
        : (left.snapshot.bindingKey ?? '').localeCompare(
            right.snapshot.bindingKey ?? '',
          );
    });

    const serviceIds = new Set<string>();
    const ownedNames = new Set<string>();
    for (const entry of ready) {
      if (serviceIds.has(entry.gateway.serviceId)) {
        throw new ToolGatewayError(
          'TOOL_SERVICE_INVALID',
          `More than one MCP binding claims service ${entry.gateway.serviceId}`,
        );
      }
      serviceIds.add(entry.gateway.serviceId);
      for (const name of entry.gateway.ownedToolNames) {
        if (ownedNames.has(name)) {
          throw new ToolGatewayError(
            'TOOL_NAME_COLLISION',
            `MCP tool ${name} is declared by more than one service`,
          );
        }
        ownedNames.add(name);
      }
      if (ownedNames.has(DESKTOP_HOST_DISCOVERY_TOOL)) {
        throw new ToolGatewayError(
          'TOOL_NAME_COLLISION',
          'MCP tool collides with Desktop discovery',
        );
      }
    }

    const existing = services.map((service) => {
      // The old compiled-in read-only wrappers remain the authorized fallback;
      // a verified MCP binding owns those names when available.
      if (service.id === 'mira-mobile-local') {
        return {
          ...service,
          toolNames: service.toolNames.filter((name) => !ownedNames.has(name)),
        };
      }
      if (service.toolNames.some((name) => ownedNames.has(name))) {
        throw new ToolGatewayError(
          'TOOL_NAME_COLLISION',
          'Independent MCP and Desktop tool names collide',
        );
      }
      return service;
    });

    const active: ActiveMcpBinding[] = ready.map((entry) => ({
      status: 'ready',
      serviceTypeId: entry.serviceTypeId,
      gateway: entry.gateway,
      snapshot: entry.snapshot,
      fromCache: entry.fromCache,
      binding: entry.binding,
    }));
    const previousNames = new Set<string>();
    for (const binding of this.mcpBindings) {
      for (const name of binding.gateway.ownedToolNames) previousNames.add(name);
    }
    for (const name of previousNames) {
      if (!ownedNames.has(name)) this.orphanedMcpToolNames.add(name);
    }
    for (const name of ownedNames) this.orphanedMcpToolNames.delete(name);
    this.mcpBindings = active;
    if (active.length === 0) {
      return this.withCatalog({ ...discovery, notices }, services);
    }

    const revisions = active.map(
      (entry) => entry.gateway.catalogRevision,
    );
    const bindingRevision = revisions.length === 1
      ? revisions[0]
      : active.map((entry) =>
          `${entry.gateway.serviceId}@${entry.gateway.catalogRevision}`).join('|');
    const revision = this.catalogRevision === undefined
      ? bindingRevision
      : bindingRevision + ':' + String(++this.revision);
    const tools = discovery.tools.filter((tool) => !ownedNames.has(tool.name));
    const visible = ready.flatMap((entry) => entry.visibleTools);
    // Preserve the existing public initial order: local tools, MCP visible
    // tools, then optional Desktop discovery.
    const discoverDesktop = tools.filter(
      (tool) => tool.name === DESKTOP_HOST_DISCOVERY_TOOL,
    );
    return this.withCatalog({
      ...discovery,
      notices,
      tools: [
        ...tools.filter((tool) => tool.name !== DESKTOP_HOST_DISCOVERY_TOOL),
        ...visible,
        ...discoverDesktop,
      ],
    }, [...existing, ...active.map((entry) => entry.gateway.service)], revision);
  }

  private clearMcp(): void {
    for (const binding of this.mcpBindings) {
      for (const name of binding.gateway.ownedToolNames) {
        this.orphanedMcpToolNames.add(name);
      }
    }
    this.mcpBindings = [];
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
      const outcome = await this.desktopMcp.cloud({
        accountId,
        hostId: candidate.hostId,
        generation: this.desktopGeneration,
        entry: this.entry,
        json: this.json,
        sse: this.sse,
      }).discover({ accountId });
      if (outcome.status !== 'ready') {
        if (outcome.error) throw outcome.error;
        throw new ToolGatewayError(
          outcome.notice ?? 'MCP_SERVICE_UNAVAILABLE',
          'The selected Desktop MCP service is unavailable',
        );
      }
      const snapshot = outcome.snapshot;
      return {
        status: 'usable',
        candidate,
        toolNames: snapshot.tools.map(tool => tool.name),
      };
    } catch (error) {
      const status = desktopMcpProbeFailure(error);
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
    this.desktopGeneration = this.cloudContext().desktopGeneration ?? 0;
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
    const current = this.cloudContext();
    if (
      current.desktopMode !== 'cloud' ||
      current.accountId !== accountId ||
      current.explicitlySignedOut
    ) {
      throw hostChanged();
    }
    this.desktopTransportMode = 'cloud';
    this.desktopGeneration = current.desktopGeneration ?? 0;
    this.desktopToolNames = new Set();
    this.active = this.local;
    const localTools = await this.local.listTools();
    const desktopBinding = this.desktopMcp.cloud({
      accountId,
      hostId,
      generation: this.desktopGeneration,
      entry: this.entry,
      json: this.json,
      sse: this.sse,
    });
    return this.withIndependentMcp(
      { tools: localTools, notices: [] },
      [localService(localTools)],
      [desktopBinding],
    );
  }

  private async localOnly(
    code: ToolDiscoveryNoticeCode,
  ): Promise<ToolDiscoveryResult> {
    this.desktopTransportMode = null;
    this.desktopGeneration = 0;
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
