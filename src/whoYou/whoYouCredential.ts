import {
  cloudAuthServiceCredentialsUrl,
  normalizeCloudAuthBaseUrl,
  resolveCloudAuthBaseUrl,
} from '../cloud/cloudAuthConfig';
import {
  WHO_YOU_AUDIENCE,
  WHO_YOU_READ_SCOPE,
} from './whoYouConfig';
import { WhoYouError } from './whoYouError';
import {
  assertWhoYouResponseTarget,
  readSafeErrorCode,
  withWhoYouRequestDeadline,
  type WhoYouRequestInit,
} from './whoYouHttp';

const CLOUD_AUTH_ISSUER = 'mira:cloud-auth';
const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export interface WhoYouCredentialClaims {
  accountId: string;
  deviceId: string;
  scopes: readonly [typeof WHO_YOU_READ_SCOPE];
  expiresAt: string;
}

export interface IssuedWhoYouReadCredential {
  token: string;
  tokenType: 'Bearer';
  audience: typeof WHO_YOU_AUDIENCE;
  expiresAt: string;
  claims: WhoYouCredentialClaims;
}

export interface WhoYouCredentialOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const invalidCredential = (
  message = 'Mira Cloud 返回了无效的狐邮只读凭证',
): WhoYouError => new WhoYouError('invalid_response', message);

const decodeBase64UrlBytes = (segment: string): number[] => {
  const normalized = segment.replace(/-/gu, '+').replace(/_/gu, '/');
  if (
    normalized.length === 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized) ||
    normalized.length % 4 === 1
  ) {
    throw invalidCredential();
  }
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '=',
  );
  const bytes: number[] = [];
  for (let index = 0; index < padded.length; index += 4) {
    const chars = padded.slice(index, index + 4);
    const values = [...chars].map(char =>
      char === '=' ? 0 : BASE64URL_ALPHABET.indexOf(char),
    );
    if (values.some(value => value < 0)) throw invalidCredential();
    const packed =
      (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3];
    const length = chars[2] === '=' ? 1 : chars[3] === '=' ? 2 : 3;
    bytes.push((packed >> 16) & 0xff);
    if (length > 1) bytes.push((packed >> 8) & 0xff);
    if (length > 2) bytes.push(packed & 0xff);
  }
  return bytes;
};

/**
 * JWT claim values may include a Unicode Cloud username, so decode UTF-8
 * explicitly instead of assuming the Relay ticket's ASCII-only identifiers.
 */
const decodeUtf8 = (bytes: readonly number[]): string => {
  let output = '';
  for (let index = 0; index < bytes.length; index += 1) {
    const first = bytes[index];
    if (first <= 0x7f) {
      output += String.fromCharCode(first);
      continue;
    }
    let needed: number;
    let codePoint: number;
    if ((first & 0xe0) === 0xc0) {
      needed = 1;
      codePoint = first & 0x1f;
    } else if ((first & 0xf0) === 0xe0) {
      needed = 2;
      codePoint = first & 0x0f;
    } else if ((first & 0xf8) === 0xf0) {
      needed = 3;
      codePoint = first & 0x07;
    } else {
      throw invalidCredential();
    }
    if (index + needed >= bytes.length) throw invalidCredential();
    for (let offset = 1; offset <= needed; offset += 1) {
      const next = bytes[index + offset];
      if ((next & 0xc0) !== 0x80) throw invalidCredential();
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    index += needed;
    if (
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      throw invalidCredential();
    }
    output += String.fromCodePoint(codePoint);
  }
  return output;
};

const parseJsonSegment = (segment: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeUtf8(decodeBase64UrlBytes(segment))) as unknown;
  } catch (error) {
    if (error instanceof WhoYouError) throw error;
    throw invalidCredential();
  }
  if (!isRecord(parsed)) throw invalidCredential();
  return parsed;
};

const isNumericDate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const parseReadCredentialClaims = (
  token: string,
  expectedAccountId: string,
  nowMs: number,
): WhoYouCredentialClaims => {
  const segments = token.split('.');
  if (segments.length !== 3 || segments.some(segment => segment.length === 0)) {
    throw invalidCredential();
  }

  const header = parseJsonSegment(segments[0]);
  if (
    header.alg !== 'EdDSA' ||
    header.typ !== 'JWT' ||
    typeof header.kid !== 'string' ||
    !/^[A-Za-z0-9._-]{1,64}$/u.test(header.kid)
  ) {
    throw invalidCredential();
  }

  const claims = parseJsonSegment(segments[1]);
  if (
    claims.iss !== CLOUD_AUTH_ISSUER ||
    claims.aud !== WHO_YOU_AUDIENCE ||
    claims.sub !== expectedAccountId ||
    claims.consumer_id !== expectedAccountId ||
    typeof claims.device_id !== 'string' ||
    claims.device_id.length === 0 ||
    !Array.isArray(claims.scope) ||
    claims.scope.length !== 1 ||
    claims.scope[0] !== WHO_YOU_READ_SCOPE ||
    claims.confirmation !== undefined ||
    !isNumericDate(claims.iat) ||
    !isNumericDate(claims.nbf) ||
    !isNumericDate(claims.exp)
  ) {
    throw invalidCredential();
  }
  if (claims.nbf < claims.iat || claims.exp <= claims.nbf) {
    throw invalidCredential();
  }
  const nowSeconds = Math.floor(nowMs / 1000);
  if (claims.nbf > nowSeconds + 60 || claims.exp <= nowSeconds) {
    throw invalidCredential('狐邮只读凭证已失效');
  }

  return {
    accountId: claims.sub,
    deviceId: claims.device_id,
    scopes: [WHO_YOU_READ_SCOPE],
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
};

export const parseIssuedWhoYouReadCredential = (
  value: unknown,
  expectedAccountId: string,
  nowMs: number = Date.now(),
): IssuedWhoYouReadCredential => {
  if (
    !isRecord(value) ||
    typeof value.token !== 'string' ||
    value.token.length === 0 ||
    value.tokenType !== 'Bearer' ||
    value.audience !== WHO_YOU_AUDIENCE ||
    typeof value.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(value.expiresAt))
  ) {
    throw invalidCredential();
  }
  const responseExpiresAt = new Date(value.expiresAt).toISOString();
  if (Date.parse(responseExpiresAt) <= nowMs) {
    throw invalidCredential('狐邮只读凭证已失效');
  }
  const claims = parseReadCredentialClaims(
    value.token,
    expectedAccountId,
    nowMs,
  );
  return {
    token: value.token,
    tokenType: 'Bearer',
    audience: WHO_YOU_AUDIENCE,
    expiresAt: responseExpiresAt,
    claims,
  };
};

const credentialFailure = (
  status: number,
  code: string | undefined,
): WhoYouError => {
  if (status === 401 || status === 403) {
    return new WhoYouError(
      'session_rejected',
      'Mira Cloud 登录已失效，无法获取狐邮只读凭证。',
      code ?? 'WHOYOU_CREDENTIAL_REJECTED',
    );
  }
  if (status === 429 || status >= 500) {
    return new WhoYouError(
      'unavailable',
      'Mira Cloud 暂时无法签发狐邮只读凭证，请稍后重试。',
      code ?? 'WHOYOU_CREDENTIAL_UNAVAILABLE',
    );
  }
  return new WhoYouError(
    'invalid_response',
    'Mira Cloud 拒绝了狐邮只读凭证请求。',
    code ?? 'WHOYOU_CREDENTIAL_REQUEST_REJECTED',
  );
};

/**
 * Exchanges the existing device-bound Cloud Session for one short-lived,
 * read-only Who You bearer. The session token is sent only to Cloud Auth; the
 * returned bearer is never persisted by this module.
 */
export const requestWhoYouReadCredential = async (
  sessionToken: string,
  expectedAccountId: string,
  options: WhoYouCredentialOptions = {},
): Promise<IssuedWhoYouReadCredential> => {
  if (sessionToken.length === 0 || expectedAccountId.length === 0) {
    throw new WhoYouError(
      'session_rejected',
      '需要先登录 Mira Cloud 才能读取狐邮邮箱。',
      'WHOYOU_SESSION_REQUIRED',
    );
  }

  let baseUrl: string;
  try {
    baseUrl = normalizeCloudAuthBaseUrl(
      options.baseUrl ?? resolveCloudAuthBaseUrl(),
    );
  } catch {
    throw new WhoYouError(
      'not_configured',
      'Mira Cloud 地址未配置，无法获取狐邮只读凭证。',
      'WHOYOU_CLOUD_AUTH_URL_INVALID',
    );
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  if (typeof fetchImpl !== 'function') {
    throw new WhoYouError(
      'network',
      '无法连接 Mira Cloud，请检查网络后重试。',
      'WHOYOU_FETCH_UNAVAILABLE',
    );
  }

  return withWhoYouRequestDeadline(async signal => {
    let response: Response;
    try {
      const init: WhoYouRequestInit = {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ audience: WHO_YOU_AUDIENCE }),
        redirect: 'error',
        signal,
      };
      const endpoint = cloudAuthServiceCredentialsUrl(baseUrl);
      response = await fetchImpl(endpoint, init);
      assertWhoYouResponseTarget(response, endpoint);
    } catch (error) {
      if (error instanceof WhoYouError) throw error;
      throw new WhoYouError(
        'network',
        '无法连接 Mira Cloud，请检查网络后重试。',
        'WHOYOU_CLOUD_AUTH_UNREACHABLE',
      );
    }

    if (!response.ok) {
      throw credentialFailure(response.status, await readSafeErrorCode(response));
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw invalidCredential();
    }
    return parseIssuedWhoYouReadCredential(
      body,
      expectedAccountId,
      now().getTime(),
    );
  }, options.timeoutMs);
};
