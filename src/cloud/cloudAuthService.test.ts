import {
  CloudAuthRequestError,
  type CloudAuthApiLike,
  type IssuedCloudSession,
  type OAuthCodeExchangeRequest,
} from './cloudAuthApi';
import { MiraCloudAuthService } from './cloudAuthService';
import {
  MiraCloudInstallationIdentity,
  MemoryCloudInstallationStore,
} from './cloudInstallationIdentity';
import { MemoryCloudOAuthPendingStore } from './cloudOAuthPendingStore';
import {
  MemoryCloudSessionStore,
  type StoredCloudSession,
} from './cloudSessionStore';
import { bytesToBase64Url, codeChallengeForVerifier } from './pkce';
import type { SecureRandomModule } from './secureStorage';

const fixedNow = () => new Date('2026-10-25T11:00:00.000Z');

const issued: IssuedCloudSession = {
  sessionToken: 'mcs_v1.session-id.session-secret',
  account: { id: 'account-1', username: 'alice' },
  expiresAt: '2026-11-25T11:00:00.000Z',
};

const code = `mca_v1.${'a'.repeat(22)}.${'b'.repeat(43)}`;

const makeRandom = () => {
  let counter = 1;
  const randomBytes = async (length: number) => {
    const bytes = Uint8Array.from(
      { length },
      (_, index) => (counter + index) & 0xff,
    );
    counter += length;
    return bytesToBase64Url(bytes);
  };
  const module: SecureRandomModule = {
    get: async () => null,
    set: async () => undefined,
    remove: async () => undefined,
    randomBytes,
  };
  return { randomBytes, module };
};

const createHarness = () => {
  const sessionStore = new MemoryCloudSessionStore();
  const installationStore = new MemoryCloudInstallationStore();
  const pendingStore = new MemoryCloudOAuthPendingStore();
  const opened: string[] = [];
  const random = makeRandom();
  const installationIdentity = new MiraCloudInstallationIdentity(
    installationStore,
    random.module,
    fixedNow,
  );
  const api: CloudAuthApiLike = {
    exchangeAuthorizationCode: jest.fn(),
    getSession: jest.fn(),
    renewSession: jest.fn(),
    logout: jest.fn(),
  };
  const service = new MiraCloudAuthService({
    sessionStore,
    installationIdentity,
    pendingStore,
    api,
    openBrowser: async url => {
      opened.push(url);
    },
    now: fixedNow,
    randomBytes: random.randomBytes,
    baseUrl: 'https://test.cloud-auth.tomzlab.cn',
  });
  return {
    service,
    sessionStore,
    installationStore,
    pendingStore,
    opened,
    api,
  };
};

const storedSession = (
  overrides: Partial<StoredCloudSession> = {},
): StoredCloudSession => ({
  schemaVersion: 1,
  sessionToken: issued.sessionToken,
  account: issued.account,
  expiresAt: issued.expiresAt,
  savedAt: '2026-10-25T11:00:00.000Z',
  ...overrides,
});

describe('Mira Cloud OAuth service', () => {
  it('opens the exact system-browser authorization request and stores only pending PKCE state', async () => {
    const harness = createHarness();
    await harness.service.beginSignIn();

    expect(harness.opened).toHaveLength(1);
    const url = new URL(harness.opened[0] ?? '');
    expect(url.origin).toBe('https://test.cloud-auth.tomzlab.cn');
    expect(url.pathname).toBe('/v1/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('mira-mobile');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'mira-mobile://oauth/callback',
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('response_type')).toBe('code');

    const pending = harness.pendingStore.peek();
    expect(pending).not.toBeNull();
    expect(url.searchParams.get('state')).toBe(pending?.state);
    expect(url.searchParams.get('code_challenge')).toBe(
      codeChallengeForVerifier(pending?.codeVerifier ?? ''),
    );
    expect(JSON.stringify(pending)).not.toContain('sessionToken');
    expect(JSON.stringify(pending)).not.toContain('password');

    const installation = harness.installationStore.peek();
    expect(installation?.installationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it('exchanges the callback exactly once and persists the issued Cloud Session', async () => {
    const harness = createHarness();
    await harness.service.beginSignIn();
    const pending = harness.pendingStore.peek();
    if (!pending) throw new Error('Expected pending OAuth transaction');
    const installation = harness.installationStore.peek();
    if (!installation) throw new Error('Expected installation identity');
    (harness.api.exchangeAuthorizationCode as jest.Mock).mockResolvedValue(
      issued,
    );

    const state = await harness.service.completeSignIn({
      code,
      state: pending?.state,
    });

    expect(state).toEqual({
      status: 'signed_in',
      account: issued.account,
      expiresAt: issued.expiresAt,
    });
    expect(harness.api.exchangeAuthorizationCode).toHaveBeenCalledWith({
      code,
      codeVerifier: pending.codeVerifier,
      installationId: installation.installationId,
    } satisfies OAuthCodeExchangeRequest);
    expect(harness.sessionStore.peek()).toMatchObject({
      sessionToken: issued.sessionToken,
      account: issued.account,
      expiresAt: issued.expiresAt,
    });
    expect(harness.pendingStore.peek()).toBeNull();
  });

  it('rejects a mismatched state before redeeming the code', async () => {
    const harness = createHarness();
    await harness.service.beginSignIn();

    await expect(
      harness.service.completeSignIn({
        code,
        state: 'state-0123456789-abcdef',
      }),
    ).rejects.toMatchObject({ kind: 'invalid_state' });
    expect(harness.api.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(harness.pendingStore.peek()).not.toBeNull();
  });

  it('treats a browser cancellation as a safe non-authorizing outcome', async () => {
    const harness = createHarness();
    await harness.service.beginSignIn();
    const pending = harness.pendingStore.peek();

    await expect(
      harness.service.completeSignIn({
        state: pending?.state,
        error: 'access_denied',
      }),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    expect(harness.api.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(harness.pendingStore.peek()).toBeNull();
    expect(harness.sessionStore.peek()).toBeNull();
  });

  it('restores a valid session on a normal cold start without another browser login', async () => {
    const harness = createHarness();
    await harness.sessionStore.save(storedSession());
    (harness.api.getSession as jest.Mock).mockResolvedValue({
      account: issued.account,
      expiresAt: issued.expiresAt,
    });

    await expect(harness.service.restoreSession()).resolves.toEqual({
      status: 'signed_in',
      account: issued.account,
      expiresAt: issued.expiresAt,
    });
    expect(harness.opened).toHaveLength(0);
    expect(harness.api.getSession).toHaveBeenCalledWith(issued.sessionToken);
  });

  it('preserves a newly exchanged session after the old cold-start restore rejects', async () => {
    const harness = createHarness();
    const oldToken = 'mcs_v1.old-id.old-secret';
    await harness.sessionStore.save(storedSession({ sessionToken: oldToken }));
    await harness.service.beginSignIn();
    const pending = harness.pendingStore.peek();
    if (!pending) throw new Error('Expected pending OAuth transaction');

    let rejectOld!: (error: unknown) => void;
    (harness.api.getSession as jest.Mock).mockImplementation(
      () => new Promise((_resolve, reject) => { rejectOld = reject; }),
    );
    (harness.api.exchangeAuthorizationCode as jest.Mock).mockResolvedValue(
      issued,
    );

    const restoring = harness.service.restoreSession();
    const signingIn = harness.service.completeSignIn({
      code,
      state: pending.state,
    });

    // MemoryCloudSessionStore.load() resolves on a microtask, not synchronously.
    await Promise.resolve();
    expect(harness.api.getSession).toHaveBeenCalledWith(oldToken);
    expect(harness.api.exchangeAuthorizationCode).not.toHaveBeenCalled();
    rejectOld(new CloudAuthRequestError('rejected', 'Old session revoked'));

    await expect(restoring).resolves.toEqual({ status: 'session_rejected' });
    await expect(signingIn).resolves.toMatchObject({
      status: 'signed_in',
      account: issued.account,
    });
    expect(harness.sessionStore.peek()?.sessionToken).toBe(issued.sessionToken);
  });

  it('makes a restore started during code exchange observe the new session', async () => {
    const harness = createHarness();
    await harness.service.beginSignIn();
    const pending = harness.pendingStore.peek();
    if (!pending) throw new Error('Expected pending OAuth transaction');
    (harness.api.exchangeAuthorizationCode as jest.Mock).mockResolvedValue(issued);

    const signingIn = harness.service.completeSignIn({
      code,
      state: pending.state,
    });
    const restoring = harness.service.restoreSession();

    await expect(signingIn).resolves.toMatchObject({ status: 'signed_in' });
    await expect(restoring).resolves.toMatchObject({ status: 'signed_in' });
    expect(harness.api.getSession).not.toHaveBeenCalled();
    expect(harness.sessionStore.peek()?.sessionToken).toBe(issued.sessionToken);
  });

  it('clears local authority when the server explicitly rejects the session', async () => {
    const harness = createHarness();
    await harness.sessionStore.save(storedSession());
    (harness.api.getSession as jest.Mock).mockRejectedValue(
      new CloudAuthRequestError(
        'rejected',
        'Mira Cloud session was rejected',
        'AUTH_REAUTH_REQUIRED',
      ),
    );

    await expect(harness.service.restoreSession()).resolves.toEqual({
      status: 'session_rejected',
    });
    expect(harness.sessionStore.peek()).toBeNull();
  });

  it('keeps the saved session during a temporary Cloud outage', async () => {
    const harness = createHarness();
    await harness.sessionStore.save(storedSession());
    (harness.api.getSession as jest.Mock).mockRejectedValue(
      new CloudAuthRequestError('network', 'Mira Cloud is unreachable'),
    );

    await expect(harness.service.restoreSession()).resolves.toEqual({
      status: 'cloud_unavailable',
      account: issued.account,
      expiresAt: issued.expiresAt,
    });
    expect(harness.sessionStore.peek()).not.toBeNull();
  });

  it('requires reauthentication when the stored session is already expired', async () => {
    const harness = createHarness();
    await harness.sessionStore.save(
      storedSession({ expiresAt: '2026-10-24T11:00:00.000Z' }),
    );

    await expect(harness.service.restoreSession()).resolves.toEqual({
      status: 'session_rejected',
    });
    expect(harness.sessionStore.peek()).toBeNull();
    expect(harness.api.getSession).not.toHaveBeenCalled();
  });

  it('does not claim logout when the remote revoke cannot be reached', async () => {
    const harness = createHarness();
    await harness.sessionStore.save(storedSession());
    (harness.api.logout as jest.Mock).mockRejectedValue(
      new CloudAuthRequestError('network', 'Mira Cloud is unreachable'),
    );

    const result = await harness.service.logout();

    expect(result).toMatchObject({ remote: 'failed', cleared: false });
    expect(harness.sessionStore.peek()).not.toBeNull();
  });

  it('clears local Cloud authority after a confirmed remote logout', async () => {
    const harness = createHarness();
    await harness.sessionStore.save(storedSession());
    (harness.api.logout as jest.Mock).mockResolvedValue(undefined);

    const result = await harness.service.logout();

    expect(result).toMatchObject({ remote: 'revoked', cleared: true });
    expect(harness.sessionStore.peek()).toBeNull();
  });

  it('clears local Cloud authority when the server already rejected the token during logout', async () => {
    const harness = createHarness();
    await harness.sessionStore.save(storedSession());
    (harness.api.logout as jest.Mock).mockRejectedValue(
      new CloudAuthRequestError(
        'rejected',
        'Mira Cloud session was rejected',
        'AUTH_REAUTH_REQUIRED',
      ),
    );

    const result = await harness.service.logout();

    expect(result).toMatchObject({
      remote: 'already_revoked',
      cleared: true,
    });
    expect(harness.sessionStore.peek()).toBeNull();
  });

  const nearExpirySession = () =>
    storedSession({
      expiresAt: '2026-10-25T11:05:00.000Z',
      savedAt: '2026-10-25T10:00:00.000Z',
    });

  const readyForRenewal = async (harness: ReturnType<typeof createHarness>) => {
    await harness.sessionStore.save(nearExpirySession());
    (harness.api.getSession as jest.Mock).mockResolvedValue({
      account: issued.account,
      expiresAt: nearExpirySession().expiresAt,
    });
  };

  it('rotates near expiry, persists the new credential before declaring signed in, and restores it after restart', async () => {
    const harness = createHarness();
    const rotated = {
      ...issued,
      sessionToken: 'mcs_v1.new-id.new-secret',
    };
    await readyForRenewal(harness);
    (harness.api.renewSession as jest.Mock).mockResolvedValue(rotated);

    await expect(harness.service.restoreSession()).resolves.toEqual({
      status: 'signed_in',
      account: issued.account,
      expiresAt: rotated.expiresAt,
    });
    expect(harness.api.getSession).toHaveBeenCalledWith(issued.sessionToken);
    expect(harness.api.renewSession).toHaveBeenCalledWith(issued.sessionToken);
    expect(harness.sessionStore.peek()).toMatchObject({
      sessionToken: rotated.sessionToken,
      expiresAt: rotated.expiresAt,
      savedAt: fixedNow().toISOString(),
    });

    (harness.api.getSession as jest.Mock).mockResolvedValue({
      account: issued.account,
      expiresAt: rotated.expiresAt,
    });
    await expect(harness.service.restoreSession()).resolves.toMatchObject({
      status: 'signed_in',
    });
    expect(harness.api.getSession).toHaveBeenLastCalledWith(rotated.sessionToken);
    expect(harness.api.renewSession).toHaveBeenCalledTimes(1);
  });

  it('does not renew an ordinary session far from expiry', async () => {
    const harness = createHarness();
    await harness.sessionStore.save(storedSession());
    (harness.api.getSession as jest.Mock).mockResolvedValue({
      account: issued.account,
      expiresAt: issued.expiresAt,
    });
    await expect(harness.service.restoreSession()).resolves.toMatchObject({
      status: 'signed_in',
    });
    expect(harness.api.renewSession).not.toHaveBeenCalled();
  });

  it('coalesces simultaneous restores and serializes logout after token rotation', async () => {
    const harness = createHarness();
    await readyForRenewal(harness);
    const rotated = { ...issued, sessionToken: 'mcs_v1.rotated.secret' };
    let resolveRenew!: (value: IssuedCloudSession) => void;
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    (harness.api.renewSession as jest.Mock).mockImplementation(
      () => new Promise<IssuedCloudSession>(resolve => {
        resolveRenew = resolve;
        markStarted();
      }),
    );
    (harness.api.logout as jest.Mock).mockResolvedValue(undefined);

    const one = harness.service.restoreSession();
    const two = harness.service.restoreSession();
    await started;
    const loggingOut = harness.service.logout();
    expect(harness.api.logout).not.toHaveBeenCalled();

    resolveRenew(rotated);
    await expect(one).resolves.toMatchObject({ status: 'signed_in' });
    await expect(two).resolves.toMatchObject({ status: 'signed_in' });
    await expect(loggingOut).resolves.toMatchObject({
      remote: 'revoked',
      cleared: true,
    });
    expect(harness.api.renewSession).toHaveBeenCalledTimes(1);
    expect(harness.api.logout).toHaveBeenCalledWith(rotated.sessionToken);
    expect(harness.sessionStore.peek()).toBeNull();
  });

  it('fails closed when the remote token rotated but secure storage refuses the new token', async () => {
    const harness = createHarness();
    await readyForRenewal(harness);
    (harness.api.renewSession as jest.Mock).mockResolvedValue({
      ...issued,
      sessionToken: 'mcs_v1.rotated.secret',
    });
    jest.spyOn(harness.sessionStore, 'save').mockRejectedValueOnce(
      new Error('secure storage write failed'),
    );

    await expect(harness.service.restoreSession()).resolves.toMatchObject({
      status: 'session_rejected',
      message: expect.stringContaining('重新登录'),
    });
    expect(harness.sessionStore.peek()).toBeNull();
  });

  it('keeps a pending-unknown rotation offline until a fresh server check determines rejection', async () => {
    const harness = createHarness();
    await readyForRenewal(harness);
    (harness.api.renewSession as jest.Mock).mockRejectedValueOnce(
      new CloudAuthRequestError('network', 'Mira Cloud request timed out'),
    );

    await expect(harness.service.restoreSession()).resolves.toMatchObject({
      status: 'cloud_unavailable',
    });
    expect(harness.sessionStore.peek()?.sessionToken).toBe(issued.sessionToken);
    expect(harness.api.renewSession).toHaveBeenCalledTimes(1);

    (harness.api.getSession as jest.Mock).mockRejectedValueOnce(
      new CloudAuthRequestError('rejected', 'Old bearer was rotated'),
    );
    await expect(harness.service.restoreSession()).resolves.toEqual({
      status: 'session_rejected',
    });
    expect(harness.sessionStore.peek()).toBeNull();
    expect(harness.api.renewSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['rejected', 'session_rejected', false],
    ['unavailable', 'cloud_unavailable', true],
  ] as const)(
    'classifies renewal %s as %s while preserving only appropriate local records',
    async (kind, status, keep) => {
      const harness = createHarness();
      await readyForRenewal(harness);
      (harness.api.renewSession as jest.Mock).mockRejectedValueOnce(
        new CloudAuthRequestError(kind, 'renew unavailable or rejected'),
      );
      await expect(harness.service.restoreSession()).resolves.toMatchObject({
        status,
      });
      expect(harness.sessionStore.peek() !== null).toBe(keep);
    },
  );
});
