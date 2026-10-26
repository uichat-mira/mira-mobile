import { releaseChannel } from 'mira-release-channel';
import {
  CLOUD_AUTH_CLIENT_ID,
  CLOUD_AUTH_PLATFORM,
  CLOUD_AUTH_REDIRECT_URI,
  cloudAuthDeviceUrl,
  cloudAuthDevicesUrl,
  cloudAuthLogoutUrl,
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

const CLOUD_AUTH_REQUEST_TIMEOUT_MS = 15_000;
const OAUTH_DEV_PROBE_TIMEOUT_MS = 3_000;

export class CloudAuthApi implements CloudAuthApiLike {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    baseUrl: string = resolveCloudAuthBaseUrl(),
    fetchImpl?: typeof fetch,
  ) {
    this.baseUrl = normalizeCloudAuthBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl ?? defaultFetch;
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
      const stage = error.code === 'MIRA_REQUEST_TIMEOUT' ? 'TIMEOUT' : 'FETCH';
      throw new CloudAuthRequestError(
        'network',
        'Mira Cloud token exchange transport failure',
        `MOB081_${stage}_HEALTH_${probe.toUpperCase()}`,
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
}
