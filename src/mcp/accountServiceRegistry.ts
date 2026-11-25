import { bytesToBase64Url, sha256, utf8Bytes } from '../cloud/pkce';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import {
  cloudAuthServiceCredentialUrl,
  cloudAuthServicesUrl,
  normalizeCloudAuthBaseUrl,
  resolveCloudAuthBaseUrl,
} from '../cloud/cloudAuthConfig';
import {
  cloudSessionStore,
  type StoredCloudSession,
} from '../cloud/cloudSessionStore';
import type { ToolGatewayClient, ToolManifest } from '../tools/toolGatewayClient';
import {
  McpProtocolClient,
  McpProtocolError,
  MCP_PROTOCOL_VERSION,
  type McpResourceContent,
} from './mcpProtocolClient';
import { projectMcpService } from './mcpServiceCapabilities';
import { createWhoYouMcpReadExecutor } from './whoYouMcpReadTools';
import { discoverWhoYouResource, parseToolStructuredContent, parseIdentity, parseMailboxes, type WhoYouReadSession, type WhoYouSnapshot } from '../whoYou/whoYouReadContract';
import { WhoYouError } from '../whoYou/whoYouError';
import { requiredMailRole } from '../tools/agentToolPolicies';
import {
  McpServiceBinding,
  type McpServiceDiscovery,
  type McpServiceDirectory,
  type McpServiceSnapshot,
} from './mcpServiceBinding';

/**
 * Mira ID instance service directory V1 (cloud-auth OPS-052 / MOB-105).
 *
 * A registration is an account-scoped authorization binding. The catalog is
 * metadata only: a service bearer is requested for one exact revision and is
 * sent only to that service's declared HTTPS endpoint. The Cloud Session never
 * leaves Cloud Auth.
 */

export const SERVICE_REGISTRY_PROTOCOL_NAME = 'mcp';
export const SERVICE_REGISTRY_CATALOG_MAX_AGE_MS = 5 * 60_000;
export const SERVICE_REGISTRY_CREDENTIAL_MAX_TTL_MS = 11 * 60_000;
export const SERVICE_REGISTRY_MAX_SERVICES = 128;

const CLOUD_AUTH_ISSUER = 'mira:cloud-auth';
const SERVICE_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const PROJECT_ID_PATTERN = SERVICE_ID_PATTERN;
const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;
const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_TEXT_RESULT_BYTES = 256 * 1024;


export interface AccountServiceProtocol {
  name: string;
  version: string;
  endpoint: string;
}

export interface AccountServiceDefinition {
  appId: string;
  serviceId: string;
  projectId: string;
  displayName: string;
  protocol: AccountServiceProtocol;
  resource: string;
  scopes: readonly string[];
  targets?: readonly string[];
  capabilities?: readonly { id: string; title: string; description?: string; toolRefs: string[] }[];
}

export interface AccountServiceEntry {
  definition: AccountServiceDefinition;
  revision: number;
  manifestRevision: number;
}

export interface AccountServiceCredentialClaims {
  accountId: string;
  deviceId: string;
  scopes: readonly string[];
  expiresAt: string;
}

export interface IssuedAccountServiceCredential {
  token: string;
  tokenType: 'Bearer';
  appId: string;
  resource: string;
  expiresAt: string;
  serviceId: string;
  revision: number;
  claims: AccountServiceCredentialClaims;
}

interface ValidatedSession {
  sessionToken: string;
  accountId: string;
  expiresAt: string;
}

interface CachedCatalog {
  accountId: string;
  sessionToken: string;
  entries: readonly AccountServiceEntry[];
  fetchedAt: number;
  expiresAt: number;
}

interface CatalogRequestOptions {
  accountId: string;
  sessionToken: string;
  signal?: AbortSignal;
  force?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const nonEmpty = (value: unknown, max = 2_048): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

const invalidCatalog = (code = 'SERVICE_CATALOG_INVALID'): McpProtocolError =>
  new McpProtocolError(
    'invalid_response',
    'Mira ID returned an invalid service catalog',
    code,
  );

const invalidCredential = (code = 'SERVICE_CREDENTIAL_INVALID'): McpProtocolError =>
  new McpProtocolError(
    'invalid_response',
    'Mira ID returned an invalid service credential',
    code,
  );

const validServiceScopes = (scopes: unknown): scopes is string[] =>
  Array.isArray(scopes) && scopes.length <= 32 &&
  new Set(scopes).size === scopes.length && scopes.every(scope => nonEmpty(scope, 140));

// Full exact tuple remains authoritative. The bounded digest is a local UI/disclosure ID.
export const accountServiceIdentity = (definition: Pick<AccountServiceDefinition, 'appId' | 'serviceId' | 'resource'>): string =>
  'app-' + bytesToBase64Url(sha256(utf8Bytes(JSON.stringify([
    definition.appId, definition.serviceId, definition.resource,
  ]))));

const parseEndpoint = (value: unknown): string => {
  if (!nonEmpty(value, MAX_ENDPOINT_LENGTH)) return failEndpoint();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return failEndpoint();
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.hash || /[\s\\*]/u.test(value) || value !== value.trim()
  ) {
    return failEndpoint();
  }
  return value;
};

const failEndpoint = (): never => {
  throw invalidCatalog('SERVICE_CATALOG_ENDPOINT_INVALID');
};

const parseProtocol = (value: unknown): AccountServiceProtocol => {
  if (!isRecord(value) ||
      !nonEmpty(value.name, 80) ||
      !nonEmpty(value.version, 80)) {
    throw invalidCatalog('SERVICE_CATALOG_PROTOCOL_INVALID');
  }
  return {
    name: value.name,
    version: value.version,
    endpoint: parseEndpoint(value.endpoint),
  };
};

const parseDefinition = (value: unknown): AccountServiceDefinition => {
  if (!isRecord(value) || !nonEmpty(value.appId, 160) || !APP_ID_PATTERN.test(value.appId) ||
      !nonEmpty(value.serviceId, 64) || !SERVICE_ID_PATTERN.test(value.serviceId) ||
      !nonEmpty(value.projectId, 64) || !PROJECT_ID_PATTERN.test(value.projectId) ||
      !nonEmpty(value.name, 100) || value.type !== 'mcp' ||
      !validServiceScopes(value.scopes)) throw invalidCatalog('SERVICE_CATALOG_DEFINITION_INVALID');
  const protocol = parseProtocol(value.protocol);
  const resource = parseEndpoint(value.resource);
  if (new URL(protocol.endpoint).origin !== new URL(resource).origin) throw invalidCatalog('SERVICE_CATALOG_ENDPOINT_INVALID');
  const targets = value.targets;
  if (targets !== undefined && (!Array.isArray(targets) || targets.length > 2 ||
      !targets.every(target => target === 'mobile' || target === 'desktop'))) throw invalidCatalog();
  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities.slice(0, 128).flatMap(cap => {
      if (!isRecord(cap) || !nonEmpty(cap.id, 64) || !/^[a-z][a-z0-9.-]{0,63}$/u.test(cap.id) ||
          !nonEmpty(cap.title, 100) || !Array.isArray(cap.toolRefs) || cap.toolRefs.length > 256 ||
          !cap.toolRefs.every(name => nonEmpty(name, 200))) return [];
      return [{ id: cap.id, title: cap.title,
        ...(nonEmpty(cap.description, 500) ? { description: cap.description } : {}),
        toolRefs: cap.toolRefs as string[] }];
    }) : undefined;
  return { appId: value.appId, serviceId: value.serviceId, projectId: value.projectId,
    displayName: value.name, protocol, resource, scopes: [...value.scopes],
    ...(Array.isArray(targets) ? { targets } : {}), ...(capabilities ? { capabilities } : {}) };
};

export const parseAccountServiceCatalog = (value: unknown): AccountServiceEntry[] => {
  if (!isRecord(value) || !Array.isArray(value.services) ||
      value.services.length > SERVICE_REGISTRY_MAX_SERVICES) throw invalidCatalog();
  const entries: AccountServiceEntry[] = [];
  const seen = new Set<string>();
  const conflicts = new Set<string>();
  for (const raw of value.services) {
    if (!isRecord(raw) || typeof raw.revision !== 'number' || !Number.isSafeInteger(raw.revision) || raw.revision < 1 ||
        typeof raw.manifestRevision !== 'number' || !Number.isSafeInteger(raw.manifestRevision) || raw.manifestRevision < 1) continue;
    let definition: AccountServiceDefinition;
    try { definition = parseDefinition(raw); } catch { continue; }
    const identity = JSON.stringify([definition.appId, definition.serviceId]);
    if (seen.has(identity)) { conflicts.add(identity); continue; }
    seen.add(identity);
    entries.push({ definition, revision: raw.revision, manifestRevision: raw.manifestRevision });
  }
  return entries.filter(entry => !conflicts.has(JSON.stringify([entry.definition.appId, entry.definition.serviceId])));
};

const decodeBase64UrlBytes = (segment: string): number[] => {
  const normalized = segment.replace(/-/gu, '+').replace(/_/gu, '/');
  if (normalized.length === 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized) ||
      normalized.length % 4 === 1) {
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
    if (codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
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
  } catch {
    throw invalidCredential();
  }
  if (!isRecord(parsed)) throw invalidCredential();
  return parsed;
};

const isNumericDate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const parseCredentialClaims = (input: {
  token: string;
  accountId: string;
  appId: string;
  serviceId: string;
  resource: string;
  nowMs: number;
}): AccountServiceCredentialClaims => {
  const segments = input.token.split('.');
  if (segments.length !== 3 || segments.some(segment => segment.length === 0)) {
    throw invalidCredential();
  }
  const header = parseJsonSegment(segments[0]);
  if (header.alg !== 'EdDSA' || header.typ !== 'JWT' ||
      !nonEmpty(header.kid, 64)) {
    throw invalidCredential('SERVICE_CREDENTIAL_HEADER_INVALID');
  }
  const claims = parseJsonSegment(segments[1]);
  if (claims.iss !== CLOUD_AUTH_ISSUER ||
      claims.aud !== input.resource || claims.resource !== input.resource ||
      claims.app_id !== input.appId || claims.service_id !== input.serviceId ||
      claims.sub !== input.accountId ||
      Object.keys(claims).some(key => !['iss','sub','aud','device_id','app_id','service_id','resource','scope','iat','nbf','exp'].includes(key)) ||
      !nonEmpty(claims.device_id, 200) ||
      !validServiceScopes(claims.scope) ||
      !isNumericDate(claims.iat) ||
      !isNumericDate(claims.nbf) ||
      !isNumericDate(claims.exp)) {
    throw invalidCredential('SERVICE_CREDENTIAL_CLAIMS_INVALID');
  }
  if (claims.nbf < claims.iat || claims.exp <= claims.nbf || claims.exp - claims.iat > 600) {
    throw invalidCredential('SERVICE_CREDENTIAL_WINDOW_INVALID');
  }
  const nowSeconds = Math.floor(input.nowMs / 1000);
  if (claims.nbf > nowSeconds + 60 || claims.exp <= nowSeconds) {
    throw invalidCredential('SERVICE_CREDENTIAL_EXPIRED');
  }
  return {
    accountId: claims.sub,
    deviceId: claims.device_id,
    scopes: [...new Set(claims.scope as string[])],
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
};

export const parseIssuedAccountServiceCredential = (
  value: unknown,
  expected: {
    accountId: string;
    appId: string;
    serviceId: string;
    resource: string;
    revision: number;
    nowMs?: number;
  },
): IssuedAccountServiceCredential => {
  const nowMs = expected.nowMs ?? Date.now();
  if (!isRecord(value) ||
      !nonEmpty(value.token, 16_384) ||
      value.tokenType !== 'Bearer' ||
      value.appId !== expected.appId || value.serviceId !== expected.serviceId ||
      value.revision !== expected.revision || value.resource !== expected.resource ||
      !validServiceScopes(value.scopes) ||
      !nonEmpty(value.expiresAt, 80) ||
      !Number.isFinite(Date.parse(value.expiresAt))) {
    throw invalidCredential();
  }
  const expiresAt = new Date(value.expiresAt).toISOString();
  const expiresAtMs = Date.parse(expiresAt);
  if (expiresAtMs <= nowMs ||
      expiresAtMs > nowMs + SERVICE_REGISTRY_CREDENTIAL_MAX_TTL_MS) {
    throw invalidCredential('SERVICE_CREDENTIAL_TTL_INVALID');
  }
  const claims = parseCredentialClaims({
    token: value.token,
    accountId: expected.accountId,
    appId: expected.appId,
    serviceId: expected.serviceId,
    resource: expected.resource,
    nowMs,
  });
  if (expiresAt !== claims.expiresAt || value.scopes.length !== claims.scopes.length ||
      !value.scopes.every(scope => claims.scopes.includes(scope))) {
    throw invalidCredential('SERVICE_CREDENTIAL_WINDOW_INVALID');
  }
  return {
    token: value.token,
    tokenType: 'Bearer',
    appId: expected.appId,
    resource: expected.resource,
    expiresAt,
    serviceId: value.serviceId,
    revision: value.revision,
    claims,
  };
};

const safeErrorCode = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[A-Za-z0-9._-]{1,80}$/u.test(value)
    ? value
    : undefined;

const readErrorCode = async (response: Response): Promise<string | undefined> => {
  try {
    const body = await response.json() as unknown;
    if (isRecord(body)) {
      return (isRecord(body.error) ? safeErrorCode(body.error.code) : safeErrorCode(body.error)) ?? safeErrorCode(body.code);
    }
  } catch {
    // Error bodies are advisory; status remains authoritative.
  }
  return undefined;
};

const requestFailure = (status: number, code: string | undefined): McpProtocolError => {
  if (status === 401 || status === 403 || status === 404) {
    return new McpProtocolError(
      'unauthorized',
      'Mira ID no longer authorizes this service',
      code ?? 'SERVICE_REGISTRY_UNAUTHORIZED',
      status,
    );
  }
  if (status === 409) {
    return new McpProtocolError(
      'unavailable',
      'The service registration changed or is not ready',
      code ?? 'SERVICE_REGISTRATION_CHANGED',
      status,
    );
  }
  if (status === 429 || status >= 500) {
    return new McpProtocolError(
      'unavailable',
      'Mira ID service registry is temporarily unavailable',
      code ?? 'SERVICE_REGISTRY_UNAVAILABLE',
      status,
    );
  }
  return new McpProtocolError(
    'invalid_response',
    'Mira ID rejected the service registry request',
    code ?? 'SERVICE_REGISTRY_REJECTED',
    status,
  );
};

const assertResponseTarget = (response: Response, expectedUrl: string): void => {
  if (!response.url) return;
  try {
    const actual = new URL(response.url);
    const expected = new URL(expectedUrl);
    if (actual.origin !== expected.origin ||
        actual.pathname !== expected.pathname) {
      throw new McpProtocolError(
        'invalid_response',
        'The service registry response came from a different endpoint',
        'SERVICE_REGISTRY_TARGET_CHANGED',
      );
    }
  } catch (error) {
    if (error instanceof McpProtocolError) throw error;
    throw new McpProtocolError(
      'invalid_response',
      'The service registry response target is invalid',
      'SERVICE_REGISTRY_TARGET_INVALID',
    );
  }
};

const withDeadline = async <T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  callerSignal?: AbortSignal,
): Promise<T> => {
  if (callerSignal?.aborted) {
    throw new McpProtocolError(
      'cancelled',
      'Service registry request was cancelled',
      'SERVICE_REGISTRY_CANCELLED',
    );
  }
  const controller = new AbortController();
  let abortFromCaller: (() => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    if (!callerSignal) return;
    abortFromCaller = () => {
      controller.abort();
      reject(new McpProtocolError(
        'cancelled',
        'Service registry request was cancelled',
        'SERVICE_REGISTRY_CANCELLED',
      ));
    };
    callerSignal.addEventListener('abort', abortFromCaller, { once: true });
    if (callerSignal.aborted) abortFromCaller();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new McpProtocolError(
        'network',
        'The service registry request timed out',
        'SERVICE_REGISTRY_TIMEOUT',
      ));
    }, timeoutMs);
  });
  const request = Promise.resolve()
    .then(() => operation(controller.signal))
    .catch((error: unknown) => {
      if (error instanceof McpProtocolError) throw error;
      throw new McpProtocolError(
        'network',
        'Unable to reach Mira ID service registry',
        'SERVICE_REGISTRY_UNREACHABLE',
      );
    });
  try {
    return await Promise.race([request, deadline, cancellation]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abortFromCaller) callerSignal?.removeEventListener('abort', abortFromCaller);
  }
};

export interface AccountServiceCatalogCacheOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  maxAgeMs?: number;
}

/**
 * One bounded catalog cache shared by every binding. It avoids a full directory
 * lookup on each ordinary chat turn while still refreshing before a renewed
 * service credential would outlive the revision it was issued for.
 */
export class AccountServiceCatalogCache {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly maxAgeMs: number;
  private cached: CachedCatalog | null = null;
  private generation = 0;
  private inFlight: { key: string; promise: Promise<readonly AccountServiceEntry[]> } | null = null;

  constructor(options: AccountServiceCatalogCacheOptions = {}) {
    this.baseUrl = normalizeCloudAuthBaseUrl(
      options.baseUrl ?? resolveCloudAuthBaseUrl(),
    );
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => Date.now());
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.maxAgeMs = options.maxAgeMs ?? SERVICE_REGISTRY_CATALOG_MAX_AGE_MS;
  }

  /** Cached entries only when they still belong to the same account/session. */
  peek(input: { accountId: string; sessionToken: string }): readonly AccountServiceEntry[] | null {
    const cached = this.cached;
    if (!cached ||
        cached.accountId !== input.accountId ||
        cached.sessionToken !== input.sessionToken ||
        cached.expiresAt <= this.now()) {
      return null;
    }
    return cached.entries;
  }

  invalidate(): void {
    this.cached = null;
    this.inFlight = null;
    this.generation += 1;
  }

  async load(input: CatalogRequestOptions): Promise<readonly AccountServiceEntry[]> {
    if (!nonEmpty(input.accountId, 200) || !nonEmpty(input.sessionToken, 8_192)) {
      throw new McpProtocolError(
        'unauthorized',
        'A device-bound Mira ID session is required for the service catalog',
        'SERVICE_REGISTRY_SESSION_REQUIRED',
      );
    }
    const now = this.now();
    const cached = this.cached;
    if (!input.force && cached &&
        cached.accountId === input.accountId &&
        cached.sessionToken === input.sessionToken &&
        cached.expiresAt > now) {
      return cached.entries;
    }
    const key = `${input.accountId}\u0000${input.sessionToken}`;
    if (!input.force && this.inFlight && this.inFlight.key === key) {
      return this.inFlight.promise;
    }
    const generation = ++this.generation;
    const promise = this.request(input, now, generation).finally(() => {
      if (this.inFlight?.promise === promise) this.inFlight = null;
    });
    this.inFlight = { key, promise };
    return promise;
  }

  private async request(
    input: CatalogRequestOptions,
    now: number,
    generation: number,
  ): Promise<readonly AccountServiceEntry[]> {
    const fetchImpl = this.fetchImpl;
    if (typeof fetchImpl !== 'function') {
      throw new McpProtocolError(
        'network',
        'Service registry networking is unavailable',
        'SERVICE_REGISTRY_FETCH_UNAVAILABLE',
      );
    }
    const endpoint = cloudAuthServicesUrl(this.baseUrl);
    const entries = await withDeadline(async (signal) => {
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${input.sessionToken}`,
          },
          redirect: 'error',
          signal,
        });
        assertResponseTarget(response, endpoint);
      } catch (error) {
        if (error instanceof McpProtocolError) throw error;
        throw new McpProtocolError(
          'network',
          'Unable to reach Mira ID service registry',
          'SERVICE_REGISTRY_UNREACHABLE',
        );
      }
      if (!response.ok) {
        throw requestFailure(response.status, await readErrorCode(response));
      }
      let body: unknown;
      try {
        body = await response.json() as unknown;
      } catch {
        throw invalidCatalog('SERVICE_CATALOG_UNPARSEABLE');
      }
      return parseAccountServiceCatalog(body);
    }, this.timeoutMs, input.signal);
    if (generation !== this.generation) {
      throw new McpProtocolError('unauthorized', 'The Mira ID service catalog request was superseded', 'SERVICE_CATALOG_SUPERSEDED');
    }
    this.cached = {
      accountId: input.accountId,
      sessionToken: input.sessionToken,
      entries,
      fetchedAt: now,
      expiresAt: now + this.maxAgeMs,
    };
    return entries;
  }
}

export interface RequestAccountServiceCredentialOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export const requestAccountServiceCredential = async (
  sessionToken: string,
  input: {
    accountId: string;
    appId: string;
    serviceId: string;
    resource: string;
    expectedRevision: number;
  },
  options: RequestAccountServiceCredentialOptions = {},
): Promise<IssuedAccountServiceCredential> => {
  if (!nonEmpty(sessionToken, 8_192) || !nonEmpty(input.accountId, 200)) {
    throw new McpProtocolError(
      'unauthorized',
      'A device-bound Mira ID session is required for service credentials',
      'SERVICE_REGISTRY_SESSION_REQUIRED',
    );
  }
  const baseUrl = normalizeCloudAuthBaseUrl(
    options.baseUrl ?? resolveCloudAuthBaseUrl(),
  );
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = (options.now ?? (() => Date.now()))();
  if (typeof fetchImpl !== 'function') {
    throw new McpProtocolError(
      'network',
      'Service registry networking is unavailable',
      'SERVICE_REGISTRY_FETCH_UNAVAILABLE',
    );
  }
  const endpoint = cloudAuthServiceCredentialUrl(baseUrl, input.appId, input.serviceId);
  const body = await withDeadline(async (signal) => {
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ resource: input.resource, expectedRevision: input.expectedRevision }),
        redirect: 'error',
        signal,
      });
      assertResponseTarget(response, endpoint);
    } catch (error) {
      if (error instanceof McpProtocolError) throw error;
      throw new McpProtocolError(
        'network',
        'Unable to reach Mira ID service registry',
        'SERVICE_REGISTRY_UNREACHABLE',
      );
    }
    if (!response.ok) {
      throw requestFailure(response.status, await readErrorCode(response));
    }
    try {
      return await response.json() as unknown;
    } catch {
      throw invalidCredential('SERVICE_CREDENTIAL_UNPARSEABLE');
    }
  }, options.timeoutMs ?? 12_000, options.signal);
  return parseIssuedAccountServiceCredential(body, {
    accountId: input.accountId,
    appId: input.appId,
    serviceId: input.serviceId,
    resource: input.resource,
    revision: input.expectedRevision,
    nowMs: now,
  });
};

const isCompatibleCatalogEntry = (entry: AccountServiceEntry): boolean =>
  entry.definition.protocol.name === SERVICE_REGISTRY_PROTOCOL_NAME &&
  entry.definition.protocol.version === MCP_PROTOCOL_VERSION &&
  (entry.definition.targets === undefined || entry.definition.targets.includes('mobile'));

const capabilityResourceUri = (serviceId: string): string =>
  `mira://service/${serviceId}/capabilities`;

const parseMcpArguments = (value: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || '{}') as unknown;
  } catch {
    throw new McpProtocolError(
      'rejected',
      'Service tool arguments are not valid JSON',
      'SERVICE_TOOL_ARGUMENTS_INVALID',
    );
  }
  if (!isRecord(parsed)) {
    throw new McpProtocolError(
      'rejected',
      'Service tool arguments must be a JSON object',
      'SERVICE_TOOL_ARGUMENTS_INVALID',
    );
  }
  return parsed;
};

const toolResultContent = (result: unknown): string => {
  if (!isRecord(result)) {
    throw new McpProtocolError(
      'invalid_response',
      'The service returned an invalid tool result',
      'SERVICE_TOOL_RESULT_INVALID',
    );
  }
  if (result.isError === true) {
    throw new McpProtocolError(
      'rejected',
      'The service rejected the tool call',
      'SERVICE_TOOL_REJECTED',
    );
  }
  let text = '';
  if (Array.isArray(result.content)) {
    text = result.content.flatMap((block) => {
      if (!isRecord(block) || block.type !== 'text' ||
          typeof block.text !== 'string') {
        return [];
      }
      return [block.text];
    }).join('');
  }
  if (!text && isRecord(result.structuredContent)) {
    text = JSON.stringify(result.structuredContent);
  }
  return text.slice(0, MAX_TEXT_RESULT_BYTES);
};

const readCapabilityResource = async (
  client: McpProtocolClient,
  serviceId: string,
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
  const uri = capabilityResourceUri(serviceId);
  const descriptor = resources.find((entry) => entry.uri === uri);
  if (!descriptor) return undefined;
  let contents: McpResourceContent[];
  try {
    contents = await client.readResource(uri, signal);
  } catch (error) {
    if (error instanceof McpProtocolError &&
        (error.kind === 'rejected' || error.kind === 'unsupported')) {
      return undefined;
    }
    throw error;
  }
  const content = contents.find((entry) => entry.uri === uri);
  if (!content) return undefined;
  const mime = (content.mimeType ?? descriptor.mimeType ?? '').toLowerCase();
  if (mime !== 'application/json') return undefined;
  try {
    return JSON.parse(content.text) as unknown;
  } catch {
    return undefined;
  }
};

export interface AccountServiceDiscoveryDeps {
  loadSession(): Promise<StoredCloudSession | null>;
  currentCloud(): { status: string; accountId: string | null; deviceId?: string | null };
  catalog: AccountServiceCatalogCache;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  credentialRequester?: typeof requestAccountServiceCredential;
}

const currentSession = async (
  deps: AccountServiceDiscoveryDeps,
  accountId: string,
): Promise<ValidatedSession> => {
  const cloud = deps.currentCloud();
  if (cloud.status !== 'signed_in' || cloud.accountId !== accountId) {
    throw new McpProtocolError(
      'unauthorized',
      'The Mira ID account changed during service discovery',
      'SERVICE_REGISTRY_ACCOUNT_CHANGED',
    );
  }
  let stored: StoredCloudSession | null;
  try {
    stored = await deps.loadSession();
  } catch {
    throw new McpProtocolError(
      'unavailable',
      'The Mira ID session is unavailable',
      'SERVICE_REGISTRY_SESSION_UNAVAILABLE',
    );
  }
  if (!stored || stored.account.id !== accountId ||
      !nonEmpty(stored.sessionToken, 8_192) ||
      !(Date.parse(stored.expiresAt) > (deps.now ?? Date.now)())) {
    throw new McpProtocolError(
      'unauthorized',
      'Mira ID session expired or changed',
      'SERVICE_REGISTRY_SESSION_EXPIRED',
    );
  }
  return {
    sessionToken: stored.sessionToken,
    accountId,
    expiresAt: stored.expiresAt,
  };
};

const loadCatalogForSession = (
  deps: AccountServiceDiscoveryDeps,
  session: ValidatedSession,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<readonly AccountServiceEntry[]> =>
  deps.catalog.load({
    accountId: session.accountId,
    sessionToken: session.sessionToken,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.force ? { force: true } : {}),
  });

const findEntry = (
  entries: readonly AccountServiceEntry[],
  serviceId: string,
): AccountServiceEntry | undefined =>
  entries.find((entry) => accountServiceIdentity(entry.definition) === serviceId);

/**
 * One generic, catalog-driven MCP discovery. It never invents a business tool
 * list: `tools/list` is the schema authority and registration never implies a
 * tool approval.
 */
const connectAccountMcpService = async (
  input: {
    accountId: string;
    serviceId: string;
    signal?: AbortSignal;
    expectedSessionToken?: string;
    forceCatalog?: boolean;
  },
  deps: AccountServiceDiscoveryDeps,
) => {
  const session = await currentSession(deps, input.accountId);
  if (input.expectedSessionToken !== undefined && input.expectedSessionToken !== session.sessionToken) {
    throw new McpProtocolError('unauthorized', 'The Mira ID session changed', 'SERVICE_REGISTRY_SESSION_CHANGED');
  }
  let entries = await loadCatalogForSession(deps, session, {
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.forceCatalog ? { force: true } : {}),
  });
  let entry = findEntry(entries, input.serviceId);
  if (!entry) {
    throw new McpProtocolError(
      'unauthorized',
      'The Mira ID account no longer registers this service',
      'SERVICE_REGISTRATION_NOT_FOUND',
    );
  }
  if (!isCompatibleCatalogEntry(entry)) {
    throw new McpProtocolError(
      'unsupported',
      'The registered service protocol is not supported by this client',
      'SERVICE_PROTOCOL_UNSUPPORTED',
    );
  }

  const requestCredential = async (target: AccountServiceEntry) =>
    (deps.credentialRequester ?? requestAccountServiceCredential)(
      session.sessionToken,
      {
        accountId: input.accountId,
        appId: target.definition.appId,
        serviceId: target.definition.serviceId,
        resource: target.definition.resource,
        expectedRevision: target.revision,
      },
      {
        ...(deps.baseUrl ? { baseUrl: deps.baseUrl } : {}),
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        ...(deps.now ? { now: deps.now } : {}),
        ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );

  let credential: IssuedAccountServiceCredential;
  try {
    credential = await requestCredential(entry);
  } catch (error) {
    // A stale revision is repaired from fresh authoritative metadata once.
    if (error instanceof McpProtocolError &&
        error.code === 'APPLICATION_SERVICE_CHANGED') {
      entries = await loadCatalogForSession(deps, session, {
        signal: input.signal,
        force: true,
      });
      const refreshed = findEntry(entries, input.serviceId);
      if (!refreshed) {
        throw new McpProtocolError(
          'unauthorized',
          'The Mira ID account no longer registers this service',
          'SERVICE_REGISTRATION_NOT_FOUND',
        );
      }
      if (!isCompatibleCatalogEntry(refreshed)) {
        throw new McpProtocolError('unsupported', 'The registered service protocol is not supported by this client', 'SERVICE_PROTOCOL_UNSUPPORTED');
      }
      entry = refreshed;
      credential = await requestCredential(entry);
    } else {
      if (error instanceof McpProtocolError &&
          error.status === 404) {
        // A denied renewal is authoritative revocation evidence. Drop the stale
        // catalog immediately; other bindings must revalidate before use.
        deps.catalog.invalidate();
      }
      throw error;
    }
  }

  const knownDeviceId = deps.currentCloud().deviceId;
  if (credential.claims.accountId !== input.accountId ||
      (knownDeviceId && credential.claims.deviceId !== knownDeviceId) ||
      credential.appId !== entry.definition.appId || credential.serviceId !== entry.definition.serviceId ||
      credential.revision !== entry.revision || credential.resource !== entry.definition.resource) {
    throw invalidCredential('SERVICE_CREDENTIAL_IDENTITY_MISMATCH');
  }
  if (credential.claims.scopes.length !== entry.definition.scopes.length ||
      !entry.definition.scopes.every(scope => credential.claims.scopes.includes(scope)) ||
      !validServiceScopes(credential.claims.scopes)) {
    throw invalidCredential('SERVICE_CREDENTIAL_SCOPE_MISMATCH');
  }
  const latestSession = await currentSession(deps, input.accountId);
  if (latestSession.sessionToken !== session.sessionToken) {
    throw new McpProtocolError('unauthorized', 'The Mira ID session changed during discovery', 'SERVICE_REGISTRY_SESSION_CHANGED');
  }

  const isWhoYou = entry.definition.projectId === 'who-you';
  // Preserve the existing Who You resource/issuer check before sending any
  // bearer. Its endpoint comes only from the authorized registry declaration.
  if (isWhoYou) {
    await discoverWhoYouResource({
      mcpUrl: entry.definition.resource,
      cloudAuthBaseUrl: deps.baseUrl ?? resolveCloudAuthBaseUrl(),
      fetchImpl: deps.fetchImpl,
      timeoutMs: deps.timeoutMs,
      signal: input.signal,
    });
  }
  const client = new McpProtocolClient({
    endpoint: entry.definition.protocol.endpoint,
    token: credential.token,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
  });
  const expiresAt = Date.parse(credential.expiresAt);
  const revision = entry.revision;
  const accountId = input.accountId;
  const sessionToken = session.sessionToken;
  const now = deps.now ?? (() => Date.now());
  const assertCurrent = async () => {
    const cloud = deps.currentCloud();
    if (cloud.status !== 'signed_in' || cloud.accountId !== accountId ||
        (cloud.deviceId && cloud.deviceId !== credential.claims.deviceId)) {
      throw new McpProtocolError('unauthorized', 'The Mira ID account or device changed during the MCP service run', 'SERVICE_REGISTRY_ACCOUNT_CHANGED');
    }
    if (!(now() < expiresAt)) {
      throw new McpProtocolError('unauthorized', 'The service credential expired', 'SERVICE_CREDENTIAL_EXPIRED');
    }
    const stored = await currentSession(deps, accountId);
    if (stored.sessionToken !== sessionToken) {
      throw new McpProtocolError('unauthorized', 'The Mira ID session changed during the MCP service run', 'SERVICE_REGISTRY_SESSION_CHANGED');
    }
    // Reuse the shared catalog within its bounded window. If it expired or a
    // renewal observed revocation, revalidate even inside an existing run.
    const observed = deps.catalog.peek({ accountId, sessionToken }) ??
      await loadCatalogForSession(deps, stored);
    const current = findEntry(observed, accountServiceIdentity(entry.definition));
    const latest = await currentSession(deps, accountId);
    if (latest.sessionToken !== sessionToken || !(now() < expiresAt) ||
        !current || current.revision !== revision ||
        current.definition.protocol.version !== entry.definition.protocol.version ||
        current.definition.protocol.endpoint !== entry.definition.protocol.endpoint ||
        current.manifestRevision !== entry.manifestRevision ||
        current.definition.resource !== entry.definition.resource ||
        current.definition.scopes.length !== entry.definition.scopes.length ||
        !current.definition.scopes.every(scope => entry.definition.scopes.includes(scope))) {
      throw new McpProtocolError('unauthorized', 'The service registration or session changed', 'SERVICE_REGISTRATION_CHANGED');
    }
  };
  await assertCurrent();
  const serverInfo = await client.discover(input.signal);
  const toolDescriptors = await client.listTools(input.signal);
  const identity = isWhoYou && toolDescriptors.some(tool => tool.name === 'whoyou_whoami')
    ? parseIdentity(parseToolStructuredContent(await client.callTool('whoyou_whoami', {}, input.signal)), accountId)
    : undefined;
  await assertCurrent();
  if (isWhoYou && !identity) throw invalidCredential('SERVICE_MAIL_IDENTITY_REQUIRED');
  return { client, entry, credential, serverInfo, toolDescriptors, identity, isWhoYou, expiresAt, revision, accountId, assertCurrent };
};

export const discoverAccountMcpService = async (
  input: { accountId: string; serviceId: string; signal?: AbortSignal },
  deps: AccountServiceDiscoveryDeps,
): Promise<McpServiceSnapshot> => {
  const { client, entry, credential, serverInfo, toolDescriptors, isWhoYou, expiresAt, revision, accountId, assertCurrent } =
    await connectAccountMcpService(input, deps);
  const capabilityResource = serverInfo.resources
    ? await readCapabilityResource(client, entry.definition.serviceId, input.signal)
    : undefined;
  const hasMailReaders = toolDescriptors.some(tool => requiredMailRole(tool.name) !== null);
  const mailPolicy = isWhoYou || hasMailReaders;
  const permittedToolNames = mailPolicy ? toolDescriptors.filter(tool => requiredMailRole(tool.name) !== null).map(tool => tool.name) : toolDescriptors.map(tool => tool.name);
  const projection = projectMcpService({
    serviceId: entry.definition.serviceId,
    serviceName: entry.definition.displayName,
    serviceDescription: isWhoYou
      ? 'Mira ID 已授权的狐邮只读邮件服务；逐页和正文发送给模型前须单独同意。'
      : 'Mira ID 账号已授权的标准 MCP 服务；工具与 Schema 由服务自身声明。',
    toolDescriptors,
    capabilityResource,
    grantedScopes: credential.claims.scopes,
    requiredScopes: entry.definition.scopes,
    permittedAccess: mailPolicy ? ['read'] : ['read', 'write', 'send', 'destructive'],
    permittedToolNames,
    ...(mailPolicy ? { sensitiveResultFor: (name: string) => requiredMailRole(name) ?? undefined } : {}),
    serverInfo,
  });
  const executionGateway: ToolGatewayClient = mailPolicy
    ? createWhoYouMcpReadExecutor(client, projection.tools)
    : {
      listTools: async (): Promise<readonly ToolManifest[]> => [],
      callTool: async (request, options) => {
        await assertCurrent();
        const result = await client.callTool(
          request.name,
          parseMcpArguments(request.arguments),
          options?.signal,
        );
        await assertCurrent();
        return { content: toolResultContent(result) };
      },
    };
  await assertCurrent();
  const names = new Set(projection.tools.map(tool => tool.name));
  const declaredGroups = entry.definition.capabilities?.flatMap(cap => {
    const toolNames = [...new Set(cap.toolRefs.filter(name => names.has(name)))];
    return toolNames.length ? [{ id: cap.id, name: cap.title, description: cap.description ?? '', toolNames }] : [];
  });
  return {
    ...projection,
    service: { ...projection.service, id: accountServiceIdentity(entry.definition),
      ...(declaredGroups?.length ? { capabilities: declaredGroups } : {}) },
    catalogRevision: JSON.stringify([accountServiceIdentity(entry.definition), revision, entry.manifestRevision, projection.catalogRevision]),
    initialToolNames: mailPolicy && projection.tools.some(tool => tool.name === 'whoyou_mail_search') ? ['whoyou_mail_search'] : [],
    expiresAt,
    bindingKey: JSON.stringify([accountId, credential.claims.deviceId, accountServiceIdentity(entry.definition), revision, entry.manifestRevision, entry.definition.protocol.endpoint]),
    executionGateway,
    assertCurrent,
  };
};

export const createAccountMcpServiceDiscovery = (
  deps: AccountServiceDiscoveryDeps,
  serviceId: string,
): McpServiceDiscovery => ({
  serviceTypeId: serviceId,
  discover: ({ accountId, signal }) => {
    if (!accountId) {
      throw new McpProtocolError(
        'unauthorized',
        'A Mira ID account is required for this service',
        'SERVICE_REGISTRY_SESSION_REQUIRED',
      );
    }
    return discoverAccountMcpService(
      { accountId, serviceId, ...(signal ? { signal } : {}) },
      deps,
    );
  },
});

export interface AccountMcpServiceDirectoryOptions {
  loadSession?: () => Promise<StoredCloudSession | null>;
  currentCloud?: () => { status: string; accountId: string | null; deviceId?: string | null };
  catalog?: AccountServiceCatalogCache;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  credentialRequester?: typeof requestAccountServiceCredential;
}

/**
 * Maps the account's registered service directory to generic MCP bindings.
 * Desktop remains owned by the independent Host Grant / Direct adapter.
 * Who You is registry-discovered and retains the exact existing mail disclosure policy.
 */
export class AccountMcpServiceDirectory implements McpServiceDirectory {
  private readonly deps: AccountServiceDiscoveryDeps;
  private readonly bindingsByRevision = new Map<string, McpServiceBinding>();
  private bindingSession: { accountId: string; sessionToken: string } | null = null;

  constructor(options: AccountMcpServiceDirectoryOptions = {}) {
    this.deps = {
      loadSession: options.loadSession ?? (() => cloudSessionStore.load()),
      currentCloud: options.currentCloud ?? (() => {
        const cloud = useCloudAccountStore.getState();
        return { status: cloud.status, accountId: cloud.account?.id ?? null, deviceId: cloud.currentDeviceId };
      }),
      catalog: options.catalog ?? new AccountServiceCatalogCache({
        ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.now ? { now: options.now } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      }),
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.credentialRequester
        ? { credentialRequester: options.credentialRequester }
        : {}),
    };
  }

  async loadWhoYouSnapshot(input: WhoYouReadSession): Promise<WhoYouSnapshot> {
    try {
      const session = await currentSession(this.deps, input.accountId);
      if (session.sessionToken !== input.sessionToken) throw new WhoYouError('session_rejected', 'Mira ID 会话已变化。');
      const entries = await loadCatalogForSession(this.deps, session, { force: true, signal: input.signal });
      const mail = entries.filter(entry => entry.definition.projectId === 'who-you' && isCompatibleCatalogEntry(entry));
      if (mail.length !== 1) throw new WhoYouError('unauthorized', mail.length ? '存在多个狐邮实例，请在 Mira ID 中确认授权。' : '尚无狐邮授权。', 'SERVICE_REGISTRATION_NOT_FOUND');
      const connection = await connectAccountMcpService({
        accountId: input.accountId, serviceId: accountServiceIdentity(mail[0].definition),
        expectedSessionToken: input.sessionToken, signal: input.signal,
      }, this.deps);
      if (!connection.identity) {
        throw new WhoYouError('invalid_response', '狐邮未确认当前 Mira ID 身份。');
      }
      await connection.assertCurrent();
      if (!connection.toolDescriptors.some(tool => tool.name === 'whoyou_mailbox_list')) throw new WhoYouError('invalid_response', '狐邮未声明邮箱列表工具。');
      const mailboxes = parseMailboxes(parseToolStructuredContent(
        await connection.client.callTool('whoyou_mailbox_list', {}, input.signal),
      ));
      await connection.assertCurrent();
      return { identity: connection.identity, mailboxes };
    } catch (error) {
      if (error instanceof WhoYouError) throw error;
      if (error instanceof McpProtocolError) {
        if (error.code === 'SERVICE_REGISTRATION_NOT_FOUND' || error.code === 'SERVICE_REGISTRATION_CHANGED') {
          throw new WhoYouError('unauthorized', '当前 Mira ID 未注册狐邮服务或授权已撤销。', error.code);
        }
        if (error.kind === 'unauthorized') {
          throw new WhoYouError('session_rejected', 'Mira ID 会话或服务凭据已失效。', error.code);
        }
        if (error.kind === 'invalid_response') {
          throw new WhoYouError('invalid_response', '狐邮返回无效服务数据。', error.code);
        }
      }
      throw new WhoYouError('unavailable', '狐邮暂时不可用，请稍后重试。');
    }
  }

  async bindings(input: {
    accountId: string;
    signal?: AbortSignal;
  }): Promise<readonly McpServiceBinding[]> {
    const session = await currentSession(this.deps, input.accountId);
    const entries = await loadCatalogForSession(this.deps, session, {
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const latest = await currentSession(this.deps, input.accountId);
    if (latest.sessionToken !== session.sessionToken) {
      throw new McpProtocolError('unauthorized', 'The Mira ID session changed during discovery', 'SERVICE_REGISTRY_SESSION_CHANGED');
    }
    if (this.bindingSession?.accountId !== input.accountId || this.bindingSession.sessionToken !== session.sessionToken) {
      this.bindingsByRevision.clear();
      this.bindingSession = { accountId: input.accountId, sessionToken: session.sessionToken };
    }
    const compatible = entries.filter(isCompatibleCatalogEntry);
    if (this.bindingsByRevision.size > 64) this.bindingsByRevision.clear();
    return compatible.map((entry) => {
      const serviceId = accountServiceIdentity(entry.definition);
      const key = JSON.stringify([input.accountId, serviceId, entry.revision, entry.manifestRevision, entry.definition.protocol.endpoint]);
      const cached = this.bindingsByRevision.get(key);
      if (cached) return cached;
      const binding = new McpServiceBinding({
        serviceTypeId: serviceId,
        discovery: createAccountMcpServiceDiscovery(this.deps, serviceId),
        requiresCloudAccount: true,
        // Renewal happens after the catalog cache can no longer satisfy it, so
        // a valid revision is always rechecked before a fresh service bearer.
        maxAgeMs: SERVICE_REGISTRY_CATALOG_MAX_AGE_MS + 60_000,
        ...(this.deps.now ? { now: this.deps.now } : {}),
      });
      this.bindingsByRevision.set(key, binding);
      return binding;
    });
  }
}

export const accountServiceCatalogCache = new AccountServiceCatalogCache();
export const accountMcpServiceDirectory = new AccountMcpServiceDirectory({
  catalog: accountServiceCatalogCache,
});
