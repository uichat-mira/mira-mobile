import {
  parseIssuedWhoYouReadCredential,
  requestWhoYouReadCredential,
} from './whoYouCredential';
import { WhoYouError } from './whoYouError';
import { WHO_YOU_AUDIENCE, WHO_YOU_READ_SCOPE } from './whoYouConfig';

const NOW = new Date('2026-11-22T00:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const ACCOUNT = 'account-1';
const SESSION = 'mcs_v1.session-id.session-secret';

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const base64Url = (value: string): string => {
  const binary = unescape(encodeURIComponent(value));
  let encoded = '';
  for (let index = 0; index < binary.length; index += 3) {
    const first = binary.charCodeAt(index);
    const second =
      index + 1 < binary.length ? binary.charCodeAt(index + 1) : 0;
    const third =
      index + 2 < binary.length ? binary.charCodeAt(index + 2) : 0;
    const packed = (first << 16) | (second << 8) | third;
    encoded += BASE64_ALPHABET[(packed >> 18) & 0x3f];
    encoded += BASE64_ALPHABET[(packed >> 12) & 0x3f];
    encoded +=
      index + 1 < binary.length
        ? BASE64_ALPHABET[(packed >> 6) & 0x3f]
        : '=';
    encoded += index + 2 < binary.length ? BASE64_ALPHABET[packed & 0x3f] : '=';
  }
  return encoded
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');
};

const tokenFor = (
  overrides: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): string => {
  const header = { alg: 'EdDSA', typ: 'JWT', kid: 'test-key' };
  const claims = {
    iss: 'mira:cloud-auth',
    sub: ACCOUNT,
    consumer_id: ACCOUNT,
    device_id: 'device-mobile-1',
    aud: WHO_YOU_AUDIENCE,
    scope: [WHO_YOU_READ_SCOPE],
    iat: NOW_SECONDS - 60,
    nbf: NOW_SECONDS - 60,
    exp: NOW_SECONDS + 300,
    preferred_username: '狐邮用户',
    ...extra,
    ...overrides,
  };
  return [
    base64Url(JSON.stringify(header)),
    base64Url(JSON.stringify(claims)),
    'signature',
  ].join('.');
};

const expiresAt = new Date((NOW_SECONDS + 300) * 1000).toISOString();

const issued = () => ({
  token: tokenFor(),
  tokenType: 'Bearer',
  audience: WHO_YOU_AUDIENCE,
  expiresAt,
});

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('Who You read credential issuance', () => {
  it('requests only the default read audience and never persists or exposes the session', async () => {
    const fetchMock = jest.fn(async () => jsonResponse(200, issued()));
    const credential = await requestWhoYouReadCredential(SESSION, ACCOUNT, {
      baseUrl: 'https://cloud-auth.example.test',
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => NOW,
    });

    expect(credential.token).toBe(tokenFor());
    expect(credential.audience).toBe(WHO_YOU_AUDIENCE);
    expect(credential.claims).toEqual({
      accountId: ACCOUNT,
      deviceId: 'device-mobile-1',
      scopes: [WHO_YOU_READ_SCOPE],
      expiresAt,
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit & { redirect?: string },
    ];
    expect(url).toBe(
      'https://cloud-auth.example.test/v1/service-credentials',
    );
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(JSON.parse(String(init.body))).toEqual({
      audience: WHO_YOU_AUDIENCE,
    });
    expect(String(init.body)).not.toContain('scope');
    expect(String(init.body)).not.toContain('confirmation');
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${SESSION}`,
    );
  });

  it('fails closed for a wrong response audience or a non-read token', async () => {
    await expect(
      requestWhoYouReadCredential(SESSION, ACCOUNT, {
        baseUrl: 'https://cloud-auth.example.test',
        fetchImpl: (async () =>
          jsonResponse(200, {
            ...issued(),
            audience: 'mira:cloud-guanlan',
          })) as unknown as typeof fetch,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });

    for (const token of [
      tokenFor({ aud: 'mira:cloud-guanlan' }),
      tokenFor({ scope: [WHO_YOU_READ_SCOPE, 'whoyou.mail.write'] }),
      tokenFor({ consumer_id: 'another-account' }),
      tokenFor({ confirmation: { actor: 'user' } }),
      tokenFor({ exp: NOW_SECONDS - 1, nbf: NOW_SECONDS - 10 }),
    ]) {
      await expect(
        requestWhoYouReadCredential(SESSION, ACCOUNT, {
          baseUrl: 'https://cloud-auth.example.test',
          fetchImpl: (async () =>
            jsonResponse(200, {
              ...issued(),
              token,
            })) as unknown as typeof fetch,
          now: () => NOW,
        }),
      ).rejects.toMatchObject({ kind: 'invalid_response' });
    }
  });

  it('parses the exact token shape without accepting a write scope', () => {
    const credential = parseIssuedWhoYouReadCredential(
      issued(),
      ACCOUNT,
      NOW.getTime(),
    );
    expect(credential.claims.scopes).toEqual([WHO_YOU_READ_SCOPE]);
    expect(() =>
      parseIssuedWhoYouReadCredential(
        { ...issued(), token: tokenFor({ exp: NOW_SECONDS - 1 }) },
        ACCOUNT,
        NOW.getTime(),
      ),
    ).toThrow(WhoYouError);
  });

  it('distinguishes rejected sessions from Cloud Auth availability failures', async () => {
    await expect(
      requestWhoYouReadCredential(SESSION, ACCOUNT, {
        baseUrl: 'https://cloud-auth.example.test',
        fetchImpl: (async () =>
          jsonResponse(401, {
            error: { code: 'SERVICE_CREDENTIAL_REAUTH_REQUIRED' },
          })) as unknown as typeof fetch,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({
      kind: 'session_rejected',
      code: 'SERVICE_CREDENTIAL_REAUTH_REQUIRED',
    });

    await expect(
      requestWhoYouReadCredential(SESSION, ACCOUNT, {
        baseUrl: 'https://cloud-auth.example.test',
        fetchImpl: (async () =>
          jsonResponse(503, {
            error: { code: 'SERVICE_CREDENTIAL_UNAVAILABLE' },
          })) as unknown as typeof fetch,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({
      kind: 'unavailable',
      code: 'SERVICE_CREDENTIAL_UNAVAILABLE',
    });
  });

  it('never surfaces a raw token or session secret in transport errors', async () => {
    let failure: unknown;
    try {
      await requestWhoYouReadCredential(SESSION, ACCOUNT, {
        baseUrl: 'https://cloud-auth.example.test',
        fetchImpl: (async () => {
          throw new Error(`native failure ${SESSION} ${tokenFor()}`);
        }) as unknown as typeof fetch,
        now: () => NOW,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(WhoYouError);
    const message = (failure as Error).message;
    expect(message).not.toContain(SESSION);
    expect(message).not.toContain(tokenFor());
  });
});
