import { WhoYouError } from './whoYouError';

export interface WhoYouIdentity {
  accountId: string;
  consumerId: string;
  scopes: string[];
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
  expectedScopes: readonly string[],
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
    scopes.length !== expectedScopes.length ||
    new Set(scopes).size !== scopes.length ||
    !expectedScopes.every(scope => scopes.includes(scope))
  ) {
    throw invalidResponse('狐邮只读凭证与当前 Mira Cloud 账号不匹配');
  }
  return {
    accountId: value.accountId,
    consumerId: value.consumerId,
    scopes,
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
