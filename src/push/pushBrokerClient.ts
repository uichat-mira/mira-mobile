import {
  PUSH_BROKER_SCHEMA_VERSION,
  bindingApprovalSigningValue,
  bindingRevokeSigningValue,
  installationRevokeSigningValue,
  normalizePushSourceScope,
  registrationSigningValue,
  type PushBindingDescriptor,
  type PushProviderPlatform,
  type PushRegistrationAction,
} from './brokerContracts';
import {
  pushInstallationIdentity,
  type PushInstallationIdentityService,
} from './installationIdentity';

export class PushBrokerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'PushBrokerError';
  }
}

export interface PushRegistrationReceipt {
  installationId: string;
  status: 'registered' | 'refreshed';
  registeredAt: string;
}

export interface PushBindingReceipt {
  installationId: string;
  hostId: string;
  status: 'authorized';
  deliveryToken: string;
}

type FetchLike = typeof fetch;

const normalizeBaseUrl = (
  value: string,
  allowInsecureDevelopment: boolean,
) => {
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Push Broker base URL must not include credentials, query, or fragment');
  }
  const local =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1';
  if (url.protocol !== 'https:' && !(allowInsecureDevelopment && local)) {
    throw new Error('Push Broker requires HTTPS outside local development');
  }
  return url.toString().replace(/\/$/u, '');
};

const parseObject = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PushBrokerError('INVALID_RESPONSE', 'Push Broker returned an invalid response');
  }
  return value as Record<string, unknown>;
};

const readJson = async (response: Response) => {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PushBrokerError(
      'INVALID_JSON',
      'Push Broker returned invalid JSON',
      response.status,
    );
  }
};

const registrationReceipt = (value: unknown): PushRegistrationReceipt => {
  const record = parseObject(value);
  if (
    typeof record.installationId !== 'string' ||
    (record.status !== 'registered' && record.status !== 'refreshed') ||
    typeof record.registeredAt !== 'string'
  ) {
    throw new PushBrokerError('INVALID_RESPONSE', 'Push Broker registration response is incomplete');
  }
  return {
    installationId: record.installationId,
    status: record.status,
    registeredAt: record.registeredAt,
  };
};

const bindingReceipt = (value: unknown): PushBindingReceipt => {
  const record = parseObject(value);
  if (
    typeof record.installationId !== 'string' ||
    typeof record.hostId !== 'string' ||
    record.status !== 'authorized' ||
    typeof record.deliveryToken !== 'string' ||
    record.deliveryToken.length < 32
  ) {
    throw new PushBrokerError('INVALID_RESPONSE', 'Push Broker binding response is incomplete');
  }
  return {
    installationId: record.installationId,
    hostId: record.hostId,
    status: 'authorized',
    deliveryToken: record.deliveryToken,
  };
};

export class PushBrokerClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly identity: PushInstallationIdentityService =
      pushInstallationIdentity,
    private readonly fetchImpl: FetchLike = fetch,
    allowInsecureDevelopment = false,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl, allowInsecureDevelopment);
  }

  registerProviderToken(
    platform: PushProviderPlatform,
    providerToken: string,
  ) {
    return this.writeRegistration('register', platform, providerToken);
  }

  refreshProviderToken(
    platform: PushProviderPlatform,
    providerToken: string,
  ) {
    return this.writeRegistration('refresh', platform, providerToken);
  }

  async approveBinding(
    descriptor: Omit<PushBindingDescriptor, 'hostSignature' | 'brokerBaseUrl'>,
  ): Promise<PushBindingReceipt> {
    const identity = await this.identity.getOrCreate();
    if (descriptor.installationId !== identity.installationId) {
      throw new PushBrokerError(
        'INSTALLATION_MISMATCH',
        'Host Push binding descriptor targets another installation',
      );
    }
    const sourceScope = normalizePushSourceScope(descriptor.sourceScope);
    if (sourceScope.length === 0) {
      throw new PushBrokerError('INVALID_SOURCE_SCOPE', 'Push source scope is empty');
    }
    const unsigned = {
      schemaVersion: PUSH_BROKER_SCHEMA_VERSION,
      installationId: identity.installationId,
      hostId: descriptor.hostId,
      hostPublicKey: descriptor.hostPublicKey,
      sourceScope,
      bindingNonce: descriptor.bindingNonce,
      bindingExpiresAt: descriptor.bindingExpiresAt,
    };
    const installationSignature = await this.identity.sign(
      bindingApprovalSigningValue(unsigned),
    );
    return this.request(
      `/v1/installations/${encodeURIComponent(identity.installationId)}/bindings/approve`,
      {
        ...unsigned,
        installationSignature,
      },
      bindingReceipt,
    );
  }

  async revokeBinding(hostId: string): Promise<void> {
    const identity = await this.identity.getOrCreate();
    const unsigned = {
      schemaVersion: PUSH_BROKER_SCHEMA_VERSION,
      installationId: identity.installationId,
      hostId,
      requestNonce: await this.identity.createNonce(),
      issuedAt: this.now().toISOString(),
    };
    const installationSignature = await this.identity.sign(
      bindingRevokeSigningValue(unsigned),
    );
    await this.request(
      `/v1/installations/${encodeURIComponent(identity.installationId)}/bindings/revoke`,
      { ...unsigned, installationSignature },
      value => {
        const record = parseObject(value);
        if (
          record.installationId !== identity.installationId ||
          record.hostId !== hostId ||
          record.status !== 'revoked'
        ) {
          throw new PushBrokerError('INVALID_RESPONSE', 'Push Broker binding revoke response is incomplete');
        }
      },
    );
  }

  async revokeInstallation(): Promise<void> {
    const identity = await this.identity.getOrCreate();
    const unsigned = {
      schemaVersion: PUSH_BROKER_SCHEMA_VERSION,
      installationId: identity.installationId,
      requestNonce: await this.identity.createNonce(),
      issuedAt: this.now().toISOString(),
    };
    const installationSignature = await this.identity.sign(
      installationRevokeSigningValue(unsigned),
    );
    await this.request(
      `/v1/installations/${encodeURIComponent(identity.installationId)}/revoke`,
      { ...unsigned, installationSignature },
      value => {
        const record = parseObject(value);
        if (
          record.installationId !== identity.installationId ||
          record.status !== 'revoked'
        ) {
          throw new PushBrokerError('INVALID_RESPONSE', 'Push Broker installation revoke response is incomplete');
        }
      },
    );
    await this.identity.reset();
  }

  private async writeRegistration(
    action: PushRegistrationAction,
    platform: PushProviderPlatform,
    providerToken: string,
  ): Promise<PushRegistrationReceipt> {
    const token = providerToken.trim();
    if (!token) {
      throw new PushBrokerError('PROVIDER_TOKEN_REQUIRED', 'Push provider token is required');
    }
    const identity = await this.identity.getOrCreate();
    const unsigned = {
      schemaVersion: PUSH_BROKER_SCHEMA_VERSION,
      installationId: identity.installationId,
      platform,
      providerToken: token,
      installationPublicKey: identity.installationPublicKey,
      requestNonce: await this.identity.createNonce(),
      issuedAt: this.now().toISOString(),
    };
    const installationSignature = await this.identity.sign(
      registrationSigningValue(action, unsigned),
    );
    return this.request(
      `/v1/installations/${encodeURIComponent(identity.installationId)}/${action}`,
      { ...unsigned, installationSignature },
      registrationReceipt,
    );
  }

  private async request<T>(
    path: string,
    body: unknown,
    parse: (value: unknown) => T,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new PushBrokerError(
        'NETWORK_ERROR',
        error instanceof Error ? error.message : 'Unable to reach Push Broker',
      );
    }
    const payload = await readJson(response);
    if (!response.ok) {
      const record =
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : null;
      throw new PushBrokerError(
        typeof record?.error === 'string' ? record.error : `HTTP_${response.status}`,
        `Push Broker request failed with HTTP ${response.status}`,
        response.status,
      );
    }
    return parse(payload);
  }
}
