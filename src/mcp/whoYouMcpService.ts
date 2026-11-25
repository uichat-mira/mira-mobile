import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import { cloudSessionStore } from '../cloud/cloudSessionStore';
import { normalizeCloudAuthBaseUrl, resolveCloudAuthBaseUrl } from '../cloud/cloudAuthConfig';
import {
  WHO_YOU_READ_SCOPE,
  normalizeWhoYouMcpUrl,
  resolveWhoYouMcpUrl,
} from '../whoYou/whoYouConfig';
import {
  discoverWhoYouResource,
  type WhoYouResourceMetadata,
} from '../whoYou/whoYouMcpClient';
import {
  requestWhoYouReadCredential,
  type IssuedWhoYouReadCredential,
} from '../whoYou/whoYouCredential';
import { WhoYouError } from '../whoYou/whoYouError';
import type { ToolGatewayClient, ToolManifest, ToolServiceDescriptor } from '../tools/toolGatewayClient';
import { createWhoYouMcpReadExecutor } from './whoYouMcpReadTools';
import {
  McpProtocolClient,
  McpProtocolError,
  type McpResourceContent,
} from './mcpProtocolClient';
import {
  ServiceCapabilitiesUnsupportedError,
  projectMcpService,
  type McpServiceDegradation,
} from './mcpServiceCapabilities';
import { requiredMailRole } from '../tools/agentToolPolicies';

export const WHO_YOU_MCP_SERVICE_ID = 'who-you';
export const WHO_YOU_MCP_RESOURCE_URI = 'mira://service/who-you/capabilities';
const CAPABILITIES_MIME = 'application/json';

/**
 * Only tools already covered by the existing Mobile mail disclosure approval
 * may be exposed through the dynamic MCP path. This is an execution policy, not
 * a second capability registry: every name is still resolved against the real
 * `tools/list` and its authoritative schema.
 */
export const WHO_YOU_PROTECTED_READ_TOOLS = [
  'whoyou_mail_search',
  'whoyou_mail_message_get',
] as const;

export interface WhoYouMcpServiceSnapshot {
  service: ToolServiceDescriptor;
  tools: readonly ToolManifest[];
  catalogRevision: string;
  degradation: McpServiceDegradation;
  accountId: string;
  /** Real tools already known to the existing Agent entry path. */
  initialToolNames: readonly string[];
  /** Short-lived read credential expiry; checked again before every call. */
  expiresAt: number;
  assertCurrent(): void | Promise<void>;
  /** A per-discovery, short-lived MCP read executor with Mobile mail consent. */
  executionGateway?: ToolGatewayClient;
}

export interface DiscoverWhoYouMcpServiceOptions {
  sessionToken: string;
  accountId: string;
  mcpUrl?: string;
  cloudAuthBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
  credentialRequester?: typeof requestWhoYouReadCredential;
  now?: () => Date;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const identityFailure = (code = 'WHOYOU_IDENTITY_MISMATCH'): McpProtocolError =>
  new McpProtocolError(
    'invalid_response',
    'The Who You service did not confirm the bound Mira Cloud account',
    code,
  );

const validateWhoYouIdentity = (result: unknown, accountId: string): void => {
  if (!isRecord(result) || !isRecord(result.structuredContent)) {
    throw identityFailure('WHOYOU_IDENTITY_INVALID');
  }
  const identity = result.structuredContent;
  if (
    identity.accountId !== accountId ||
    identity.consumerId !== accountId ||
    !Array.isArray(identity.scopes) ||
    identity.scopes.length !== 1 ||
    identity.scopes[0] !== WHO_YOU_READ_SCOPE
  ) {
    throw identityFailure();
  }
};

const readCapabilityResource = async (
  client: McpProtocolClient,
  signal?: AbortSignal,
): Promise<unknown> => {
  let resources;
  try {
    resources = await client.listResources(signal);
  } catch (error) {
    if (error instanceof McpProtocolError &&
        (error.kind === 'rejected' || error.kind === 'unsupported')) {
      return undefined;
    }
    throw error;
  }
  const descriptor = resources.find((entry) => entry.uri === WHO_YOU_MCP_RESOURCE_URI);
  if (!descriptor) return undefined;

  let contents: McpResourceContent[];
  try {
    contents = await client.readResource(descriptor.uri, signal);
  } catch (error) {
    if (error instanceof McpProtocolError &&
        (error.kind === 'rejected' || error.kind === 'unsupported')) {
      return undefined;
    }
    throw error;
  }
  const content = contents.find((entry) => entry.uri === descriptor.uri);
  if (!content) return undefined;
  const mime = (content.mimeType ?? descriptor.mimeType ?? '').toLowerCase();
  if (mime !== CAPABILITIES_MIME) return { unsupportedMimeType: mime };
  try {
    return JSON.parse(content.text) as unknown;
  } catch {
    return { unparsable: true };
  }
};

/**
 * Performs one authenticated MCP discovery for the bound Cloud account:
 * RFC 9728 target/issuer check, short-lived read credential, MCP initialize,
 * identity confirmation, authoritative `tools/list`, and the optional OPS-046
 * v1 capability resource. The resource never supplies schemas or permissions.
 *
 * This function does not execute tools. The existing protected mail consent
 * gateway remains the execution authority for the exposed read tools.
 */
export const discoverWhoYouMcpService = async (
  options: DiscoverWhoYouMcpServiceOptions,
): Promise<WhoYouMcpServiceSnapshot> => {
  if (!options.sessionToken || !options.accountId) {
    throw new WhoYouError(
      'session_rejected',
      '请先登录 Mira Cloud，再使用狐邮服务。',
      'WHOYOU_SESSION_REQUIRED',
    );
  }
  const mcpUrl = normalizeWhoYouMcpUrl(
    options.mcpUrl ?? resolveWhoYouMcpUrl(),
  );
  const cloudAuthBaseUrl = normalizeCloudAuthBaseUrl(
    options.cloudAuthBaseUrl ?? resolveCloudAuthBaseUrl(),
  );

  const metadata: WhoYouResourceMetadata = await discoverWhoYouResource({
    mcpUrl,
    cloudAuthBaseUrl,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const credential: IssuedWhoYouReadCredential =
    await (options.credentialRequester ?? requestWhoYouReadCredential)(
      options.sessionToken,
      options.accountId,
      {
        baseUrl: cloudAuthBaseUrl,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.now ? { now: options.now } : {}),
        ...(options.timeoutMs !== undefined
          ? { timeoutMs: options.timeoutMs }
          : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
  if (credential.claims.accountId !== options.accountId ||
      credential.claims.scopes.length !== 1 ||
      credential.claims.scopes[0] !== WHO_YOU_READ_SCOPE) {
    throw identityFailure('WHOYOU_CREDENTIAL_IDENTITY_MISMATCH');
  }

  const client = new McpProtocolClient({
    endpoint: metadata.resource,
    token: credential.token,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
  const serverInfo = await client.discover(options.signal);
  validateWhoYouIdentity(
    await client.callTool('whoyou_whoami', {}, options.signal),
    options.accountId,
  );
  const toolDescriptors = await client.listTools(options.signal);
  const capabilityResource = serverInfo.resources
    ? await readCapabilityResource(client, options.signal)
    : undefined;

  let projection;
  try {
    projection = projectMcpService({
      serviceId: WHO_YOU_MCP_SERVICE_ID,
      serviceName: '狐邮 Who You',
      serviceDescription:
        'Mira Cloud 账号下已授权的狐邮只读邮件服务；Mobile 本轮仅能搜索收件箱最多10封邮件、读取纯文本正文，并须逐次审批。',
      toolDescriptors,
      capabilityResource,
      grantedScopes: credential.claims.scopes,
      requiredScopes: [WHO_YOU_READ_SCOPE],
      // This binding is the protected mail read slice only. Write/send or
      // destructive MCP capabilities stay outside the binding's policy.
      permittedAccess: ['read'],
      permittedToolNames: WHO_YOU_PROTECTED_READ_TOOLS,
      sensitiveResultFor: (name) => requiredMailRole(name) ?? undefined,
      serverInfo,
    });
  } catch (error) {
    if (error instanceof ServiceCapabilitiesUnsupportedError) {
      throw new McpProtocolError(
        'unauthorized',
        'The Who You credential does not grant the required read scope',
        'WHOYOU_READ_SCOPE_REQUIRED',
      );
    }
    throw error;
  }

  const expiresAt = Date.parse(credential.expiresAt);
  const accountId = options.accountId;
  const sessionToken = options.sessionToken;
  const executionGateway = createWhoYouMcpReadExecutor(client, projection.tools);
  return {
    ...projection,
    accountId,
    executionGateway,
    // Keep the existing search entry visible; body retrieval and any other
    // read tool remain deferred until the model selects the declared capability.
    initialToolNames: ['whoyou_mail_search'],
    expiresAt,
    assertCurrent: async () => {
      const cloud = useCloudAccountStore.getState();
      if (cloud.status !== 'signed_in' || cloud.account?.id !== accountId) {
        throw new McpProtocolError(
          'unauthorized',
          'The Mira Cloud account changed during the MCP service run',
          'WHOYOU_ACCOUNT_CHANGED',
        );
      }
      if (!(Date.now() < expiresAt)) {
        throw new McpProtocolError(
          'unauthorized',
          'The Who You read credential expired',
          'WHOYOU_CREDENTIAL_EXPIRED',
        );
      }
      // Same-account sign-out/sign-in must never resurrect a prior approval.
      // Cloud account ID alone is not a session identity.
      const stored = await cloudSessionStore.load();
      if (!stored || stored.account.id !== accountId ||
          stored.sessionToken !== sessionToken ||
          !(Date.parse(stored.expiresAt) > Date.now())) {
        throw new McpProtocolError(
          'unauthorized',
          'The Mira Cloud session changed during the MCP service run',
          'WHOYOU_SESSION_CHANGED',
        );
      }
    },
  };
};

export interface WhoYouMcpServiceDiscovery {
  discover(input: {
    accountId: string;
    signal?: AbortSignal;
  }): Promise<WhoYouMcpServiceSnapshot>;
}

export interface WhoYouMcpServiceDiscoveryDeps {
  loadSession(): Promise<{ sessionToken: string; account: { id: string }; expiresAt: string } | null>;
  currentCloud(): { status: string; accountId: string | null };
  discover?: typeof discoverWhoYouMcpService;
}

export const createWhoYouMcpServiceDiscovery = (
  deps: WhoYouMcpServiceDiscoveryDeps,
): WhoYouMcpServiceDiscovery => ({
  async discover({ accountId, signal }) {
    const cloud = deps.currentCloud();
    if (cloud.status !== 'signed_in' || cloud.accountId !== accountId) {
      throw new WhoYouError(
        'session_rejected',
        'Mira Cloud 账号已切换，已停止狐邮服务发现。',
        'WHOYOU_ACCOUNT_CHANGED',
      );
    }
    let stored: Awaited<ReturnType<WhoYouMcpServiceDiscoveryDeps['loadSession']>>;
    try {
      stored = await deps.loadSession();
    } catch {
      throw new WhoYouError(
        'unavailable',
        '无法读取 Mira Cloud 会话。',
        'WHOYOU_SESSION_UNAVAILABLE',
      );
    }
    if (!stored || stored.account.id !== accountId ||
        !stored.sessionToken || !(Date.parse(stored.expiresAt) > Date.now())) {
      throw new WhoYouError(
        'session_rejected',
        'Mira Cloud 登录已失效，请重新登录。',
        'WHOYOU_SESSION_EXPIRED',
      );
    }
    return (deps.discover ?? discoverWhoYouMcpService)({
      sessionToken: stored.sessionToken,
      accountId,
      ...(signal ? { signal } : {}),
    });
  },
});

export const whoYouMcpServiceDiscovery = createWhoYouMcpServiceDiscovery({
  loadSession: () => cloudSessionStore.load(),
  currentCloud: () => {
    const cloud = useCloudAccountStore.getState();
    return { status: cloud.status, accountId: cloud.account?.id ?? null };
  },
});
