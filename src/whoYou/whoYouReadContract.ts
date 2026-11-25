import {
  normalizeCloudAuthBaseUrl,
  resolveCloudAuthBaseUrl,
} from '../cloud/cloudAuthConfig';
import {
  normalizeWhoYouMcpUrl,
  WHO_YOU_READ_SCOPE,
  whoYouResourceMetadataUrl,
} from './whoYouConfig';
import { WhoYouError } from './whoYouError';
import {
  assertWhoYouResponseTarget,
  withWhoYouRequestDeadline,
  type WhoYouRequestInit,
} from './whoYouHttp';

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

export interface WhoYouSyncStatus {
  lastSyncedAt: number | null;
  lastError: string | null;
  inProgress: boolean;
  initialImportComplete: boolean;
}

export interface WhoYouMailAddress {
  name: string;
  address: string;
}

export interface WhoYouMailSummary {
  id: string;
  threadId: string;
  direction: 'inbound' | 'outbound';
  from: WhoYouMailAddress[];
  subject: string;
  receivedAt: number;
  snippet: string;
  attachmentCount: number;
}

export interface WhoYouMailSearchPage {
  messages: WhoYouMailSummary[];
  nextCursor: string | null;
}

export interface WhoYouMailMessage extends WhoYouMailSummary {
  body: string;
  truncated: boolean;
}

export interface WhoYouReadSession {
  sessionToken: string;
  accountId: string;
  signal?: AbortSignal;
}

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
  sync?: WhoYouSyncStatus | null;
}

export interface WhoYouSnapshot {
  identity: WhoYouIdentity;
  mailboxes: WhoYouMailbox[];
}

export interface WhoYouSnapshotReader {
  load(input: {
    sessionToken: string;
    accountId: string;
  }): Promise<WhoYouSnapshot>;
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

/** JavaScript Date accepts milliseconds only through +/- 8.64e15. */
const isValidTimestamp = (value: unknown): value is number =>
  isNonNegativeInteger(value) && value <= 8_640_000_000_000_000;

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
  signal?: AbortSignal;
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
  }, input.timeoutMs, input.signal);
};

export const parseToolStructuredContent = (result: unknown): Record<string, unknown> => {
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

export const parseIdentity = (
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

const parseSync = (value: unknown): WhoYouSyncStatus | null => {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) ||
      (value.lastSyncedAt !== null && !isValidTimestamp(value.lastSyncedAt)) ||
      (value.lastError !== null && typeof value.lastError !== 'string') ||
      typeof value.inProgress !== 'boolean' ||
      typeof value.initialImportComplete !== 'boolean') {
    throw invalidResponse('狐邮同步状态不可识别');
  }
  return {
    lastSyncedAt: value.lastSyncedAt as number | null,
    lastError: value.lastError as string | null,
    inProgress: value.inProgress as boolean,
    initialImportComplete: value.initialImportComplete as boolean,
  };
};

const parseAddresses = (value: unknown): WhoYouMailAddress[] => {
  if (!Array.isArray(value) || value.length > 30) throw invalidResponse();
  return value.map(address => {
    if (!isRecord(address) ||
        typeof address.name !== 'string' ||
        !isNonEmptyString(address.address)) throw invalidResponse();
    return { name: address.name.slice(0, 160), address: address.address.slice(0, 320) };
  });
};

const parseMailSummary = (value: unknown): WhoYouMailSummary => {
  if (!isRecord(value) ||
      !isNonEmptyString(value.id) || value.id.length > 80 ||
      !isNonEmptyString(value.threadId) || value.threadId.length > 80 ||
      (value.direction !== 'inbound' && value.direction !== 'outbound') ||
      typeof value.subject !== 'string' ||
      typeof value.snippet !== 'string' ||
      !isValidTimestamp(value.receivedAt) ||
      !isNonNegativeInteger(value.attachmentCount)) {
    throw invalidResponse('狐邮邮件列表包含无效记录');
  }
  return {
    id: value.id,
    threadId: value.threadId,
    direction: value.direction,
    from: parseAddresses(value.from),
    subject: value.subject.slice(0, 500),
    receivedAt: value.receivedAt,
    snippet: value.snippet.slice(0, 1000),
    attachmentCount: value.attachmentCount,
  };
};

export const parseMailSearch = (value: Record<string, unknown>): WhoYouMailSearchPage => {
  if (!Array.isArray(value.messages) || value.messages.length > 50 ||
      (value.nextCursor !== null &&
       (typeof value.nextCursor !== 'string' || value.nextCursor.length > 200))) {
    throw invalidResponse('狐邮邮件搜索结果不可识别');
  }
  return {
    messages: value.messages.map(parseMailSummary),
    nextCursor: value.nextCursor,
  };
};

export const parseMailMessage = (value: Record<string, unknown>): WhoYouMailMessage => {
  const summary = parseMailSummary(value);
  if (value.untrusted !== true || value.bodyKind !== 'text' ||
      typeof value.body !== 'string' || typeof value.truncated !== 'boolean') {
    throw invalidResponse('狐邮没有返回可信契约的纯文本正文');
  }
  return {
    ...summary,
    body: value.body.slice(0, 40_000),
    truncated: value.truncated || value.body.length > 40_000,
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
    !isValidTimestamp(value.createdAt)
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
    ...(value.sync !== undefined ? { sync: parseSync(value.sync) } : {}),
  };
};

export const parseMailboxes = (
  value: Record<string, unknown>,
): WhoYouMailbox[] => {
  if (!Array.isArray(value.identities)) {
    throw invalidResponse('狐邮邮箱列表响应不完整');
  }
  return value.identities.map(parseMailbox);
};
