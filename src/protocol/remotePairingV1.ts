import { normalizeHostUrl } from './remoteHostV1';

export interface RemoteRelayHint {
  endpoint: string;
  relayId: string;
}

export interface RemoteRelayEndpoint extends RemoteRelayHint {
  token: string;
}

/**
 * QR / paste / deep-link pairing is a Tailscale Direct entry. Relay fields
 * that older Desktop builds put in the URI are ignored, so a Relay token can
 * never redirect this one-time claim to another transport.
 */
export interface PairingDescriptorV1 {
  version: 1;
  hostUrl: string;
  challengeId: string;
  code: string;
}

export const normalizeRelayEndpoint = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Mira Relay address is not a valid URL');
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Mira Relay URL must not contain credentials, query, or hash');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('Mira Relay URL must be a base URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Mira Relay must use HTTPS');
  }
  if (!parsed.hostname) {
    throw new Error('Mira Relay URL must include a hostname');
  }

  return `${parsed.protocol}//${parsed.host}`;
};

/**
 * New QR/paste/deep-link pairing accepts only Tailscale Direct origins.
 * The format check is not peer authentication: TLS, /app/meta and the
 * pairing challenge/approval still verify the actual Desktop at runtime.
 * Do not apply this restriction to already paired legacy credentials.
 */
export const normalizeTailscalePairingHostUrl = (value: string): string => {
  const normalized = normalizeHostUrl(value, {
    allowInsecureDevelopment: __DEV__,
  });
  const parsed = new URL(normalized);
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Tailscale Direct Host must be a base URL without path or query');
  }
  const hostname = parsed.hostname.toLowerCase();
  const octets = hostname.split('.');
  const tailscaleIPv4 =
    octets.length === 4 &&
    octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255) &&
    Number(octets[0]) === 100 &&
    Number(octets[1]) >= 64 &&
    Number(octets[1]) <= 127;
  const tailnetDns =
    hostname !== 'ts.net' &&
    hostname.endsWith('.ts.net') &&
    hostname.split('.').every(part => /^[a-z0-9-]+$/.test(part));
  if (!tailnetDns && !tailscaleIPv4) {
    throw new Error('Tailscale Direct Host must use a Tailnet .ts.net hostname or 100.64.0.0/10 address');
  }
  return parsed.origin;
};

export const parsePairingUriV1 = (value: string): PairingDescriptorV1 => {
  const trimmed = value.trim();
  if (!/^mira:\/\/pair(?:\?|$)/u.test(trimmed)) {
    throw new Error('Pairing link must start with mira://pair');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Pairing link is not a valid URI');
  }

  const version = Number(parsed.searchParams.get('version'));
  if (version !== 1) {
    throw new Error(`Unsupported Mira pairing protocol version: ${String(version)}`);
  }

  const challengeId = parsed.searchParams.get('challenge')?.trim() ?? '';
  const code = parsed.searchParams.get('code')?.trim().toUpperCase() ?? '';
  if (!challengeId || !code) {
    throw new Error('Pairing link is missing challenge or code');
  }

  // The QR pairing entry is the independent, cloud-free Tailscale Direct path.
  // Historical `relay`, `relayId`, and `relayToken` parameters stay inert: an
  // old Desktop producer must not turn this claim into a Relay claim.
  const hostValue = parsed.searchParams.get('host')?.trim() ?? '';
  if (!hostValue) {
    throw new Error(
      'Pairing link must include a Tailscale Direct Host address; Relay-only pairing is not supported',
    );
  }
  const hostUrl = normalizeTailscalePairingHostUrl(hostValue);

  return {
    version: 1,
    hostUrl,
    challengeId,
    code,
  };
};
