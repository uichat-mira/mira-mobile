import {
  CloudAuthApi,
  CloudAuthRequestError,
  parseIssuedCloudSession,
  parseMiraDevice,
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

  it('diagnoses immediate dev token fetch failure using only a credential-free native health GET', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('sensitive native failure payload'))
      .mockResolvedValueOnce(jsonResponse(200, { status: 'ok' }));
    const api = new CloudAuthApi(
      'https://cloud-auth.tomzlab.cn',
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      api.exchangeAuthorizationCode({
        code: 'single-use-secret',
        codeVerifier: 'secret-verifier',
        installationId,
      }),
    ).rejects.toMatchObject({
      kind: 'network',
      code: 'MOB081_FETCH_HEALTH_OK',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [probeUrl, probeInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(probeUrl).toBe('https://cloud-auth.tomzlab.cn/health');
    expect(probeInit.method).toBe('GET');
    expect(probeInit.credentials).toBe('omit');
    expect(probeInit.body).toBeUndefined();
    expect(probeInit.headers).toBeUndefined();
    expect(probeUrl).not.toContain('single-use-secret');
    expect(probeUrl).not.toContain('secret-verifier');
  });

  it('distinguishes a failed native health probe from a failed token POST without replaying the code', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('native network error'));
    const api = new CloudAuthApi(
      'https://cloud-auth.tomzlab.cn',
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      api.exchangeAuthorizationCode({
        code: 'single-use-secret',
        codeVerifier: 'secret-verifier',
        installationId,
      }),
    ).rejects.toMatchObject({
      kind: 'network',
      code: 'MOB081_FETCH_HEALTH_NETWORK',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://cloud-auth.tomzlab.cn/health',
    );
  });

  it('attaches a bounded Android OkHttp exception chain without replaying OAuth code', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('sensitive code_verifier=abc'));
    const diagnostic = jest.fn().mockResolvedValue(
      'Android OkHttp: NETWORK SSLHandshakeException>SocketException (CONNECTION_RESET)',
    );
    const api = new CloudAuthApi(
      'https://cloud-auth.tomzlab.cn',
      fetchMock as unknown as typeof fetch,
      diagnostic,
    );
    await expect(api.exchangeAuthorizationCode({
      code: 'one-use-code', codeVerifier: 'secret-verifier', installationId,
    })).rejects.toMatchObject({
      kind: 'network',
      code: 'MOB081_FETCH_HEALTH_NETWORK',
      detail: 'Android OkHttp: NETWORK SSLHandshakeException>SocketException (CONNECTION_RESET)',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(diagnostic).toHaveBeenCalledTimes(1);
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

  it('times out a Cloud request stalled before response headers', async () => {
    jest.useFakeTimers();
    try {
      const fetchMock = jest.fn((_url: string, _init: RequestInit) =>
        new Promise<Response>(() => {}),
      );
      const api = new CloudAuthApi(
        'https://test.cloud-auth.tomzlab.cn',
        fetchMock as unknown as typeof fetch,
      );
      const pending = api.getSession(issued.sessionToken);
      const assertion = expect(pending).rejects.toMatchObject({
        kind: 'network',
      });

      jest.advanceTimersByTime(15_000);
      await assertion;
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.signal?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('also times out if JSON response-body reading never completes', async () => {
    jest.useFakeTimers();
    try {
      const body = jest.fn(() => new Promise<unknown>(() => {}));
      const fetchMock = jest.fn(async () =>
        ({ ok: true, status: 200, json: body }) as unknown as Response,
      );
      const api = new CloudAuthApi(
        'https://test.cloud-auth.tomzlab.cn',
        fetchMock as unknown as typeof fetch,
      );
      const pending = api.getSession(issued.sessionToken);
      const assertion = expect(pending).rejects.toMatchObject({
        kind: 'network',
      });

      await Promise.resolve();
      await Promise.resolve();
      expect(body).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(15_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
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

  it('renews a bound Cloud Session by POST and validates the rotated token payload', async () => {
    const rotated = { ...issued, sessionToken: 'mcs_v1.new-id.new-secret' };
    const fetchMock = jest.fn(async () => jsonResponse(200, rotated));
    const api = new CloudAuthApi(
      'https://test.cloud-auth.tomzlab.cn',
      fetchMock as unknown as typeof fetch,
    );
    await expect(api.renewSession(issued.sessionToken)).resolves.toEqual(rotated);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://test.cloud-auth.tomzlab.cn/v1/auth/session/renew');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer ' + issued.sessionToken,
    });
    expect(init.body).toBeUndefined();
  });

  it.each([
    [401, 'rejected'],
    [429, 'unavailable'],
    [503, 'unavailable'],
  ] as const)('classifies renewal HTTP %s as %s', async (status, kind) => {
    const fetchMock = jest.fn(async () =>
      jsonResponse(status, { error: { code: 'AUTH_REAUTH_REQUIRED' } }),
    );
    const api = new CloudAuthApi(
      'https://test.cloud-auth.tomzlab.cn',
      fetchMock as unknown as typeof fetch,
    );
    await expect(api.renewSession(issued.sessionToken)).rejects.toMatchObject({
      kind,
    });
  });

  it('never treats an incomplete renewed credential as a valid Session', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse(200, { account: issued.account, expiresAt: issued.expiresAt }),
    );
    const api = new CloudAuthApi(
      'https://test.cloud-auth.tomzlab.cn',
      fetchMock as unknown as typeof fetch,
    );
    await expect(api.renewSession(issued.sessionToken)).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});

const device = {
  id: '9f4f1c9a-8bd9-4f36-b6b8-9f7b0e5f8a11',
  platform: 'mobile',
  clientName: 'Mira Mobile',
  clientVersion: '0.3.17',
  createdAt: '2026-10-20T08:00:00.000Z',
  lastSeenAt: '2026-10-25T09:00:00.000Z',
  revokedAt: null,
};

describe('Mira Cloud device API contract', () => {
  it('lists account devices with the stored bearer and validates every summary field', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse(200, { devices: [device, { ...device, id: 'other-device' }] }),
    );
    const api = new CloudAuthApi(
      'https://test.cloud-auth.tomzlab.cn',
      fetchMock as unknown as typeof fetch,
    );

    await expect(api.listDevices(issued.sessionToken)).resolves.toEqual([
      device,
      { ...device, id: 'other-device' },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://test.cloud-auth.tomzlab.cn/v1/devices');
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer ' + issued.sessionToken,
    });
  });

  it.each([
    ['missing devices', {}],
    ['non-array devices', { devices: {} }],
    ['missing revoked state', { devices: [{ ...device, revokedAt: undefined }] }],
    ['invalid platform', { devices: [{ ...device, platform: 'server' }] }],
    ['invalid timestamp', { devices: [{ ...device, lastSeenAt: 'not-a-time' }] }],
    ['blank client name', { devices: [{ ...device, clientName: '   ' }] }],
  ])('rejects an invalid device list: %s', async (_name, body) => {
    const api = new CloudAuthApi(
      'https://test.cloud-auth.tomzlab.cn',
      (async () => jsonResponse(200, body)) as unknown as typeof fetch,
    );

    await expect(api.listDevices(issued.sessionToken)).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('accepts nullable optional device labels without inventing values', () => {
    expect(
      parseMiraDevice({
        ...device,
        clientName: null,
        clientVersion: null,
      }),
    ).toEqual({ ...device, clientName: null, clientVersion: null });
  });

  it('revokes exactly the requested device and requires the server-confirmed revoked device', async () => {
    const revoked = {
      ...device,
      revokedAt: '2026-10-25T10:00:00.000Z',
    };
    const fetchMock = jest.fn(async () => jsonResponse(200, revoked));
    const api = new CloudAuthApi(
      'https://test.cloud-auth.tomzlab.cn',
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      api.revokeDevice(issued.sessionToken, device.id),
    ).resolves.toEqual(revoked);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      `https://test.cloud-auth.tomzlab.cn/v1/devices/${device.id}`,
    );
    expect(init.method).toBe('DELETE');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer ' + issued.sessionToken,
    });
  });

  it.each([
    ['an unrevoked device', { ...device }],
    ['a different device', { ...device, id: 'other-device', revokedAt: '2026-10-25T10:00:00.000Z' }],
    ['a malformed timestamp', { ...device, revokedAt: 'not-a-time' }],
  ])('never reports success for %s', async (_name, body) => {
    const api = new CloudAuthApi(
      'https://test.cloud-auth.tomzlab.cn',
      (async () => jsonResponse(200, body)) as unknown as typeof fetch,
    );

    await expect(
      api.revokeDevice(issued.sessionToken, device.id),
    ).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('classifies a missing or cross-account device as not found, not success', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse(404, {
        error: { code: 'DEVICE_NOT_FOUND', message: 'Mira Device not found' },
      }),
    );
    const api = new CloudAuthApi(
      'https://test.cloud-auth.tomzlab.cn',
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      api.revokeDevice(issued.sessionToken, device.id),
    ).rejects.toMatchObject({
      kind: 'not_found',
      code: 'DEVICE_NOT_FOUND',
    });
  });

  it('classifies a device-list 401 as rejection and a 503 as unavailable', async () => {
    const rejectedApi = new CloudAuthApi(
      'https://test.cloud-auth.tomzlab.cn',
      (async () =>
        jsonResponse(401, {
          error: { code: 'AUTH_REAUTH_REQUIRED' },
        })) as unknown as typeof fetch,
    );
    await expect(
      rejectedApi.listDevices(issued.sessionToken),
    ).rejects.toMatchObject({ kind: 'rejected' });

    const unavailableApi = new CloudAuthApi(
      'https://test.cloud-auth.tomzlab.cn',
      (async () =>
        jsonResponse(503, {
          error: { code: 'DEVICE_INTERNAL_ERROR' },
        })) as unknown as typeof fetch,
    );
    await expect(
      unavailableApi.listDevices(issued.sessionToken),
    ).rejects.toMatchObject({ kind: 'unavailable' });
  });
});
