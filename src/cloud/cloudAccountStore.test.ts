import { cloudAuthService, CloudAuthServiceError } from './cloudAuthService';
import { useCloudAccountStore } from './cloudAccountStore';

jest.mock('./cloudAuthService', () => ({
  CloudAuthServiceError: class CloudAuthServiceError extends Error {
    kind: string;

    constructor(kind: string, message: string) {
      super(message);
      this.kind = kind;
    }
  },
  cloudAuthService: {
    restoreSession: jest.fn(),
    beginSignIn: jest.fn(),
    cancelPendingSignIn: jest.fn(),
    completeSignIn: jest.fn(),
    logout: jest.fn(),
    listDevices: jest.fn(),
    revokeDevice: jest.fn(),
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
    devices: [],
    devicesStatus: 'idle',
    devicesMessage: null,
    revokingDeviceId: null,
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

const mobileDevice = {
  id: '9f4f1c9a-8bd9-4f36-b6b8-9b7f0e5f8a11',
  platform: 'mobile' as const,
  clientName: 'Mira Mobile',
  clientVersion: '0.3.17',
  createdAt: '2026-10-20T08:00:00.000Z',
  lastSeenAt: '2026-10-25T09:00:00.000Z',
  revokedAt: null,
};

const desktopDevice = {
  id: '4d6f1c9a-8bd9-4f36-b6b8-9b7f0e5f8a22',
  platform: 'desktop' as const,
  clientName: 'Mira Desktop',
  clientVersion: '1.0.0',
  createdAt: '2026-10-18T08:00:00.000Z',
  lastSeenAt: '2026-10-24T09:00:00.000Z',
  revokedAt: null,
};

describe('Cloud Account device list and revoke state', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    setState();
  });

  it('stores only the server-returned device list', async () => {
    (cloudAuthService.listDevices as jest.Mock).mockResolvedValueOnce({
      status: 'listed',
      devices: [mobileDevice, desktopDevice],
    });

    await useCloudAccountStore.getState().loadDevices();

    expect(useCloudAccountStore.getState()).toMatchObject({
      status: 'signed_in',
      devices: [mobileDevice, desktopDevice],
      devicesStatus: 'loaded',
      devicesMessage: null,
    });
  });

  it('keeps the signed-in account and exposes a retryable device-list outage', async () => {
    (cloudAuthService.listDevices as jest.Mock).mockResolvedValueOnce({
      status: 'unavailable',
      reason: 'network',
      message: '无法连接 Mira Cloud，暂时无法读取设备列表。',
    });

    await useCloudAccountStore.getState().loadDevices();

    expect(useCloudAccountStore.getState()).toMatchObject({
      status: 'signed_in',
      account,
      devices: [],
      devicesStatus: 'unavailable',
      devicesMessage: '无法连接 Mira Cloud，暂时无法读取设备列表。',
    });
  });

  it('clears local authority when listing devices is rejected', async () => {
    (cloudAuthService.listDevices as jest.Mock).mockResolvedValueOnce({
      status: 'rejected',
      message: 'Mira Cloud 登录已失效，请重新登录。',
    });

    await useCloudAccountStore.getState().loadDevices();

    expect(useCloudAccountStore.getState()).toMatchObject({
      status: 'session_rejected',
      account: null,
      devices: [],
      message: 'Mira Cloud 登录已失效，请重新登录。',
    });
  });

  it('updates only the revoked other device and keeps this installation signed in', async () => {
    setState({
      devices: [mobileDevice, desktopDevice],
      devicesStatus: 'loaded',
    });
    const revokedDesktop = {
      ...desktopDevice,
      revokedAt: '2026-10-25T10:00:00.000Z',
    };
    (cloudAuthService.revokeDevice as jest.Mock).mockResolvedValueOnce({
      status: 'revoked',
      device: revokedDesktop,
      session: {
        status: 'signed_in',
        account,
        expiresAt,
      },
    });

    await useCloudAccountStore.getState().revokeDevice(desktopDevice.id);

    expect(useCloudAccountStore.getState()).toMatchObject({
      status: 'signed_in',
      account,
      expiresAt,
      message: 'Mira Cloud 已确认撤销这台设备。',
      devices: [mobileDevice, revokedDesktop],
      devicesStatus: 'loaded',
      revokingDeviceId: null,
    });
    expect(cloudAuthService.revokeDevice).toHaveBeenCalledWith(
      desktopDevice.id,
    );
  });

  it('does not claim a device revoke succeeded when no stored session allowed DELETE', async () => {
    setState({
      devices: [mobileDevice],
      devicesStatus: 'loaded',
    });
    (cloudAuthService.revokeDevice as jest.Mock).mockResolvedValueOnce({
      status: 'signed_out',
    });

    await useCloudAccountStore.getState().revokeDevice(mobileDevice.id);

    const state = useCloudAccountStore.getState();
    expect(state).toMatchObject({
      status: 'signed_out',
      account: null,
      devices: [],
      revokingDeviceId: null,
    });
    expect(state.message).toContain('撤销未执行');
    expect(state.message).not.toContain('已确认撤销');
  });

  it('invalidates local Cloud authority when the confirmed revoke removed the current session', async () => {
    setState({
      devices: [mobileDevice],
      devicesStatus: 'loaded',
    });
    const revokedMobile = {
      ...mobileDevice,
      revokedAt: '2026-10-25T10:00:00.000Z',
    };
    (cloudAuthService.revokeDevice as jest.Mock).mockResolvedValueOnce({
      status: 'revoked',
      device: revokedMobile,
      session: { status: 'session_rejected' },
    });

    await useCloudAccountStore.getState().revokeDevice(mobileDevice.id);

    expect(useCloudAccountStore.getState()).toMatchObject({
      status: 'session_rejected',
      account: null,
      devices: [],
      message: 'Mira Cloud 已确认撤销这台设备；本机 Cloud 登录已失效，请重新登录。',
    });
  });

  it('keeps the confirmed revoke visible without claiming the local session is valid or signed out', async () => {
    setState({
      devices: [mobileDevice],
      devicesStatus: 'loaded',
    });
    const revokedMobile = {
      ...mobileDevice,
      revokedAt: '2026-10-25T10:00:00.000Z',
    };
    (cloudAuthService.revokeDevice as jest.Mock).mockResolvedValueOnce({
      status: 'revoked',
      device: revokedMobile,
      session: {
        status: 'cloud_unavailable',
        account,
        expiresAt,
      },
    });

    await useCloudAccountStore.getState().revokeDevice(mobileDevice.id);

    const state = useCloudAccountStore.getState();
    expect(state).toMatchObject({
      status: 'cloud_unavailable',
      account,
      expiresAt,
      devices: [revokedMobile],
      devicesStatus: 'loaded',
      devicesMessage: null,
      revokingDeviceId: null,
    });
    expect(state.message).toContain('已确认撤销');
    expect(state.message).toContain('暂时无法确认本机登录状态');
  });

  it('does not mark a device revoked or claim success when the server rejects or cannot confirm the revoke', async () => {
    setState({
      devices: [mobileDevice],
      devicesStatus: 'loaded',
      message: 'Mira Cloud 已确认撤销这台设备。',
    });
    (cloudAuthService.revokeDevice as jest.Mock).mockResolvedValueOnce({
      status: 'failed',
      reason: 'network',
      message: '无法连接 Mira Cloud，设备撤销未确认；本机登录状态保持不变。',
    });

    await useCloudAccountStore.getState().revokeDevice(mobileDevice.id);

    const state = useCloudAccountStore.getState();
    expect(state.devices).toEqual([mobileDevice]);
    expect(state.message).toBeNull();
    expect(state.devicesMessage).toContain('撤销未确认');
    expect(state.devicesMessage).not.toContain('已确认撤销');
    expect(state.revokingDeviceId).toBeNull();
  });

  it('reports an unexpected revoke exception without changing the device list', async () => {
    setState({
      devices: [mobileDevice],
      devicesStatus: 'loaded',
    });
    (cloudAuthService.revokeDevice as jest.Mock).mockRejectedValueOnce(
      new Error('unexpected'),
    );

    await useCloudAccountStore.getState().revokeDevice(mobileDevice.id);

    const state = useCloudAccountStore.getState();
    expect(state).toMatchObject({
      status: 'signed_in',
      devices: [mobileDevice],
      revokingDeviceId: null,
    });
    expect(state.devicesMessage).toBe('设备撤销结果未确认，请稍后重试。');
  });
});

const deferredResult = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
};

const replacementAccount = { id: 'account-2', username: 'bob' };

describe('MOB-081-C stale Cloud Account completions', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    setState();
  });

  it('does not regress to authorizing when a browser launch completes after OAuth login', async () => {
    const browser = deferredResult<void>();
    setState({ status: 'signed_out', account: null, expiresAt: null });
    (cloudAuthService.beginSignIn as jest.Mock).mockReturnValue(browser.promise);
    (cloudAuthService.completeSignIn as jest.Mock).mockResolvedValue({
      status: 'signed_in',
      account: replacementAccount,
      expiresAt,
    });

    const starting = useCloudAccountStore.getState().signIn();
    await useCloudAccountStore.getState().completeSignIn({ code: 'valid' });
    browser.resolve();
    await starting;

    expect(useCloudAccountStore.getState()).toMatchObject({
      status: 'signed_in',
      account: replacementAccount,
      busy: false,
    });
  });

  it('ignores an old refresh that resolves after a different account signs in', async () => {
    const oldRefresh = deferredResult<{
      status: 'signed_in';
      account: typeof account;
      expiresAt: string;
    }>();
    (cloudAuthService.restoreSession as jest.Mock).mockReturnValue(oldRefresh.promise);
    (cloudAuthService.completeSignIn as jest.Mock).mockResolvedValue({
      status: 'signed_in',
      account: replacementAccount,
      expiresAt,
    });

    const refreshing = useCloudAccountStore.getState().refresh();
    await useCloudAccountStore.getState().completeSignIn({ code: 'valid' });
    oldRefresh.resolve({ status: 'signed_in', account, expiresAt });
    await refreshing;

    expect(useCloudAccountStore.getState()).toMatchObject({
      status: 'signed_in',
      account: replacementAccount,
      busy: false,
    });
  });

  it('does not inject an old account device list after a new login', async () => {
    const oldList = deferredResult<{
      status: 'listed';
      devices: typeof mobileDevice[];
    }>();
    (cloudAuthService.listDevices as jest.Mock).mockReturnValue(oldList.promise);
    (cloudAuthService.completeSignIn as jest.Mock).mockResolvedValue({
      status: 'signed_in',
      account: replacementAccount,
      expiresAt,
    });

    const listing = useCloudAccountStore.getState().loadDevices();
    await useCloudAccountStore.getState().completeSignIn({ code: 'valid' });
    oldList.resolve({ status: 'listed', devices: [mobileDevice] });
    await listing;

    expect(useCloudAccountStore.getState()).toMatchObject({
      status: 'signed_in',
      account: replacementAccount,
      devices: [],
      devicesStatus: 'idle',
    });
  });

  it('does not resurrect an old account after a late revoke completes', async () => {
    const oldRevoke = deferredResult<{
      status: 'revoked';
      device: typeof mobileDevice;
      session: { status: 'signed_in'; account: typeof account; expiresAt: string };
    }>();
    (cloudAuthService.revokeDevice as jest.Mock).mockReturnValue(oldRevoke.promise);
    (cloudAuthService.completeSignIn as jest.Mock).mockResolvedValue({
      status: 'signed_in',
      account: replacementAccount,
      expiresAt,
    });

    const revoking = useCloudAccountStore.getState().revokeDevice(mobileDevice.id);
    await useCloudAccountStore.getState().completeSignIn({ code: 'valid' });
    oldRevoke.resolve({
      status: 'revoked',
      device: mobileDevice,
      session: { status: 'signed_in', account, expiresAt },
    });
    await revoking;

    expect(useCloudAccountStore.getState()).toMatchObject({
      status: 'signed_in',
      account: replacementAccount,
      devices: [],
      revokingDeviceId: null,
    });
  });

  it('does not resurrect a signed-in callback after a newer successful logout', async () => {
    const callback = deferredResult<{
      status: 'signed_in';
      account: typeof account;
      expiresAt: string;
    }>();
    (cloudAuthService.completeSignIn as jest.Mock).mockReturnValue(callback.promise);
    (cloudAuthService.logout as jest.Mock).mockResolvedValue({
      remote: 'revoked',
      cleared: true,
      message: null,
    });

    const completing = useCloudAccountStore.getState().completeSignIn({ code: 'valid' });
    const loggingOut = useCloudAccountStore.getState().signOut();
    await loggingOut;
    callback.resolve({ status: 'signed_in', account, expiresAt });
    await completing;

    expect(useCloudAccountStore.getState()).toMatchObject({
      status: 'signed_out',
      account: null,
      busy: false,
    });
  });
});
