import {
  buildCloudAuthorizationUrl,
  CLOUD_AUTH_CLIENT_ID,
  CLOUD_AUTH_REDIRECT_URI,
  normalizeCloudAuthBaseUrl,
  resolveCloudAuthBaseUrl,
} from './cloudAuthConfig';

const state = 'state-0123456789-abcdef';
const codeChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('Mira Cloud OAuth configuration', () => {
  it('uses the exact registered first-party Mobile client and callback', () => {
    expect(CLOUD_AUTH_CLIENT_ID).toBe('mira-mobile');
    expect(CLOUD_AUTH_REDIRECT_URI).toBe('mira-mobile://oauth/callback');
  });

  it('selects the reviewed production and test origins without guessing a path', () => {
    expect(resolveCloudAuthBaseUrl('prod')).toBe(
      'https://cloud-auth.tomzlab.cn',
    );
    expect(resolveCloudAuthBaseUrl('test')).toBe(
      'https://test.cloud-auth.tomzlab.cn',
    );
    expect(resolveCloudAuthBaseUrl('dev')).toBe(
      'https://test.cloud-auth.tomzlab.cn',
    );
  });

  it('rejects insecure or ambiguous authorization origins', () => {
    expect(() => normalizeCloudAuthBaseUrl('http://example.com')).toThrow();
    expect(() =>
      normalizeCloudAuthBaseUrl('https://user:pass@example.com'),
    ).toThrow();
    expect(normalizeCloudAuthBaseUrl('https://example.com/')).toBe(
      'https://example.com',
    );
  });

  it('builds the OPS-016 authorization request with S256 and no secret', () => {
    const url = buildCloudAuthorizationUrl(
      'https://test.cloud-auth.tomzlab.cn',
      { state, codeChallenge },
    );
    const parsed = new URL(url);

    expect(parsed.origin).toBe('https://test.cloud-auth.tomzlab.cn');
    expect(parsed.pathname).toBe('/v1/oauth/authorize');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'mira-mobile',
      redirect_uri: 'mira-mobile://oauth/callback',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    expect(url).not.toContain('code_verifier');
    expect(url).not.toContain('password');
  });
});
