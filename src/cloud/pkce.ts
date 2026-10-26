/* eslint-disable no-bitwise, no-div-regex */
const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotateRight = (value: number, bits: number): number =>
  (value >>> bits) | (value << (32 - bits));

export const utf8Bytes = (value: string): Uint8Array => {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.codePointAt(index);
    if (codePoint === undefined) continue;
    if (codePoint > 0xffff) index += 1;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
};

export const bytesToBase64Url = (value: Uint8Array): string => {
  let output = '';
  for (let index = 0; index < value.length; index += 3) {
    const first = value[index] ?? 0;
    const second = value[index + 1] ?? 0;
    const third = value[index + 2] ?? 0;
    const chunk = (first << 16) | (second << 8) | third;
    output += BASE64_ALPHABET[(chunk >> 18) & 63];
    output += BASE64_ALPHABET[(chunk >> 12) & 63];
    output +=
      index + 1 < value.length ? BASE64_ALPHABET[(chunk >> 6) & 63] : '=';
    output += index + 2 < value.length ? BASE64_ALPHABET[chunk & 63] : '=';
  }
  return output.replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

export const base64UrlToBytes = (value: string): Uint8Array => {
  const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of padded.replace(/=+$/u, '')) {
    const index = BASE64_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Invalid base64url value');
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
};

export const sha256 = (input: Uint8Array): Uint8Array => {
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;

  const view = new DataView(padded.buffer);
  const bitLength = input.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const first = words[index - 15] ?? 0;
      const second = words[index - 2] ?? 0;
      const sigma0 =
        rotateRight(first, 7) ^ rotateRight(first, 18) ^ (first >>> 3);
      const sigma1 =
        rotateRight(second, 17) ^ rotateRight(second, 19) ^ (second >>> 10);
      words[index] =
        ((words[index - 16] ?? 0) +
          sigma0 +
          (words[index - 7] ?? 0) +
          sigma1) >>>
        0;
    }

    let a = hash[0] ?? 0;
    let b = hash[1] ?? 0;
    let c = hash[2] ?? 0;
    let d = hash[3] ?? 0;
    let e = hash[4] ?? 0;
    let f = hash[5] ?? 0;
    let g = hash[6] ?? 0;
    let h = hash[7] ?? 0;

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 =
        (h +
          sum1 +
          choice +
          (SHA256_CONSTANTS[index] ?? 0) +
          (words[index] ?? 0)) >>>
        0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = ((hash[0] ?? 0) + a) >>> 0;
    hash[1] = ((hash[1] ?? 0) + b) >>> 0;
    hash[2] = ((hash[2] ?? 0) + c) >>> 0;
    hash[3] = ((hash[3] ?? 0) + d) >>> 0;
    hash[4] = ((hash[4] ?? 0) + e) >>> 0;
    hash[5] = ((hash[5] ?? 0) + f) >>> 0;
    hash[6] = ((hash[6] ?? 0) + g) >>> 0;
    hash[7] = ((hash[7] ?? 0) + h) >>> 0;
  }

  const result = new Uint8Array(32);
  const resultView = new DataView(result.buffer);
  for (let index = 0; index < hash.length; index += 1) {
    resultView.setUint32(index * 4, hash[index] ?? 0);
  }
  return result;
};

export const codeChallengeForVerifier = (verifier: string): string =>
  bytesToBase64Url(sha256(utf8Bytes(verifier)));

export const isValidCodeVerifier = (value: string): boolean =>
  /^[A-Za-z0-9\-._~]{43,128}$/u.test(value);

export const isValidOAuthState = (value: string): boolean =>
  /^[A-Za-z0-9._~-]{16,512}$/u.test(value);

export const isValidAuthorizationCode = (value: string): boolean =>
  /^mca_v1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/u.test(value);

export const isValidPkceChallenge = (value: string): boolean =>
  /^[A-Za-z0-9_-]{43}$/u.test(value) && !/^([A-Za-z0-9_-])\1{42}$/u.test(value);

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export const createPkcePair = async (
  randomBytes: (length: number) => Promise<string>,
): Promise<PkcePair> => {
  const verifier = await randomBytes(32);
  if (!isValidCodeVerifier(verifier)) {
    throw new Error('Secure random verifier is not PKCE compatible');
  }
  const challenge = codeChallengeForVerifier(verifier);
  if (!isValidPkceChallenge(challenge)) {
    throw new Error('Generated PKCE challenge is invalid');
  }
  return { verifier, challenge };
};

export const createOAuthState = async (
  randomBytes: (length: number) => Promise<string>,
): Promise<string> => {
  const state = await randomBytes(32);
  if (!isValidOAuthState(state)) {
    throw new Error('Secure random OAuth state is invalid');
  }
  return state;
};

export const uuidV4FromBytes = (bytes: Uint8Array): string => {
  if (bytes.length !== 16) {
    throw new Error('A UUIDv4 requires exactly 16 bytes');
  }
  const value = Uint8Array.from(bytes);
  value[6] = ((value[6] ?? 0) & 0x0f) | 0x40;
  value[8] = ((value[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(value, byte => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
};

export const isValidUuidV4 = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
    value,
  );
