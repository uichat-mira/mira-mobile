/**
 * Official Cloud Relay is only reachable through an explicitly approved
 * isolated Worker. There is intentionally no default URL and no silent switch
 * to the Legacy `relay.tomz.io` transport.
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
    throw new Error('Mira Cloud Relay endpoint is not configured in this build');
  }
  return normalizeCloudRelayBaseUrl(value);
};
