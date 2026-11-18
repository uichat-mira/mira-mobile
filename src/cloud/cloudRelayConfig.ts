/**
 * The hosted Cloud Relay is one Mira-operated, shared multi-account service.
 * This endpoint is platform-owned deployment configuration, never a field the
 * end user supplies or a per-account Relay instance. Each account/device is
 * isolated by Cloud Auth tickets, server-owned rooms and Desktop Host grants.
 *
 * This service is approved for all active release channels. Never substitute
 * Legacy `relay.tomz.io` if Cloud Auth or the official Relay is unavailable.
 */
export const normalizeCloudRelayBaseUrl = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/u, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Mira Cloud Relay address is not a valid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Mira Cloud Relay must use HTTPS');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Mira Cloud Relay URL must not contain credentials, query, or hash');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('Mira Cloud Relay URL must be a base URL');
  }
  return `${parsed.protocol}//${parsed.host}`;
};

export const resolveCloudRelayBaseUrl = (
  configured: string | null | undefined,
): string => {
  const value = configured?.trim() ?? '';
  if (!value) {
    throw new Error('Official Mira Cloud Relay service is not available in this build');
  }
  return normalizeCloudRelayBaseUrl(value);
};

/**
 * Release channel identifies the app/update artifact, not its Cloud transport.
 * All supported builds use the same operator-managed Cloud-only Relay.
 */
const OFFICIAL_CLOUD_RELAY_BASE_URL = 'https://cloud-relay.tomz.io';

export const officialCloudRelayEndpoint = (): string =>
  OFFICIAL_CLOUD_RELAY_BASE_URL;
