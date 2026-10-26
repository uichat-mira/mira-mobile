import { Linking } from 'react-native';
import {
  CloudAuthApi,
  CloudAuthRequestError,
  type CloudAccountIdentity,
  type CloudAuthApiLike,
  type IssuedCloudSession,
} from './cloudAuthApi';
import {
  buildCloudAuthorizationUrl,
  resolveCloudAuthBaseUrl,
} from './cloudAuthConfig';
import {
  MiraCloudInstallationIdentity,
  type CloudInstallationIdentity,
} from './cloudInstallationIdentity';
import {
  NativeCloudOAuthPendingStore,
  type CloudOAuthPendingStore,
} from './cloudOAuthPendingStore';
import {
  CloudSessionStoreError,
  cloudSessionStore,
  type CloudSessionStore,
  type StoredCloudSession,
} from './cloudSessionStore';
import {
  codeChallengeForVerifier,
  createOAuthState,
  createPkcePair,
  isValidAuthorizationCode,
  isValidCodeVerifier,
  isValidOAuthState,
} from './pkce';
import { requireNativeSecureRandom } from './secureStorage';

export interface OAuthCallbackParams {
  code?: string;
  state?: string;
  error?: string;
}

export type CloudAuthSessionState =
  | { status: 'signed_out' }
  | {
      status: 'signed_in';
      account: CloudAccountIdentity;
      expiresAt: string;
    }
  | {
      status: 'cloud_unavailable';
      account: CloudAccountIdentity | null;
      expiresAt: string | null;
    }
  | { status: 'session_rejected'; message?: string };

const OAUTH_CALLBACK_ERRORS = new Set([
  'invalid_request',
  'unauthorized_client',
  'unsupported_response_type',
  'access_denied',
  'server_error',
]);

export type CloudAuthServiceErrorKind =
  | 'network'
  | 'unavailable'
  | 'rejected'
  | 'invalid_response'
  | 'invalid_state'
  | 'cancelled'
  | 'storage'
  | 'browser';

export class CloudAuthServiceError extends Error {
  constructor(
    readonly kind: CloudAuthServiceErrorKind,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'CloudAuthServiceError';
  }
}

export interface CloudLogoutResult {
  remote: 'revoked' | 'already_revoked' | 'already_signed_out' | 'failed';
  cleared: boolean;
  message: string | null;
}

interface CloudAuthServiceOptions {
  sessionStore?: CloudSessionStore;
  installationIdentity?: CloudInstallationIdentity;
  pendingStore?: CloudOAuthPendingStore;
  api?: CloudAuthApiLike;
  openBrowser?: (url: string) => Promise<void>;
  now?: () => Date;
  randomBytes?: (length: number) => Promise<string>;
  baseUrl?: string;
}

const requestError = (error: unknown): CloudAuthServiceError => {
  if (error instanceof CloudAuthRequestError) {
    switch (error.kind) {
      case 'network':
        return new CloudAuthServiceError(
          'network',
          '无法连接 Mira Cloud，请检查网络后重试。',
          error.code,
        );
      case 'unavailable':
        return new CloudAuthServiceError(
          'unavailable',
          'Mira Cloud 暂时不可用，请稍后重试。',
          error.code,
        );
      case 'rejected':
        return new CloudAuthServiceError(
          'rejected',
          'Mira Cloud 未接受本次登录，请重新登录。',
          error.code,
        );
      default:
        return new CloudAuthServiceError(
          'invalid_response',
          'Mira Cloud 返回了无法识别的响应，请稍后重试。',
          error.code,
        );
    }
  }
  return new CloudAuthServiceError(
    'unavailable',
    'Mira Cloud 暂时不可用，请稍后重试。',
  );
};

const storageError = (): CloudAuthServiceError =>
  new CloudAuthServiceError('storage', '无法访问设备安全存储，请稍后重试。');

const clearSessionQuietly = async (
  store: CloudSessionStore,
): Promise<boolean> => {
  try {
    await store.clear();
    return true;
  } catch {
    return false;
  }
};

const shouldRenewSession = (
  stored: StoredCloudSession,
  serverExpiresAt: string,
  now: number,
): boolean => {
  const expiry = Date.parse(serverExpiresAt);
  const lifetime = expiry - Date.parse(stored.savedAt);
  if (!Number.isFinite(lifetime) || lifetime <= 0) return false;
  // Relative to the actual session lifetime, capped at 24 hours. Avoid
  // rotating on each account-screen focus, especially with short server TTLs.
  const windowMs = Math.min(24 * 60 * 60 * 1000, lifetime / 10);
  return expiry - now <= windowMs;
};

const clearPendingQuietly = async (
  store: CloudOAuthPendingStore,
): Promise<void> => {
  try {
    await store.clear();
  } catch {
    // Pending OAuth state can be overwritten by the next sign-in attempt.
  }
};

export class MiraCloudAuthService {
  private readonly store: CloudSessionStore;
  private readonly installationIdentity: CloudInstallationIdentity;
  private readonly pendingStore: CloudOAuthPendingStore;
  private readonly api: CloudAuthApiLike;
  private readonly openBrowser: (url: string) => Promise<void>;
  private readonly now: () => Date;
  private readonly randomBytes: (length: number) => Promise<string>;
  private readonly baseUrl: string;
  private pendingRestore: Promise<CloudAuthSessionState> | null = null;
  private pendingExchange: Promise<CloudAuthSessionState> | null = null;
  private sessionQueue: Promise<void> = Promise.resolve();

  // Token rotation, restore, code exchange and logout must never write or
  // clear the same secure record out of order.
  private serializeSession<T>(operation: () => Promise<T>): Promise<T> {
    const scheduled = this.sessionQueue.then(operation, operation);
    this.sessionQueue = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  }

  constructor(options: CloudAuthServiceOptions = {}) {
    this.store = options.sessionStore ?? cloudSessionStore;
    this.installationIdentity =
      options.installationIdentity ?? new MiraCloudInstallationIdentity();
    this.pendingStore =
      options.pendingStore ?? new NativeCloudOAuthPendingStore();
    this.baseUrl = options.baseUrl ?? resolveCloudAuthBaseUrl();
    this.api = options.api ?? new CloudAuthApi(this.baseUrl);
    this.openBrowser =
      options.openBrowser ??
      (async (url: string) => {
        await Linking.openURL(url);
      });
    this.now = options.now ?? (() => new Date());
    this.randomBytes =
      options.randomBytes ??
      ((length: number) => requireNativeSecureRandom().randomBytes(length));
  }

  restoreSession(): Promise<CloudAuthSessionState> {
    // Keep restores and OAuth callback completion from racing over one token.
    if (this.pendingExchange) {
      // A failed/invalid callback does not invalidate a saved Cloud Session.
      // Wait for exchange to finish before reading the authoritative record.
      return this.pendingExchange.catch(() =>
        this.serializeSession(() => this.restoreSessionOnce()),
      );
    }
    if (this.pendingRestore) return this.pendingRestore;

    const operation = this.serializeSession(() => this.restoreSessionOnce());
    this.pendingRestore = operation;
    const release = () => {
      if (this.pendingRestore === operation) this.pendingRestore = null;
    };
    operation.then(release, release);
    return operation;
  }

  private async restoreSessionOnce(): Promise<CloudAuthSessionState> {
    let stored: StoredCloudSession | null;
    try {
      stored = await this.store.load();
    } catch (error) {
      if (
        error instanceof CloudSessionStoreError &&
        error.reason === 'corrupt'
      ) {
        await clearSessionQuietly(this.store);
        return { status: 'session_rejected' };
      }
      return {
        status: 'cloud_unavailable',
        account: null,
        expiresAt: null,
      };
    }

    if (!stored) return { status: 'signed_out' };

    if (Date.parse(stored.expiresAt) <= this.now().getTime()) {
      await clearSessionQuietly(this.store);
      return { status: 'session_rejected' };
    }

    try {
      const session = await this.api.getSession(stored.sessionToken);
      if (session.account.id !== stored.account.id) {
        await clearSessionQuietly(this.store);
        return { status: 'session_rejected' };
      }

      if (shouldRenewSession(stored, session.expiresAt, this.now().getTime())) {
        let renewed: IssuedCloudSession;
        try {
          renewed = await this.api.renewSession(stored.sessionToken);
        } catch (error) {
          if (error instanceof CloudAuthRequestError && error.kind === 'rejected') {
            await clearSessionQuietly(this.store);
            return { status: 'session_rejected' };
          }
          // A timeout may have happened after the server rotated the secret.
          // Keep the old record for later validation, but don't claim renewed
          // authority or blindly retry the non-idempotent renewal.
          return {
            status: 'cloud_unavailable',
            account: stored.account,
            expiresAt: stored.expiresAt,
          };
        }

        if (renewed.account.id !== stored.account.id) {
          await clearSessionQuietly(this.store);
          return { status: 'session_rejected' };
        }
        try {
          await this.store.save({
            schemaVersion: 1,
            sessionToken: renewed.sessionToken,
            account: renewed.account,
            expiresAt: renewed.expiresAt,
            savedAt: this.now().toISOString(),
          });
        } catch {
          // Server rotation already invalidated the old token. No cross-device
          // atomic commit exists: fail closed and ask for reauthentication.
          await clearSessionQuietly(this.store);
          return {
            status: 'session_rejected',
            message: '无法保存已续期的 Mira Cloud 登录状态，请重新登录。',
          };
        }
        return {
          status: 'signed_in',
          account: renewed.account,
          expiresAt: renewed.expiresAt,
        };
      }

      return {
        status: 'signed_in',
        account: session.account,
        expiresAt: session.expiresAt,
      };
    } catch (error) {
      if (error instanceof CloudAuthRequestError && error.kind === 'rejected') {
        await clearSessionQuietly(this.store);
        return { status: 'session_rejected' };
      }
      return {
        status: 'cloud_unavailable',
        account: stored.account,
        expiresAt: stored.expiresAt,
      };
    }
  }

  async beginSignIn(): Promise<void> {
    let verifier: string;
    let state: string;
    try {
      const pair = await createPkcePair(this.randomBytes);
      verifier = pair.verifier;
      state = await createOAuthState(this.randomBytes);
      await this.installationIdentity.getOrCreate();
    } catch {
      throw storageError();
    }

    try {
      await this.pendingStore.save({
        schemaVersion: 1,
        state,
        codeVerifier: verifier,
        createdAt: this.now().toISOString(),
      });
    } catch {
      throw storageError();
    }

    let authorizationUrl: string;
    try {
      authorizationUrl = buildCloudAuthorizationUrl(this.baseUrl, {
        state,
        codeChallenge: codeChallengeForVerifier(verifier),
      });
    } catch {
      await clearPendingQuietly(this.pendingStore);
      throw new CloudAuthServiceError(
        'invalid_state',
        '无法生成 Mira Cloud 登录请求，请重试。',
      );
    }

    // The installation identity is created before the browser opens so a
    // successful callback always has a stable device binding to exchange with.
    try {
      await this.openBrowser(authorizationUrl);
    } catch {
      await clearPendingQuietly(this.pendingStore);
      throw new CloudAuthServiceError(
        'browser',
        '无法打开系统浏览器，请稍后重试。',
      );
    }
  }

  completeSignIn(params: OAuthCallbackParams): Promise<CloudAuthSessionState> {
    if (this.pendingExchange) return this.pendingExchange;

    const operation = this.serializeSession(() => this.completeSignInOnce(params));
    this.pendingExchange = operation;
    const release = () => {
      if (this.pendingExchange === operation) this.pendingExchange = null;
    };
    operation.then(release, release);
    return operation;
  }

  private async completeSignInOnce(
    params: OAuthCallbackParams,
  ): Promise<CloudAuthSessionState> {
    let pending;
    try {
      pending = await this.pendingStore.load();
    } catch {
      throw new CloudAuthServiceError(
        'invalid_state',
        '登录回调校验失败，请重新发起登录。',
      );
    }

    if (!pending) {
      throw new CloudAuthServiceError(
        'invalid_state',
        '登录回调校验失败，请重新发起登录。',
      );
    }

    const callbackState =
      typeof params.state === 'string' && isValidOAuthState(params.state)
        ? params.state
        : null;
    if (!callbackState || callbackState !== pending.state) {
      throw new CloudAuthServiceError(
        'invalid_state',
        '登录回调校验失败，请重新发起登录。',
      );
    }

    if (params.error !== undefined) {
      if (!OAUTH_CALLBACK_ERRORS.has(params.error)) {
        throw new CloudAuthServiceError(
          'invalid_state',
          '登录回调校验失败，请重新发起登录。',
        );
      }
      await clearPendingQuietly(this.pendingStore);
      if (params.error === 'access_denied') {
        throw new CloudAuthServiceError(
          'cancelled',
          '已取消 Mira Cloud 登录。',
        );
      }
      throw new CloudAuthServiceError(
        'rejected',
        'Mira Cloud 登录未完成，请重新尝试。',
      );
    }

    if (
      typeof params.code !== 'string' ||
      !isValidAuthorizationCode(params.code) ||
      !isValidCodeVerifier(pending.codeVerifier)
    ) {
      await clearPendingQuietly(this.pendingStore);
      throw new CloudAuthServiceError(
        'invalid_state',
        '登录回调校验失败，请重新发起登录。',
      );
    }

    await clearPendingQuietly(this.pendingStore);

    let installationId: string;
    try {
      installationId = await this.installationIdentity.getOrCreate();
    } catch {
      throw storageError();
    }

    let session: IssuedCloudSession;
    try {
      session = await this.api.exchangeAuthorizationCode({
        code: params.code,
        codeVerifier: pending.codeVerifier,
        installationId,
      });
    } catch (error) {
      throw requestError(error);
    }

    const stored: StoredCloudSession = {
      schemaVersion: 1,
      sessionToken: session.sessionToken,
      account: session.account,
      expiresAt: session.expiresAt,
      savedAt: this.now().toISOString(),
    };
    try {
      await this.store.save(stored);
    } catch {
      throw storageError();
    }

    return {
      status: 'signed_in',
      account: session.account,
      expiresAt: session.expiresAt,
    };
  }

  logout(): Promise<CloudLogoutResult> {
    return this.serializeSession(async () => {
    let stored: StoredCloudSession | null;
    try {
      stored = await this.store.load();
    } catch {
      return {
        remote: 'failed',
        cleared: false,
        message: '无法读取设备安全存储，退出登录未完成。',
      };
    }

    if (!stored) {
      return {
        remote: 'already_signed_out',
        cleared: true,
        message: null,
      };
    }

    try {
      await this.api.logout(stored.sessionToken);
      const cleared = await clearSessionQuietly(this.store);
      return cleared
        ? { remote: 'revoked', cleared: true, message: null }
        : {
            remote: 'revoked',
            cleared: false,
            message: 'Mira Cloud 已注销，但无法清除本机安全存储，请重试。',
          };
    } catch (error) {
      if (error instanceof CloudAuthRequestError && error.kind === 'rejected') {
        const cleared = await clearSessionQuietly(this.store);
        return cleared
          ? { remote: 'already_revoked', cleared: true, message: null }
          : {
              remote: 'already_revoked',
              cleared: false,
              message: '登录已失效，但无法清除本机安全存储，请重试。',
            };
      }

      return {
        remote: 'failed',
        cleared: false,
        message:
          '无法连接 Mira Cloud，退出登录未完成；本机保存的登录状态仍然保留。',
      };
    }
    });
  }

  async cancelPendingSignIn(): Promise<void> {
    try {
      await this.pendingStore.clear();
    } catch {
      throw storageError();
    }
  }
}

export const cloudAuthService = new MiraCloudAuthService();
