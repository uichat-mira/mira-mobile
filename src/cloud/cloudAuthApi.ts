import { releaseChannel } from 'mira-release-channel';
import { NativeModules, Platform } from 'react-native';
import {
  CLOUD_AUTH_CLIENT_ID,
  CLOUD_AUTH_PLATFORM,
  CLOUD_AUTH_REDIRECT_URI,
  cloudAuthDeviceUrl,
  cloudAuthDevicesUrl,
  cloudAuthHostsUrl,
  cloudAuthLogoutUrl,
  cloudAuthServiceCredentialsUrl,
  cloudAuthSessionUrl,
  cloudAuthSessionRenewUrl,
  cloudAuthTokenUrl,
  normalizeCloudAuthBaseUrl,
  resolveCloudAuthBaseUrl,
} from './cloudAuthConfig';

export interface CloudAccountIdentity {
  id: string;
  username: string;
}

export interface CloudSessionSummary {
  account: CloudAccountIdentity;
  expiresAt: string;
}

export interface IssuedCloudSession extends CloudSessionSummary {
  sessionToken: string;
}

export type MiraDevicePlatform = 'desktop' | 'mobile';

export interface MiraDevice {
  id: string;
  platform: MiraDevicePlatform;
  clientName: string | null;
  clientVersion: string | null;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export type CloudDesktopHostAvailability = 'available' | 'offline';

/**
 * Server-owned Cloud Host directory entry (OPS-018). `relayRoom` is derived by
 * Cloud Auth and can never be supplied or overridden by Mobile.
 */
export interface CloudDesktopHost {
  id: string;
  deviceId: string;
  displayName: string | null;
  clientVersion: string | null;
  availability: CloudDesktopHostAvailability;
  relayRoom: string;
  registeredAt: string;
  lastAdvertisedAt: string;
  leaseExpiresAt: string;
}

export const CLOUD_SERVICE_CREDENTIAL_ISSUER = 'mira:cloud-auth';
export const CLOUD_RELAY_TRANSPORT_AUDIENCE = 'mira:cloud-relay-transport';
export const CLOUD_RELAY_TRANSPORT_SCOPE = 'relay:transport';

export interface CloudRelayTicketClaims {
  accountId: string;
  deviceId: string;
  room: string;
  role: 'client';
  expiresAt: string;
}

export interface IssuedRelayTransportTicket {
  token: string;
  tokenType: 'Bearer';
  audience: typeof CLOUD_RELAY_TRANSPORT_AUDIENCE;
  expiresAt: string;
  claims: CloudRelayTicketClaims;
}

export interface CloudRelayApiLike {
  listHosts(sessionToken: string): Promise<CloudDesktopHost[]>;
  issueRelayClientTicket(
    sessionToken: string,
    room: string,
  ): Promise<IssuedRelayTransportTicket>;
}

export interface OAuthCodeExchangeRequest {
  code: string;
  codeVerifier: string;
  installationId: string;
}

export type CloudAuthFailureKind =
  | 'network'
  | 'unavailable'
  | 'rejected'
  | 'not_found'
  | 'invalid_response';

export class CloudAuthRequestError extends Error {
  constructor(
    readonly kind: CloudAuthFailureKind,
    message: string,
    readonly code?: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'CloudAuthRequestError';
  }
}

export interface CloudAuthApiLike {
  exchangeAuthorizationCode(
    request: OAuthCodeExchangeRequest,
  ): Promise<IssuedCloudSession>;
  getSession(sessionToken: string): Promise<CloudSessionSummary>;
  renewSession(sessionToken: string): Promise<IssuedCloudSession>;
  logout(sessionToken: string): Promise<void>;
  listDevices(sessionToken: string): Promise<MiraDevice[]>;
  revokeDevice(sessionToken: string, deviceId: string): Promise<MiraDevice>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parseAccount = (value: unknown): CloudAccountIdentity => {
  if (!isRecord(value)) {
    throw new CloudAuthRequestError(
      'invalid_response',
      'Mira Cloud returned an incomplete account response',
    );
  }
  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.username !== 'string' ||
    value.username.length === 0
  ) {
    throw new CloudAuthRequestError(
      'invalid_response',
      'Mira Cloud returned an incomplete account response',
    );
  }
  return { id: value.id, username: value.username };
};

const parseExpiresAt = (value: unknown): string => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new CloudAuthRequestError(
      'invalid_response',
      'Mira Cloud returned an invalid session expiry',
    );
  }
  return new Date(value).toISOString();
};

export const parseIssuedCloudSession = (value: unknown): IssuedCloudSession => {
  if (!isRecord(value)) {
    throw new CloudAuthRequestError(
      'invalid_response',
      'Mira Cloud returned an invalid session response',
    );
  }
  if (
    typeof value.sessionToken !== 'string' ||
    value.sessionToken.length === 0
  ) {
    throw new CloudAuthRequestError(
      'invalid_response',
      'Mira Cloud returned an incomplete session response',
    );
  }
  return {
    sessionToken: value.sessionToken,
    account: parseAccount(value.account),
    expiresAt: parseExpiresAt(value.expiresAt),
  };
};

export const parseCloudSessionSummary = (
  value: unknown,
): CloudSessionSummary => {
  if (!isRecord(value)) {
    throw new CloudAuthRequestError(
      'invalid_response',
      'Mira Cloud returned an invalid session response',
    );
  }
  return {
    account: parseAccount(value.account),
    expiresAt: parseExpiresAt(value.expiresAt),
  };
};

const parseDeviceTimestamp = (value: unknown): string => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new CloudAuthRequestError(
      'invalid_response',
      'Mira Cloud returned an invalid device response',
    );
  }
  return new Date(value).toISOString();
};

const parseOptionalDeviceLabel = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CloudAuthRequestError(
      'invalid_response',
      'Mira Cloud returned an invalid device response',
    );
  }
  return value;
};

export const parseMiraDevice = (value: unknown): MiraDevice => {
  if (!isRecord(value)) {
    throw new CloudAuthRequestError(
      'invalid_response',
      'Mira Cloud returned an invalid device response',
    );
  }
  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    (value.platform !== 'desktop' && value.platform !== 'mobile') ||
    value.revokedAt === undefined
  ) {
    throw new CloudAuthRequestError(
      'invalid_response',
      'Mira Cloud returned an invalid device response',
    );
  }
  return {
    id: value.id,
    platform: value.platform,
    clientName: parseOptionalDeviceLabel(value.clientName),
    clientVersion: parseOptionalDeviceLabel(value.clientVersion),
    createdAt: parseDeviceTimestamp(value.createdAt),
    lastSeenAt: parseDeviceTimestamp(value.lastSeenAt),
    revokedAt:
      value.revokedAt === null
        ? null
        : parseDeviceTimestamp(value.revokedAt),
  };
};

export const parseMiraDeviceList = (value: unknown): MiraDevice[] => {
  if (!isRecord(value) || !Array.isArray(value.devices)) {
    throw new CloudAuthRequestError(
      'invalid_response',
      'Mira Cloud returned an invalid device list',
    );
  }
  return value.devices.map(parseMiraDevice);
};

export const parseRevokedMiraDevice = (
  value: unknown,
  expectedDeviceId: string,
): MiraDevice => {
  const device = parseMiraDevice(value);
  if (device.id !== expectedDeviceId || device.revokedAt === null) {
    throw new CloudAuthRequestError(
      'invalid_response',
      'Mira Cloud did not confirm the device revocation',
    );
  }
  return device;
};

const CLOUD_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

const parseCloudTimestamp = (value: unknown, context: string): string => {
  if (
    typeof value !== 'string' ||
    !CLOUD_TIMESTAMP_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new CloudAuthRequestError(
      'invalid_response',
      `Mira Cloud returned an invalid ${context}`,
    );
  }
  return new Date(value).toISOString();
};

const parseOptionalCloudLabel = (
  value: unknown,
  context: string,
): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CloudAuthRequestError(
      'invalid_response',
      `Mira Cloud returned an invalid ${context}`,
    );
  }
  return value;
};

const CLOUD_RELAY_ROOM_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;

export const parseCloudDesktopHost = (value: unknown): CloudDesktopHost => {
  if (!isRecord(value)) {
    throw new CloudAuthRequestError(
      'invalid_response',
      'Mira Cloud returned an invalid Host entry',
    );
  }
  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.deviceId !== 'string' ||
    value.deviceId.length === 0 ||
    (value.availability !== 'available' && value.availability !== 'offline') ||
    typeof value.relayRoom !== 'string' ||
    !CLOUD_RELAY_ROOM_PATTERN.test(value.relayRoom) ||
    value.relayRoom === '.' || value.relayRoom === '..'
  ) {
    throw new CloudAuthRequestError(
      'invalid_response',
      'Mira Cloud returned an invalid Host entry',
    );
  }
  return {
    id: value.id,
    deviceId: value.deviceId,
    displayName: parseOptionalCloudLabel(value.displayName, 'Host name'),
    clientVersion: parseOptionalCloudLabel(
      value.clientVersion,
      'Host version',
    ),
    availability: value.availability,
    relayRoom: value.relayRoom,
    registeredAt: parseCloudTimestamp(value.registeredAt, 'Host registration'),
    lastAdvertisedAt: parseCloudTimestamp(
      value.lastAdvertisedAt,
      'Host presence',
    ),
    leaseExpiresAt: parseCloudTimestamp(value.leaseExpiresAt, 'Host lease'),
  };
};

export const parseCloudDesktopHostList = (
  value: unknown,
): CloudDesktopHost[] => {
  if (!isRecord(value) || !Array.isArray(value.hosts)) {
    throw new CloudAuthRequestError(
      'invalid_response',
      'Mira Cloud returned an invalid Host directory',
    );
  }
  return value.hosts.map(parseCloudDesktopHost);
};

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const invalidRelayTicket = (message: string): never => {
  throw new CloudAuthRequestError(
    'invalid_response',
    message,
    'CLOUD_RELAY_TICKET_INVALID',
  );
};

// JWT claim values used by the Relay contract are bounded ASCII identifiers.
// Decoding without Buffer/TextDecoder keeps this working on Hermes and rejects
// non-ASCII payloads instead of guessing an encoding.
const decodeBase64UrlAscii = (segment: string): string => {
  const normalized = segment.replace(/-/gu, '+').replace(/_/gu, '/');
  if (
    normalized.length === 0 ||
    !/^[A-Za-z0-9+\/]*={0,2}$/u.test(normalized) ||
    normalized.length % 4 === 1
  ) {
    return invalidRelayTicket('Mira Cloud returned a malformed Relay ticket');
  }
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '=',
  );
  let output = '';
  for (let index = 0; index < padded.length; index += 4) {
    const chars = padded.slice(index, index + 4);
    const values = [...chars].map(char =>
      char === '=' ? 0 : BASE64URL_ALPHABET.indexOf(char),
    );
    if (values.some(item => item < 0)) {
      return invalidRelayTicket(
        'Mira Cloud returned a malformed Relay ticket',
      );
    }
    const packed =
      (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3];
    const bytes = [
      (packed >> 16) & 0xff,
      (packed >> 8) & 0xff,
      packed & 0xff,
    ];
    const length = chars[2] === '=' ? 1 : chars[3] === '=' ? 2 : 3;
    for (let offset = 0; offset < length; offset += 1) {
      const byte = bytes[offset];
      if (byte > 0x7f) {
        return invalidRelayTicket(
          'Mira Cloud returned a malformed Relay ticket',
        );
      }
      output += String.fromCharCode(byte);
    }
  }
  return output;
};

const parseJsonSegment = (segment: string): Record<string, unknown> => {
  const text = decodeBase64UrlAscii(segment);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return invalidRelayTicket('Mira Cloud returned a malformed Relay ticket');
  }
  if (!isRecord(parsed)) {
    return invalidRelayTicket('Mira Cloud returned a malformed Relay ticket');
  }
  return parsed;
};

const isNumericDate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * Client-side structural check only. Relay remains the authority that verifies
 * the Ed25519 signature and binds the ticket to the actual socket.
 */
export const parseRelayTransportTicketClaims = (
  token: string,
  expectedRoom: string,
  nowMs: number = Date.now(),
): CloudRelayTicketClaims => {
  const segments = token.split('.');
  if (segments.length !== 3 || segments.some(segment => segment.length === 0)) {
    return invalidRelayTicket('Mira Cloud returned a malformed Relay ticket');
  }

  const header = parseJsonSegment(segments[0]);
  if (
    header.alg !== 'EdDSA' ||
    header.typ !== 'JWT' ||
    typeof header.kid !== 'string' ||
    !/^[A-Za-z0-9._-]{1,64}$/u.test(header.kid)
  ) {
    return invalidRelayTicket('Mira Cloud returned an invalid Relay ticket');
  }

  const claims = parseJsonSegment(segments[1]);
  const relay = claims.relay;
  if (
    claims.iss !== CLOUD_SERVICE_CREDENTIAL_ISSUER ||
    claims.aud !== CLOUD_RELAY_TRANSPORT_AUDIENCE ||
    !Array.isArray(claims.scope) ||
    claims.scope.length !== 1 ||
    claims.scope[0] !== CLOUD_RELAY_TRANSPORT_SCOPE ||
    typeof claims.sub !== 'string' ||
    claims.sub.length === 0 ||
    typeof claims.device_id !== 'string' ||
    claims.device_id.length === 0 ||
    !isRecord(relay) ||
    typeof relay.room !== 'string' ||
    relay.role !== 'client' ||
    !isNumericDate(claims.iat) ||
    !isNumericDate(claims.nbf) ||
    !isNumericDate(claims.exp)
  ) {
    return invalidRelayTicket('Mira Cloud returned an invalid Relay ticket');
  }
  if (relay.room !== expectedRoom) {
    return invalidRelayTicket(
      'Mira Cloud Relay ticket is bound to a different room',
    );
  }
  if (claims.nbf < claims.iat || claims.exp <= claims.nbf) {
    return invalidRelayTicket('Mira Cloud returned an invalid Relay ticket');
  }
  const nowSeconds = Math.floor(nowMs / 1000);
  if (claims.nbf > nowSeconds || claims.exp <= nowSeconds) {
    return invalidRelayTicket('Mira Cloud Relay ticket is expired');
  }

  return {
    accountId: claims.sub,
    deviceId: claims.device_id,
    room: relay.room,
    role: 'client',
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
};

export const parseIssuedRelayTransportTicket = (
  value: unknown,
  expectedRoom: string,
  nowMs: number = Date.now(),
): IssuedRelayTransportTicket => {
  if (
    !isRecord(value) ||
    typeof value.token !== 'string' ||
    value.token.length === 0 ||
    value.tokenType !== 'Bearer' ||
    value.audience !== CLOUD_RELAY_TRANSPORT_AUDIENCE
  ) {
    throw new CloudAuthRequestError(
      'invalid_response',
      'Mira Cloud returned an invalid Relay ticket response',
    );
  }
  const expiresAt = parseCloudTimestamp(value.expiresAt, 'Relay ticket expiry');
  const claims = parseRelayTransportTicketClaims(
    value.token,
    expectedRoom,
    nowMs,
  );
  return {
    token: value.token,
    tokenType: 'Bearer',
    audience: CLOUD_RELAY_TRANSPORT_AUDIENCE,
    expiresAt,
    claims,
  };
};

const readErrorCode = async (
  response: Response,
): Promise<string | undefined> => {
  try {
    const body = (await response.json()) as unknown;
    if (
      isRecord(body) &&
      isRecord(body.error) &&
      typeof body.error.code === 'string'
    ) {
      return body.error.code;
    }
  } catch {
    // A non-JSON error body is classified by status, never surfaced verbatim.
  }
  return undefined;
};

const failureForResponse = async (
  response: Response,
  rejectClientErrors: boolean,
  notFoundIsExpected = false,
): Promise<CloudAuthRequestError> => {
  const code = await readErrorCode(response);
  if (response.status === 401) {
    return new CloudAuthRequestError(
      'rejected',
      'Mira Cloud session was rejected',
      code,
    );
  }
  if (response.status === 429 || response.status >= 500) {
    return new CloudAuthRequestError(
      'unavailable',
      'Mira Cloud is temporarily unavailable',
      code,
    );
  }
  if (notFoundIsExpected && response.status === 404) {
    return new CloudAuthRequestError(
      'not_found',
      'Mira Cloud could not find the requested resource',
      code,
    );
  }
  if (response.status >= 400) {
    return new CloudAuthRequestError(
      rejectClientErrors ? 'rejected' : 'invalid_response',
      'Mira Cloud rejected the request',
      code,
    );
  }
  return new CloudAuthRequestError(
    'invalid_response',
    'Mira Cloud returned an unexpected response',
    code,
  );
};

const defaultFetch: typeof fetch = (input, init) => {
  if (typeof globalThis.fetch !== 'function') {
    return Promise.reject(new Error('fetch is unavailable'));
  }
  return globalThis.fetch(input, init);
};

const SAFE_ANDROID_REASONS = new Set([
  'CERTIFICATE_REJECTED', 'DNS_FAILURE', 'CONNECTION_RESET',
  'NETWORK_UNREACHABLE', 'CONNECTION_REFUSED', 'TIMEOUT',
  'TLS_HANDSHAKE', 'CONNECT_FAILED', 'EARLY_EOF', 'UNCLASSIFIED',
]);

// No native raw errors, URLs, OAuth code, verifier or credentials reach the UI.
const formatAndroidTransportDetail = (raw: unknown): string => {
  if (!isRecord(raw)) return 'Android OkHttp: PROBE_FAILED';
  if (raw.outcome === 'HTTP' && typeof raw.httpStatus === 'number' &&
      Number.isInteger(raw.httpStatus) && raw.httpStatus >= 100 && raw.httpStatus <= 599) {
    return 'Android OkHttp: HTTP ' + raw.httpStatus;
  }
  if (raw.outcome === 'NETWORK' && typeof raw.exceptionChain === 'string' &&
      /^(?:[A-Za-z][A-Za-z0-9]{0,48}(?:Exception|Error))(?:>[A-Za-z][A-Za-z0-9]{0,48}(?:Exception|Error)){0,2}$/.test(raw.exceptionChain) &&
      typeof raw.reason === 'string' && SAFE_ANDROID_REASONS.has(raw.reason)) {
    return 'Android OkHttp: NETWORK ' + raw.exceptionChain + ' (' + raw.reason + ')';
  }
  return 'Android OkHttp: PROBE_FAILED';
};

const diagnoseAndroidCloudAuthTls = async (): Promise<string> => {
  if (Platform.OS !== 'android') return 'Android OkHttp: UNAVAILABLE';
  const module = NativeModules.MiraNetworkMonitor as
    | { diagnoseCloudAuthTls?: () => Promise<unknown> }
    | undefined;
  if (typeof module?.diagnoseCloudAuthTls !== 'function') {
    return 'Android OkHttp: UNAVAILABLE';
  }
  try {
    return formatAndroidTransportDetail(await module.diagnoseCloudAuthTls());
  } catch {
    return 'Android OkHttp: PROBE_FAILED';
  }
};

const CLOUD_AUTH_REQUEST_TIMEOUT_MS = 15_000;
const OAUTH_DEV_PROBE_TIMEOUT_MS = 3_000;
const OAUTH_NATIVE_DIAGNOSTIC_TIMEOUT_MS = 5_000;

const withNativeDiagnosticDeadline = async (
  probe: () => Promise<string>,
): Promise<string> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<string>(resolve => {
    timer = setTimeout(
      () => resolve('Android OkHttp: PROBE_FAILED'),
      OAUTH_NATIVE_DIAGNOSTIC_TIMEOUT_MS,
    );
  });
  try {
    // A stalled RN native bridge must not leave the OAuth callback spinning.
    return await Promise.race([
      Promise.resolve().then(probe).catch(() => 'Android OkHttp: PROBE_FAILED'),
      deadline,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export class CloudAuthApi implements CloudAuthApiLike {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly nativeTransportDiagnostic: () => Promise<string>;

  constructor(
    baseUrl: string = resolveCloudAuthBaseUrl(),
    fetchImpl?: typeof fetch,
    nativeTransportDiagnostic: () => Promise<string> = diagnoseAndroidCloudAuthTls,
  ) {
    this.baseUrl = normalizeCloudAuthBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl ?? defaultFetch;
    this.nativeTransportDiagnostic = nativeTransportDiagnostic;
  }

  private async send<T>(
    url: string,
    init: RequestInit,
    read: (response: Response) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new CloudAuthRequestError('network', 'Mira Cloud request timed out', 'MIRA_REQUEST_TIMEOUT'),
        );
      }, CLOUD_AUTH_REQUEST_TIMEOUT_MS);
    });

    // The deadline stays active through response-body parsing, not only until
    // headers arrive. React Native connections can stall at either boundary.
    const request = (async () => {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          ...init,
          signal: controller.signal,
        });
      } catch {
        throw new CloudAuthRequestError('network', 'Mira Cloud is unreachable', 'MIRA_FETCH_FAILED');
      }
      return read(response);
    })();

    try {
      return await Promise.race([request, deadline]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  // A dev-only, credential-free probe after a failed token request.
  // It uses the same React Native fetch stack as the failed POST, so a phone
  // browser's successful /health check is not mistaken for native reachability.
  // Never retry the one-use authorization code or surface raw native errors.
  private async probeNativeHealth(): Promise<'ok' | 'http' | 'network' | 'timeout'> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const probe = this.fetchImpl(`${this.baseUrl}/health`, {
      method: 'GET',
      credentials: 'omit',
      signal: controller.signal,
    }).then(
      response => (response.ok ? 'ok' : 'http') as 'ok' | 'http',
      () => 'network' as const,
    );
    const deadline = new Promise<'timeout'>(resolve => {
      timer = setTimeout(() => {
        controller.abort();
        resolve('timeout');
      }, OAUTH_DEV_PROBE_TIMEOUT_MS);
    });
    try {
      return await Promise.race([probe, deadline]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async exchangeAuthorizationCode(
    request: OAuthCodeExchangeRequest,
  ): Promise<IssuedCloudSession> {
    return this.send(cloudAuthTokenUrl(this.baseUrl), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: CLOUD_AUTH_CLIENT_ID,
        code: request.code,
        redirect_uri: CLOUD_AUTH_REDIRECT_URI,
        code_verifier: request.codeVerifier,
        installation_id: request.installationId,
        platform: CLOUD_AUTH_PLATFORM,
      }),
    }, async response => {
      if (!response.ok) throw await failureForResponse(response, true);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new CloudAuthRequestError(
          'invalid_response',
          'Mira Cloud returned an invalid session response',
        );
      }
      return parseIssuedCloudSession(body);
    }).catch(async (error: unknown) => {
      if (
        releaseChannel !== 'dev' ||
        !(error instanceof CloudAuthRequestError) ||
        error.kind !== 'network'
      ) {
        throw error;
      }
      const probe = await this.probeNativeHealth();
      const detail = await withNativeDiagnosticDeadline(this.nativeTransportDiagnostic);
      const stage = error.code === 'MIRA_REQUEST_TIMEOUT' ? 'TIMEOUT' : 'FETCH';
      throw new CloudAuthRequestError(
        'network',
        'Mira Cloud token exchange transport failure',
        `MOB081_${stage}_HEALTH_${probe.toUpperCase()}`,
        detail,
      );
    });
  }

  async getSession(sessionToken: string): Promise<CloudSessionSummary> {
    return this.send(cloudAuthSessionUrl(this.baseUrl), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${sessionToken}`,
      },
    }, async response => {
      if (!response.ok) throw await failureForResponse(response, false);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new CloudAuthRequestError(
          'invalid_response',
          'Mira Cloud returned an invalid session response',
        );
      }
      return parseCloudSessionSummary(body);
    });
  }

  async renewSession(sessionToken: string): Promise<IssuedCloudSession> {
    return this.send(cloudAuthSessionRenewUrl(this.baseUrl), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${sessionToken}`,
      },
    }, async response => {
      if (!response.ok) throw await failureForResponse(response, false);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new CloudAuthRequestError(
          'invalid_response',
          'Mira Cloud returned an invalid renewed session',
        );
      }
      return parseIssuedCloudSession(body);
    });
  }

  async logout(sessionToken: string): Promise<void> {
    return this.send(cloudAuthLogoutUrl(this.baseUrl), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${sessionToken}`,
      },
    }, async response => {
      if (!response.ok) throw await failureForResponse(response, false);
    });
  }

  async listDevices(sessionToken: string): Promise<MiraDevice[]> {
    return this.send(cloudAuthDevicesUrl(this.baseUrl), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${sessionToken}`,
      },
    }, async response => {
      if (!response.ok) throw await failureForResponse(response, false);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new CloudAuthRequestError(
          'invalid_response',
          'Mira Cloud returned an invalid device list',
        );
      }
      return parseMiraDeviceList(body);
    });
  }

  async revokeDevice(
    sessionToken: string,
    deviceId: string,
  ): Promise<MiraDevice> {
    return this.send(cloudAuthDeviceUrl(this.baseUrl, deviceId), {
      method: 'DELETE',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${sessionToken}`,
      },
    }, async response => {
      if (!response.ok) {
        throw await failureForResponse(response, false, true);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new CloudAuthRequestError(
          'invalid_response',
          'Mira Cloud returned an invalid device revocation response',
        );
      }
      return parseRevokedMiraDevice(body, deviceId);
    });
  }

  async listHosts(sessionToken: string): Promise<CloudDesktopHost[]> {
    return this.send(cloudAuthHostsUrl(this.baseUrl), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${sessionToken}`,
      },
    }, async response => {
      if (!response.ok) throw await failureForResponse(response, true);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new CloudAuthRequestError(
          'invalid_response',
          'Mira Cloud returned an invalid Host directory',
        );
      }
      return parseCloudDesktopHostList(body);
    });
  }

  async issueRelayClientTicket(
    sessionToken: string,
    room: string,
  ): Promise<IssuedRelayTransportTicket> {
    return this.send(cloudAuthServiceCredentialsUrl(this.baseUrl), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        audience: CLOUD_RELAY_TRANSPORT_AUDIENCE,
        relay: { room, role: 'client' },
      }),
    }, async response => {
      if (!response.ok) throw await failureForResponse(response, true);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new CloudAuthRequestError(
          'invalid_response',
          'Mira Cloud returned an invalid Relay ticket response',
        );
      }
      return parseIssuedRelayTransportTicket(body, room);
    });
  }
}
