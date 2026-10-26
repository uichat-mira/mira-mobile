import { cloudAuthService, CloudAuthServiceError } from './cloudAuthService';
import { useCloudAccountStore } from './cloudAccountStore';

jest.mock('./cloudAuthService', () => ({
  CloudAuthServiceError: class CloudAuthServiceError extends Error {
    constructor(
      readonly kind: string,
      message: string,
    ) {
      super(message);
    }
  },
  cloudAuthService: {
    restoreSession: jest.fn(),
    beginSignIn: jest.fn(),
    cancelPendingSignIn: jest.fn(),
    completeSignIn: jest.fn(),
    logout: jest.fn(),
  },
}));

const account = { id: 'account-1', username: 'alice' };
const expiresAt = '2026-11-25T11:00:00.000Z';

const setState = (
  overrides: Partial<ReturnType<typeof useCloudAccountStore.getState>> = {},
) => {
  useCloudAccountStore.setState({
    status: 'signed_in',
    account,
    expiresAt,
    message: null,
    busy: false,
    initialized: true,
    ...overrides,
  });
};

describe('Cloud Account reauthentication and renewal UI state', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    setState();
  });

  it('does not sign out an existing account when opening the browser fails', async () => {
    (cloudAuthService.beginSignIn as jest.Mock).mockRejectedValueOnce(
      new CloudAuthServiceError('browser', 'Browser unavailable'),
    );
    await useCloudAccountStore.getState().signIn();
    expect(useCloudAccountStore.getState()).toMatchObject({
      status: 'signed_in',
      account,
      expiresAt,
      message: 'Browser unavailable',
      busy: false,
    });
  });

  it('restores a previously signed-in session after cancelling re-login', async () => {
    setState({ status: 'authorizing' });
    (cloudAuthService.cancelPendingSignIn as jest.Mock).mockResolvedValueOnce(
      undefined,
    );
    (cloudAuthService.restoreSession as jest.Mock).mockResolvedValueOnce({
      status: 'signed_in',
      account,
      expiresAt,
    });
    await useCloudAccountStore.getState().cancelSignIn();
    expect(useCloudAccountStore.getState()).toMatchObject({
      status: 'signed_in',
      account,
      message: '已取消 Mira Cloud 登录。',
      busy: false,
    });
  });

  it('retains the offline account after cancelling re-login', async () => {
    setState({ status: 'authorizing' });
    (cloudAuthService.cancelPendingSignIn as jest.Mock).mockResolvedValueOnce(
      undefined,
    );
    (cloudAuthService.restoreSession as jest.Mock).mockResolvedValueOnce({
      status: 'cloud_unavailable',
      account,
      expiresAt,
    });
    await useCloudAccountStore.getState().cancelSignIn();
    expect(useCloudAccountStore.getState()).toMatchObject({
      status: 'cloud_unavailable',
      account,
      expiresAt,
      busy: false,
    });
  });

  it('leaves cancel retry possible if pending OAuth state cannot be cleared', async () => {
    setState({ status: 'authorizing' });
    (cloudAuthService.cancelPendingSignIn as jest.Mock).mockRejectedValueOnce(
      new CloudAuthServiceError('storage', 'Secure store unavailable'),
    );
    await useCloudAccountStore.getState().cancelSignIn();
    expect(useCloudAccountStore.getState()).toMatchObject({
      status: 'authorizing',
      account,
      busy: false,
    });
  });

  it('restores a saved account when an authorizing callback is invalid', async () => {
    setState({ status: 'authorizing' });
    (cloudAuthService.completeSignIn as jest.Mock).mockRejectedValueOnce(
      new CloudAuthServiceError('invalid_state', 'Invalid OAuth state'),
    );
    (cloudAuthService.restoreSession as jest.Mock).mockResolvedValueOnce({
      status: 'signed_in',
      account,
      expiresAt,
    });
    await expect(
      useCloudAccountStore.getState().completeSignIn({ state: 'invalid' }),
    ).resolves.toBe('signed_in');
    expect(useCloudAccountStore.getState()).toMatchObject({
      account,
      message: 'Invalid OAuth state',
      busy: false,
    });
  });

  it('shows the callback error normally when no previous Cloud account exists', async () => {
    setState({ status: 'authorizing', account: null, expiresAt: null });
    (cloudAuthService.completeSignIn as jest.Mock).mockRejectedValueOnce(
      new CloudAuthServiceError('invalid_state', 'Invalid OAuth state'),
    );
    await expect(
      useCloudAccountStore.getState().completeSignIn({ state: 'invalid' }),
    ).resolves.toBe('signed_out');
    expect(useCloudAccountStore.getState()).toMatchObject({
      status: 'signed_out',
      account: null,
      message: 'Invalid OAuth state',
    });
  });

  it('shows the explicit reauthentication message after a rotated token could not be saved', async () => {
    (cloudAuthService.restoreSession as jest.Mock).mockResolvedValueOnce({
      status: 'session_rejected',
      message: '无法保存已续期的 Mira Cloud 登录状态，请重新登录。',
    });
    await useCloudAccountStore.getState().refresh();
    expect(useCloudAccountStore.getState()).toMatchObject({
      status: 'session_rejected',
      account: null,
      message: '无法保存已续期的 Mira Cloud 登录状态，请重新登录。',
    });
  });
});
