import {
  CloudAuthApi,
  CloudAuthRequestError,
  parseIssuedCloudSession,
} from './cloudAuthApi';

const issued = {
  sessionToken: 'mcs_v1.session-id.session-secret',
  account: { id: 'account-1', username: 'alice' },
  expiresAt: '2026-11-25T11:00:00.000Z',
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const emptyResponse = (status: number) => new Response(null, { status });

const installationId = '6f9619ff-8b86-4d01-b42d-00c04fc964ff';

describe('Mira Cloud OAuth/API contract', () => {
  it('parses the OPS-017 issued Cloud Session fixture', () => {
    expect(parseIssuedCloudSession(issued)).toEqual(issued);
    expect(() =>
      parseIssuedCloudSession({ ...issued, sessionToken: '' }),
    ).toThrow(CloudAuthRequestError);
  });

  it('exchanges the code with the exact registered client, redirect and PKCE fields', async () => {
    const fetchMock = jest.fn(async () => jsonResponse(200, issued));
    const api = new CloudAuthApi(
      'https://test.cloud-auth.tomzlab.cn',
      fetchMock as unknown as typeof fetch,
    );

    const result = await api.exchangeAuthorizationCode({
      code: `mca_v1.${'a'.repeat(22)}.${'b'.repeat(43)}`,
      codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      installationId,
    });

    expect(result).toEqual(issued);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://test.cloud-auth.tomzlab.cn/v1/oauth/token');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      grant_type: 'authorization_code',
      client_id: 'mira-mobile',
      code: `mca_v1.${'a'.repeat(22)}.${'b'.repeat(43)}`,
      redirect_uri: 'mira-mobile://oauth/callback',
      code_verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      installation_id: installationId,
      platform: 'mobile',
    });
    expect(JSON.stringify(init.body)).not.toContain('password');
  });

  it('maps wrong-verifier/replayed-code invalid_grant to a bounded rejection', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse(400, {
        error: {
          code: 'OAUTH_INVALID_GRANT',
          message: 'Authorization code cannot be exchanged',
        },
      }),
    );
    const api = new CloudAuthApi(
      'https://test.cloud-auth.tomzlab.cn',
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      api.exchangeAuthorizationCode({
        code: `mca_v1.${'a'.repeat(22)}.${'b'.repeat(43)}`,
        codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
        installationId,
      }),
    ).rejects.toMatchObject({
      kind: 'rejected',
      code: 'OAUTH_INVALID_GRANT',
    });
  });

  it('restores a valid session and classifies an explicit 401 as rejected', async () => {
    const validFetch = jest.fn(async () =>
      jsonResponse(200, {
        account: issued.account,
        expiresAt: issued.expiresAt,
      }),
    );
    const validApi = new CloudAuthApi(
      'https://test.cloud-auth.tomzlab.cn',
      validFetch as unknown as typeof fetch,
    );
    await expect(validApi.getSession(issued.sessionToken)).resolves.toEqual({
      account: issued.account,
      expiresAt: issued.expiresAt,
    });

    const rejectedFetch = jest.fn(async () =>
      jsonResponse(401, {
        error: {
          code: 'AUTH_REAUTH_REQUIRED',
          message: 'Re-authentication is required',
        },
      }),
    );
    const rejectedApi = new CloudAuthApi(
      'https://test.cloud-auth.tomzlab.cn',
      rejectedFetch as unknown as typeof fetch,
    );
    await expect(
      rejectedApi.getSession(issued.sessionToken),
    ).rejects.toMatchObject({
      kind: 'rejected',
      code: 'AUTH_REAUTH_REQUIRED',
    });
  });

  it('keeps network failure distinct and never includes the session token', async () => {
    const api = new CloudAuthApi(
      'https://test.cloud-auth.tomzlab.cn',
      (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    );

    await expect(api.getSession(issued.sessionToken)).rejects.toMatchObject({
      kind: 'network',
    });
    try {
      await api.getSession(issued.sessionToken);
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(
        issued.sessionToken,
      );
    }
  });

  it('does not misinterpret rate limiting as an explicit session rejection', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse(429, {
        error: {
          code: 'AUTH_RATE_LIMITED',
          message: 'Too many requests',
        },
      }),
    );
    const api = new CloudAuthApi(
      'https://test.cloud-auth.tomzlab.cn',
      fetchMock as unknown as typeof fetch,
    );

    await expect(api.getSession(issued.sessionToken)).rejects.toMatchObject({
      kind: 'unavailable',
    });
    await expect(api.logout(issued.sessionToken)).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('treats logout 204 and already-revoked 401 as resolved/rejected respectively', async () => {
    const revokedFetch = jest.fn(async () => emptyResponse(204));
    const revokedApi = new CloudAuthApi(
      'https://test.cloud-auth.tomzlab.cn',
      revokedFetch as unknown as typeof fetch,
    );
    await expect(
      revokedApi.logout(issued.sessionToken),
    ).resolves.toBeUndefined();

    const alreadyFetch = jest.fn(async () =>
      jsonResponse(401, {
        error: {
          code: 'AUTH_REAUTH_REQUIRED',
          message: 'Re-authentication is required',
        },
      }),
    );
    const alreadyApi = new CloudAuthApi(
      'https://test.cloud-auth.tomzlab.cn',
      alreadyFetch as unknown as typeof fetch,
    );
    await expect(alreadyApi.logout(issued.sessionToken)).rejects.toMatchObject({
      kind: 'rejected',
    });
  });
});
