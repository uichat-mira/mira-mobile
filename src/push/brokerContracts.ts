export const PUSH_BROKER_SCHEMA_VERSION = 1 as const;

export type PushProviderPlatform = 'android' | 'ios';
export type PushRegistrationAction = 'register' | 'refresh';

export interface PushBindingDescriptor {
  schemaVersion: 1;
  hostId: string;
  hostPublicKey: string;
  installationId: string;
  sourceScope: string[];
  bindingNonce: string;
  bindingExpiresAt: string;
  brokerBaseUrl: string;
  hostSignature: string;
}

const compareStrings = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

export const normalizePushSourceScope = (value: readonly string[]) =>
  [...new Set(value.map(item => item.trim()).filter(Boolean))].sort(compareStrings);

export const canonicalJson = (value: unknown): string => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Non-finite canonical number');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort(compareStrings);
    return `{${keys
      .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  throw new Error('Unsupported canonical value');
};

export const registrationSigningValue = (
  action: PushRegistrationAction,
  request: {
    schemaVersion: 1;
    installationId: string;
    platform: PushProviderPlatform;
    providerToken: string;
    installationPublicKey: string;
    requestNonce: string;
    issuedAt: string;
  },
) =>
  canonicalJson({
    action,
    schemaVersion: request.schemaVersion,
    installationId: request.installationId,
    platform: request.platform,
    providerToken: request.providerToken,
    installationPublicKey: request.installationPublicKey,
    requestNonce: request.requestNonce,
    issuedAt: request.issuedAt,
  });

export const installationRevokeSigningValue = (request: {
  schemaVersion: 1;
  installationId: string;
  requestNonce: string;
  issuedAt: string;
}) =>
  canonicalJson({
    action: 'revoke-installation',
    schemaVersion: request.schemaVersion,
    installationId: request.installationId,
    requestNonce: request.requestNonce,
    issuedAt: request.issuedAt,
  });

export const bindingApprovalSigningValue = (request: {
  schemaVersion: 1;
  installationId: string;
  hostId: string;
  hostPublicKey: string;
  sourceScope: string[];
  bindingNonce: string;
  bindingExpiresAt: string;
}) =>
  canonicalJson({
    action: 'approve-binding',
    schemaVersion: request.schemaVersion,
    installationId: request.installationId,
    hostId: request.hostId,
    hostPublicKey: request.hostPublicKey,
    sourceScope: [...request.sourceScope].sort(compareStrings),
    bindingNonce: request.bindingNonce,
    bindingExpiresAt: request.bindingExpiresAt,
  });

export const bindingRevokeSigningValue = (request: {
  schemaVersion: 1;
  installationId: string;
  hostId: string;
  requestNonce: string;
  issuedAt: string;
}) =>
  canonicalJson({
    action: 'revoke-binding',
    schemaVersion: request.schemaVersion,
    installationId: request.installationId,
    hostId: request.hostId,
    requestNonce: request.requestNonce,
    issuedAt: request.issuedAt,
  });
