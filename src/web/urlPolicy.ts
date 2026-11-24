/**
 * Public-network URL policy shared by the Mobile web tool and its transport
 * preflight. Literal addresses can be rejected here; hostname resolution still
 * has to happen in the native transport, which must apply the same address
 * classification to every connection and redirect.
 */
/* eslint-disable no-bitwise -- address prefix tests are inherently bitwise */

const IPV4_OCTET = /^(?:0|[1-9]\d{0,2})$/u;
const URL_MAX_LENGTH = 4096;

export type WebUrlRejection =
  | 'invalid-url'
  | 'unsupported-scheme'
  | 'credentials'
  | 'missing-host'
  | 'non-public-address'
  | 'local-hostname'
  | 'unqualified-hostname'
  | 'too-long';

export type WebUrlPolicyResult =
  | { ok: true; url: URL; href: string }
  | { ok: false; reason: WebUrlRejection };

const parseIPv4 = (value: string): readonly number[] | null => {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!IPV4_OCTET.test(part)) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    octets.push(octet);
  }
  return octets;
};

/** Global unicast only; every IANA special-purpose range is rejected. */
export const isPublicIPv4 = (octets: readonly number[]): boolean => {
  if (octets.length !== 4) return false;
  const [a, b, c] = octets as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay anycast
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
};

const parseHextet = (value: string): number | null => {
  if (!/^[0-9a-f]{1,4}$/iu.test(value)) return null;
  return Number.parseInt(value, 16);
};

const parseIPv6 = (value: string): readonly number[] | null => {
  const input = value.toLowerCase();
  if (input.includes(':::')) return null;
  const double = input.indexOf('::');
  if (double !== -1 && input.indexOf('::', double + 1) !== -1) return null;

  const parseSection = (section: string): number[] | null => {
    if (!section) return [];
    const result: number[] = [];
    const parts = section.split(':');
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] as string;
      if (part.includes('.')) {
        if (index !== parts.length - 1) return null;
        const v4 = parseIPv4(part);
        if (!v4) return null;
        result.push((v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!);
        continue;
      }
      const hextet = parseHextet(part);
      if (hextet === null) return null;
      result.push(hextet);
    }
    return result;
  };

  const head = parseSection(double === -1 ? input : input.slice(0, double));
  const tail = parseSection(double === -1 ? '' : input.slice(double + 2));
  if (!head || !tail) return null;
  if (double === -1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
};

const bytesOf = (hextets: readonly number[]): readonly number[] =>
  hextets.flatMap(hextet => [hextet >> 8, hextet & 0xff]);

/** Global unicast IPv6 only; mapped/6to4/NAT64/special ranges are rejected. */
export const isPublicIPv6 = (hextets: readonly number[]): boolean => {
  if (hextets.length !== 8) return false;
  const [first] = hextets as [number, number, number, number, number, number, number, number];
  if ((first & 0xe000) !== 0x2000) return false; // only 2000::/3
  const bytes = bytesOf(hextets);

  // IETF protocol assignments, documentation, benchmarking, ORCHIDv2.
  if (bytes[0] === 0x20 && bytes[1] === 0x01) {
    const third = (bytes[2]! << 8) | bytes[3]!;
    if (third <= 0x01ff) return false;
    if (bytes[2] === 0x0d && bytes[3] === 0xb8) return false;
    if (bytes[2] === 0x00 && bytes[3] === 0x02) return false;
    if (bytes[2] === 0x00 && bytes[3] === 0x20) return false;
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return false; // 6to4
  if (bytes[0] === 0x3f && bytes[1] === 0xff && (bytes[2]! & 0xf0) === 0) return false;
  return true;
};

export const isPublicAddressLiteral = (hostname: string): boolean | null => {
  const host = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  const v4 = parseIPv4(host);
  if (v4) return isPublicIPv4(v4);
  if (host.includes(':')) {
    const v6 = parseIPv6(host);
    return v6 ? isPublicIPv6(v6) : false;
  }
  return null;
};

const LOCAL_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.intranet',
  '.lan',
  '.home',
  '.corp',
] as const;

const isLocalHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.$/u, '');
  if (host === 'localhost') return true;
  return LOCAL_SUFFIXES.some(suffix => host.endsWith(suffix));
};

/**
 * Parses one HTTP(S) target and rejects credentials, non-public literal
 * addresses and names that are reserved for local resolution. Hostname
 * resolution and redirect enforcement belong to the native transport.
 */
export const checkPublicWebUrl = (raw: string): WebUrlPolicyResult => {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, reason: 'missing-host' };
  }
  const trimmed = raw.trim();
  if (trimmed.length > URL_MAX_LENGTH) return { ok: false, reason: 'too-long' };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported-scheme' };
  }
  if (url.username || url.password) return { ok: false, reason: 'credentials' };
  if (!url.hostname) return { ok: false, reason: 'missing-host' };

  const hostname = url.hostname.toLowerCase();
  const literal = isPublicAddressLiteral(hostname);
  if (literal === false) return { ok: false, reason: 'non-public-address' };
  if (literal === null) {
    if (isLocalHostname(hostname)) return { ok: false, reason: 'local-hostname' };
    const bare = hostname.replace(/\.$/u, '');
    if (!bare.includes('.')) return { ok: false, reason: 'unqualified-hostname' };
    if (bare.length > 253) return { ok: false, reason: 'invalid-url' };
  }

  const href = url.href.replace(/#.*$/u, '');
  return { ok: true, url: new URL(href), href };
};
