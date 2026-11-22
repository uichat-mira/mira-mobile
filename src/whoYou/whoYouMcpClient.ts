import {
  normalizeCloudAuthBaseUrl,
  resolveCloudAuthBaseUrl,
} from '../cloud/cloudAuthConfig';
import {
  normalizeWhoYouMcpUrl,
  resolveWhoYouMcpUrl,
  WHO_YOU_READ_SCOPE,
  whoYouResourceMetadataUrl,
} from './whoYouConfig';
import {
  requestWhoYouReadCredential,
  type IssuedWhoYouReadCredential,
  type WhoYouCredentialOptions,
} from './whoYouCredential';
import { WhoYouError } from './whoYouError';
import {
  assertWhoYouResponseTarget,
  withWhoYouRequestDeadline,
  type WhoYouRequestInit,
} from './whoYouHttp';

const MCP_PROTOCOL_VERSION = '2025-06-18';
const WHOAMI_TOOL = 'whoyou_whoami';
const MAILBOX_LIST_TOOL = 'whoyou_mailbox_list';

export interface WhoYouResourceMetadata {
  resource: string;
  authorizationServers: string[];
  scopesSupported: string[];
}

export interface WhoYouIdentity {
  accountId: string;
  consumerId: string;
  scopes: string[];
}

export type WhoYouMailboxKind = 'own_domain' | 'third_party';
export type WhoYouMailboxProvider = 'gmail' | 'microsoft' | 'imap_smtp';
export type WhoYouMailboxStatus = 'active' | 'disabled';
export type WhoYouCredentialStatus =
  | 'active'
  | 'reauth_required'
  | 'unreadable'
  | 'revoked';

export interface WhoYouMailbox {
  mailboxId: string;
  address: string;
  kind: WhoYouMailboxKind;
  provider: WhoYouMailboxProvider | null;
  status: WhoYouMailboxStatus;
  credentialStatus: WhoYouCredentialStatus | null;
  quotaBytes: number;
  bytesUsed: number;
  messageCount: number;
  createdAt: string;
}

export interface WhoYouSnapshot {
  identity: WhoYouIdentity;
  mailboxes: WhoYouMailbox[];
}

export interface WhoYouMcpClientLike {
  load(input: {
    sessionToken: string;
    accountId: string;
  }): Promise<WhoYouSnapshot>;
}

export interface WhoYouClientOptions extends WhoYouCredentialOptions {
  mcpUrl?: string;
  credentialRequester?: typeof requestWhoYouReadCredential;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const invalidResponse = (
  message = '狐邮返回了无法识别的只读邮箱数据',
): WhoYouError => new WhoYouError('invalid_response', message);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const safeCode = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[A-Za-z0-9._-]{1,80}$/u.test(value)
    ? value
    : undefined;

const transportFailure = (status: number): WhoYouError => {
  if (status === 401 || status === 403) {
    return new WhoYouError(
      'unauthorized',
      '狐邮拒绝了当前只读凭证，请稍后重试或重新登录 Mira Cloud。',
      'WHOYOU_MCP_UNAUTHORIZED',
    );
  }
  if (status === 429 || status >= 500) {
    return new WhoYouError(
      'unavailable',
      '狐邮暂时不可用，请稍后重试。',
      'WHOYOU_MCP_UNAVAILABLE',
    );
  }
  return invalidResponse('狐邮拒绝了只读请求');
};

const jsonRpcResult = (
  value: unknown,
  expectedId: number | null,
): unknown => {
  if (!isRecord(value) || value.jsonrpc !== '2.0') {
    throw invalidResponse('狐邮返回了无效的 MCP 响应');
  }
  if (expectedId !== null && value.id !== expectedId) {
    throw invalidResponse('狐邮返回了不匹配的 MCP 响应');
  }
  if (value.error !== undefined) {
    const code = isRecord(value.error) ? safeCode(value.error.code) : undefined;
    throw new WhoYouError(
      'rejected',
      '狐邮返回了只读请求错误。',
      code ?? 'WHOYOU_MCP_ERROR',
    );
  }
  if (!('result' in value)) {
    throw invalidResponse('狐邮返回了不完整的 MCP 响应');
  }
  return value.result;
};

const parseSseResult = (text: string, expectedId: number): unknown => {
  const events = text.split(/\r?\n\r?\n/u);
  for (const event of events) {
    const data = event
      .split(/\r?\n/u)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice('data:'.length).trimStart())
      .join('\n');
    if (data.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      continue;
    }
    if (isRecord(parsed) && parsed.id === expectedId) {
      return jsonRpcResult(parsed, expectedId);
    }
  }
  throw invalidResponse('狐邮没有返回 MCP 结果');
};

const parseRpcResponse = async (
  response: Response,
  expectedId: number,
): Promise<unknown> => {
  if (!response.ok) throw transportFailure(response.status);
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.toLowerCase().includes('text/event-stream')) {
    return parseSseResult(text, expectedId);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw invalidResponse('狐邮返回了无法解析的 MCP 响应');
  }
  return jsonRpcResult(parsed, expectedId);
};

const parseResourceMetadata = (
  value: unknown,
  expectedResource: string,
  expectedAuthorizationServer: string,
): WhoYouResourceMetadata => {
  if (!isRecord(value) || !Array.isArray(value.authorization_servers)) {
    throw invalidResponse('狐邮资源发现响应不完整');
  }
  if (value.resource !== expectedResource) {
    throw invalidResponse('狐邮资源发现返回了不同地址');
  }
  const authorizationServers = value.authorization_servers.filter(
    (entry): entry is string => typeof entry === 'string',
  );
  if (!authorizationServers.includes(expectedAuthorizationServer)) {
    throw invalidResponse('狐邮资源发现未指向 Mira Cloud Auth');
  }
  if (
    !Array.isArray(value.scopes_supported) ||
    !value.scopes_supported.includes(WHO_YOU_READ_SCOPE)
  ) {
    throw invalidResponse('狐邮资源发现未声明只读权限');
  }
  if (
    value.bearer_methods_supported !== undefined &&
    (!Array.isArray(value.bearer_methods_supported) ||
      !value.bearer_methods_supported.includes('header'))
  ) {
    throw invalidResponse('狐邮资源发现不支持 Header 凭证');
  }
  return {
    resource: expectedResource,
    authorizationServers,
    scopesSupported: value.scopes_supported.filter(
      (entry): entry is string => typeof entry === 'string',
    ),
  };
};

export const discoverWhoYouResource = async (input: {
  mcpUrl: string;
  cloudAuthBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<WhoYouResourceMetadata> => {
  let mcpUrl: string;
  let cloudAuthBaseUrl: string;
  try {
    mcpUrl = normalizeWhoYouMcpUrl(input.mcpUrl);
    cloudAuthBaseUrl = normalizeCloudAuthBaseUrl(
      input.cloudAuthBaseUrl ?? resolveCloudAuthBaseUrl(),
    );
  } catch {
    throw new WhoYouError(
      'not_configured',
      '狐邮或 Mira Cloud Auth 地址未配置。',
      'WHOYOU_RESOURCE_CONFIG_INVALID',
    );
  }
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new WhoYouError(
      'network',
      '无法连接狐邮，请检查网络后重试。',
      'WHOYOU_FETCH_UNAVAILABLE',
    );
  }

  return withWhoYouRequestDeadline(async signal => {
    let response: Response;
    try {
      const init: WhoYouRequestInit = {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal,
      };
      const endpoint = whoYouResourceMetadataUrl(mcpUrl);
      response = await fetchImpl(endpoint, init);
      assertWhoYouResponseTarget(response, endpoint);
    } catch (error) {
      if (error instanceof WhoYouError) throw error;
      throw new WhoYouError(
        'network',
        '无法连接狐邮，请检查网络后重试。',
        'WHOYOU_DISCOVERY_UNREACHABLE',
      );
    }
    if (!response.ok) throw transportFailure(response.status);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw invalidResponse('狐邮资源发现响应无法解析');
    }
    return parseResourceMetadata(body, mcpUrl, cloudAuthBaseUrl);
  }, input.timeoutMs);
};

const parseToolStructuredContent = (result: unknown): Record<string, unknown> => {
  if (!isRecord(result)) throw invalidResponse();
  if (result.isError !== undefined && typeof result.isError !== 'boolean') {
    throw invalidResponse();
  }
  if (result.isError === true) {
    const code = isRecord(result.structuredContent)
      ? safeCode(result.structuredContent.error)
      : undefined;
    throw new WhoYouError(
      'rejected',
      '狐邮拒绝了只读邮箱请求。',
      code ?? 'WHOYOU_TOOL_ERROR',
    );
  }
  if (!isRecord(result.structuredContent)) {
    throw invalidResponse('狐邮只读工具没有返回结构化数据');
  }
  return result.structuredContent;
};

const parseIdentity = (
  value: Record<string, unknown>,
  expectedAccountId: string,
): WhoYouIdentity => {
  if (
    !isNonEmptyString(value.accountId) ||
    !isNonEmptyString(value.consumerId) ||
    !Array.isArray(value.scopes) ||
    !value.scopes.every(entry => typeof entry === 'string')
  ) {
    throw invalidResponse('狐邮身份响应不完整');
  }
  const scopes = value.scopes as string[];
  if (
    value.accountId !== expectedAccountId ||
    value.consumerId !== expectedAccountId ||
    scopes.length !== 1 ||
    scopes[0] !== WHO_YOU_READ_SCOPE
  ) {
    throw invalidResponse('狐邮只读凭证与当前 Mira Cloud 账号不匹配');
  }
  return {
    accountId: value.accountId,
    consumerId: value.consumerId,
    scopes,
  };
};

const parseMailbox = (value: unknown): WhoYouMailbox => {
  if (!isRecord(value)) throw invalidResponse('狐邮邮箱列表包含无效条目');
  const kind = value.kind;
  const provider = value.provider;
  const status = value.status;
  const credentialStatus = value.credentialStatus;
  if (
    !isNonEmptyString(value.mailboxId) ||
    !isNonEmptyString(value.address) ||
    (kind !== 'own_domain' && kind !== 'third_party') ||
    (status !== 'active' && status !== 'disabled') ||
    !isNonNegativeInteger(value.quotaBytes) ||
    !isNonNegativeInteger(value.bytesUsed) ||
    !isNonNegativeInteger(value.messageCount) ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt)
  ) {
    throw invalidResponse('狐邮邮箱列表包含无效条目');
  }
  let normalizedProvider: WhoYouMailboxProvider | null;
  if (kind === 'own_domain') {
    if (provider !== null) throw invalidResponse('狐邮邮箱列表包含无效提供方');
    normalizedProvider = null;
  } else {
    if (
      provider !== 'gmail' &&
      provider !== 'microsoft' &&
      provider !== 'imap_smtp'
    ) {
      throw invalidResponse('狐邮邮箱列表包含无效提供方');
    }
    normalizedProvider = provider;
  }
  if (
    credentialStatus !== null &&
    credentialStatus !== 'active' &&
    credentialStatus !== 'reauth_required' &&
    credentialStatus !== 'unreadable' &&
    credentialStatus !== 'revoked'
  ) {
    throw invalidResponse('狐邮邮箱列表包含无效授权状态');
  }
  return {
    mailboxId: value.mailboxId,
    address: value.address,
    kind,
    provider: normalizedProvider,
    status,
    credentialStatus,
    quotaBytes: value.quotaBytes,
    bytesUsed: value.bytesUsed,
    messageCount: value.messageCount,
    createdAt: new Date(value.createdAt).toISOString(),
  };
};

const parseMailboxes = (
  value: Record<string, unknown>,
): WhoYouMailbox[] => {
  if (!Array.isArray(value.identities)) {
    throw invalidResponse('狐邮邮箱列表响应不完整');
  }
  return value.identities.map(parseMailbox);
};

/**
 * Minimal read-only Streamable HTTP MCP client. It performs the RFC 9728
 * discovery check, requests a fresh read credential for each load, completes a
 * stateless legacy MCP handshake and calls only the two approved read tools.
 */
export class WhoYouMcpClient implements WhoYouMcpClientLike {
  private readonly mcpUrl: string;
  private readonly cloudAuthBaseUrl: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutMs?: number;
  private readonly credentialRequester: typeof requestWhoYouReadCredential;
  private metadata: WhoYouResourceMetadata | null = null;
  private pendingDiscovery: Promise<WhoYouResourceMetadata> | null = null;
  private nextRequestId = 1;

  constructor(options: WhoYouClientOptions = {}) {
    this.mcpUrl = normalizeWhoYouMcpUrl(
      options.mcpUrl ?? resolveWhoYouMcpUrl(),
    );
    this.cloudAuthBaseUrl = normalizeCloudAuthBaseUrl(
      options.baseUrl ?? resolveCloudAuthBaseUrl(),
    );
    this.fetchImpl = options.fetchImpl;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs;
    this.credentialRequester =
      options.credentialRequester ?? requestWhoYouReadCredential;
  }

  private discover(): Promise<WhoYouResourceMetadata> {
    if (this.metadata) return Promise.resolve(this.metadata);
    if (this.pendingDiscovery) return this.pendingDiscovery;
    const pending = discoverWhoYouResource({
      mcpUrl: this.mcpUrl,
      cloudAuthBaseUrl: this.cloudAuthBaseUrl,
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
    }).then(metadata => {
      this.metadata = metadata;
      return metadata;
    });
    this.pendingDiscovery = pending;
    const release = () => {
      if (this.pendingDiscovery === pending) this.pendingDiscovery = null;
    };
    void pending.then(release, release);
    return pending;
  }

  private async sendRpc(
    token: string,
    body: Record<string, unknown>,
    expectedId: number,
    protocolVersion?: string,
  ): Promise<unknown> {
    const fetchImpl = this.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new WhoYouError(
        'network',
        '无法连接狐邮，请检查网络后重试。',
        'WHOYOU_FETCH_UNAVAILABLE',
      );
    }
    return withWhoYouRequestDeadline(async signal => {
      let response: Response;
      try {
        const init: WhoYouRequestInit = {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${token}`,
            ...(protocolVersion
              ? { 'MCP-Protocol-Version': protocolVersion }
              : {}),
          },
          body: JSON.stringify(body),
          redirect: 'error',
          signal,
        };
        response = await fetchImpl(this.mcpUrl, init);
        assertWhoYouResponseTarget(response, this.mcpUrl);
      } catch (error) {
        if (error instanceof WhoYouError) throw error;
        throw new WhoYouError(
          'network',
          '无法连接狐邮，请检查网络后重试。',
          'WHOYOU_MCP_UNREACHABLE',
        );
      }
      return parseRpcResponse(response, expectedId);
    }, this.timeoutMs);
  }

  private async sendInitialized(token: string): Promise<void> {
    const fetchImpl = this.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new WhoYouError(
        'network',
        '无法连接狐邮，请检查网络后重试。',
        'WHOYOU_FETCH_UNAVAILABLE',
      );
    }
    await withWhoYouRequestDeadline(async signal => {
      let response: Response;
      try {
        const init: WhoYouRequestInit = {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${token}`,
            'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'notifications/initialized',
          }),
          redirect: 'error',
          signal,
        };
        response = await fetchImpl(this.mcpUrl, init);
        assertWhoYouResponseTarget(response, this.mcpUrl);
      } catch (error) {
        if (error instanceof WhoYouError) throw error;
        throw new WhoYouError(
          'network',
          '无法连接狐邮，请检查网络后重试。',
          'WHOYOU_MCP_UNREACHABLE',
        );
      }
      if (!response.ok) throw transportFailure(response.status);
    }, this.timeoutMs);
  }

  private async callTool(
    token: string,
    name: string,
  ): Promise<Record<string, unknown>> {
    const id = this.nextRequestId++;
    const result = await this.sendRpc(
      token,
      {
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name, arguments: {} },
      },
      id,
      MCP_PROTOCOL_VERSION,
    );
    return parseToolStructuredContent(result);
  }

  async load(input: {
    sessionToken: string;
    accountId: string;
  }): Promise<WhoYouSnapshot> {
    await this.discover();

    let credential: IssuedWhoYouReadCredential;
    try {
      credential = await this.credentialRequester(
        input.sessionToken,
        input.accountId,
        {
          baseUrl: this.cloudAuthBaseUrl,
          fetchImpl: this.fetchImpl,
          now: this.now,
          timeoutMs: this.timeoutMs,
        },
      );
    } catch (error) {
      if (error instanceof WhoYouError) throw error;
      throw new WhoYouError(
        'unavailable',
        '无法获取狐邮只读凭证，请稍后重试。',
        'WHOYOU_CREDENTIAL_FAILED',
      );
    }

    const initializeId = this.nextRequestId++;
    const initialized = await this.sendRpc(
      credential.token,
      {
        jsonrpc: '2.0',
        id: initializeId,
        method: 'initialize',
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'mira-mobile', version: '1' },
        },
      },
      initializeId,
    );
    if (
      !isRecord(initialized) ||
      initialized.protocolVersion !== MCP_PROTOCOL_VERSION
    ) {
      throw invalidResponse('狐邮没有接受只读 MCP 协议版本');
    }

    await this.sendInitialized(credential.token);

    const identity = parseIdentity(
      await this.callTool(credential.token, WHOAMI_TOOL),
      input.accountId,
    );
    const mailboxes = parseMailboxes(
      await this.callTool(credential.token, MAILBOX_LIST_TOOL),
    );
    return { identity, mailboxes };
  }
}

export const whoYouMcpClient = new WhoYouMcpClient();
