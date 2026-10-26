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
});
