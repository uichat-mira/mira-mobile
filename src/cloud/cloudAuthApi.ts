import {
  CLOUD_AUTH_CLIENT_ID,
  CLOUD_AUTH_PLATFORM,
  CLOUD_AUTH_REDIRECT_URI,
  cloudAuthLogoutUrl,
  cloudAuthSessionUrl,
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

export interface OAuthCodeExchangeRequest {
  code: string;
  codeVerifier: string;
  installationId: string;
}

export type CloudAuthFailureKind =
  | 'network'
  | 'unavailable'
  | 'rejected'
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
  logout(sessionToken: string): Promise<void>;
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

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, init);
    } catch {
      throw new CloudAuthRequestError('network', 'Mira Cloud is unreachable');
    }
  }

  async exchangeAuthorizationCode(
    request: OAuthCodeExchangeRequest,
  ): Promise<IssuedCloudSession> {
    const response = await this.send(cloudAuthTokenUrl(this.baseUrl), {
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
    });

    if (!response.ok) {
      throw await failureForResponse(response, true);
    }

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
  }

  async getSession(sessionToken: string): Promise<CloudSessionSummary> {
    const response = await this.send(cloudAuthSessionUrl(this.baseUrl), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${sessionToken}`,
      },
    });

    if (!response.ok) {
      throw await failureForResponse(response, false);
    }

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
  }

  async logout(sessionToken: string): Promise<void> {
    const response = await this.send(cloudAuthLogoutUrl(this.baseUrl), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${sessionToken}`,
      },
    });

    if (!response.ok) {
      throw await failureForResponse(response, false);
    }
  }
}
