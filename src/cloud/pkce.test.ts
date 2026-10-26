import {
  base64UrlToBytes,
  bytesToBase64Url,
  codeChallengeForVerifier,
  createOAuthState,
  createPkcePair,
  isValidAuthorizationCode,
  isValidCodeVerifier,
  isValidOAuthState,
  isValidUuidV4,
  sha256,
  uuidV4FromBytes,
  utf8Bytes,
} from './pkce';

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

const randomBytes = async (length: number) =>
  bytesToBase64Url(
    Uint8Array.from({ length }, (_, index) => (index % 255) + 1),
  );

describe('OAuth PKCE and callback primitives', () => {
  it('matches the RFC 7636 S256 reference vector', () => {
    expect(
      codeChallengeForVerifier('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    ).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('computes standard SHA-256 for ASCII and UTF-8 input', () => {
    expect(hex(sha256(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(hex(sha256(utf8Bytes('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('round-trips base64url without padding', () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = bytesToBase64Url(bytes);
    expect(encoded).not.toContain('=');
    expect(Array.from(base64UrlToBytes(encoded))).toEqual(Array.from(bytes));
  });

  it('creates a verifier and state that satisfy the server contract', async () => {
    const pair = await createPkcePair(randomBytes);
    const state = await createOAuthState(randomBytes);

    expect(pair.verifier).toHaveLength(43);
    expect(isValidCodeVerifier(pair.verifier)).toBe(true);
    expect(pair.challenge).toHaveLength(43);
    expect(isValidOAuthState(state)).toBe(true);
    expect(
      isValidAuthorizationCode(`mca_v1.${'a'.repeat(22)}.${'b'.repeat(43)}`),
    ).toBe(true);
    expect(isValidAuthorizationCode('mca_v1.short')).toBe(false);
  });

  it('derives a stable random UUIDv4 installation identity', () => {
    const bytes = Uint8Array.from({ length: 16 }, (_, index) => index);
    const uuid = uuidV4FromBytes(bytes);
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(isValidUuidV4(uuid)).toBe(true);
    expect(uuid).toBe(uuidV4FromBytes(bytes));
  });
});
