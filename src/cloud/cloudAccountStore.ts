import { create } from 'zustand';
import { cloudRelayEntry } from './cloudRelayEntry';
import type { CloudAccountIdentity, MiraDevice } from './cloudAuthApi';
import {
  cloudAuthService,
  CloudAuthServiceError,
  type CloudAuthSessionState,
  type OAuthCallbackParams,
} from './cloudAuthService';

export type CloudAccountStatus =
  | 'loading'
  | 'signed_out'
  | 'authorizing'
  | 'signed_in'
  | 'cloud_unavailable'
  | 'session_rejected';

export type CloudDevicesStatus =
  | 'idle'
  | 'loading'
  | 'loaded'
  | 'unavailable';

interface CloudAccountStore {
  status: CloudAccountStatus;
  account: CloudAccountIdentity | null;
  expiresAt: string | null;
  message: string | null;
  busy: boolean;
  initialized: boolean;
  devices: MiraDevice[];
  devicesStatus: CloudDevicesStatus;
  devicesMessage: string | null;
  revokingDeviceId: string | null;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  loadDevices: () => Promise<void>;
  revokeDevice: (deviceId: string) => Promise<void>;
  signIn: () => Promise<void>;
  cancelSignIn: () => Promise<void>;
  completeSignIn: (params: OAuthCallbackParams) => Promise<CloudAccountStatus>;
  signOut: () => Promise<void>;
}

let initialization: Promise<void> | null = null;

const unavailableMessage =
  'Mira Cloud 暂时不可用。本地模型和 Tailscale 直连不受影响。';
const rejectedMessage = 'Mira Cloud 登录已失效，请重新登录。';
const deviceListFailureMessage = '无法读取 Mira Cloud 设备列表，请稍后重试。';

const deviceReset = () => ({
  devices: [] as MiraDevice[],
  devicesStatus: 'idle' as CloudDevicesStatus,
  devicesMessage: null as string | null,
  revokingDeviceId: null as string | null,
});

const keepsAccountDevices = (state: CloudAuthSessionState): boolean =>
  state.status === 'signed_in' || state.status === 'cloud_unavailable';

const resultStatus = (
  state: CloudAuthSessionState,
): Pick<CloudAccountStore, 'status' | 'account' | 'expiresAt' | 'message'> => {
  switch (state.status) {
    case 'signed_in':
      return {
        status: 'signed_in',
        account: state.account,
        expiresAt: state.expiresAt,
        message: null,
      };
    case 'cloud_unavailable':
      return {
        status: 'cloud_unavailable',
        account: state.account,
        expiresAt: state.expiresAt,
        message: unavailableMessage,
      };
    case 'session_rejected':
      return {
        status: 'session_rejected',
        account: null,
        expiresAt: null,
        message: state.message ?? rejectedMessage,
      };
    default:
      return {
        status: 'signed_out',
        account: null,
        expiresAt: null,
        message: null,
      };
  }
};

const failureStatus = (
  error: unknown,
  current: CloudAccountIdentity | null,
): Pick<CloudAccountStore, 'status' | 'account' | 'expiresAt' | 'message'> => {
  if (error instanceof CloudAuthServiceError) {
    if (error.kind === 'network' || error.kind === 'unavailable') {
      return {
        status: 'cloud_unavailable',
        account: current,
        expiresAt: null,
        message: error.message,
      };
    }
    return {
      status: 'signed_out',
      account: null,
      expiresAt: null,
      message: error.message,
    };
  }
  return {
    status: 'signed_out',
    account: null,
    expiresAt: null,
    message: 'Mira Cloud 登录未完成，请稍后重试。',
  };
};

export const useCloudAccountStore = create<CloudAccountStore>((set, get) => ({
  status: 'loading',
  account: null,
  expiresAt: null,
  message: null,
  busy: false,
  initialized: false,
  ...deviceReset(),

  initialize: async () => {
    if (get().initialized) return;
    if (!initialization) {
      initialization = (async () => {
        try {
          const state = await cloudAuthService.restoreSession();
          set({ ...resultStatus(state), ...deviceReset(), initialized: true });
        } catch {
          set({
            status: 'signed_out',
            account: null,
            expiresAt: null,
            message: '无法读取 Mira Cloud 登录状态。',
            ...deviceReset(),
            initialized: true,
          });
        }
      })();
    }
    await initialization;
  },

  refresh: async () => {
    if (get().busy) return;
    set({ busy: true });
    try {
      const state = await cloudAuthService.restoreSession();
      const next = resultStatus(state);
      // A storage failure can leave Cloud unavailable with no account identity.
      // Never preserve an old account's devices or loading state across that
      // unknown-identity transition (or a different account).
      const priorAccountId = get().account?.id;
      const sameAccount =
        (state.status === 'signed_in' ||
          state.status === 'cloud_unavailable') &&
        state.account !== null &&
        state.account.id === priorAccountId;
      set({
        ...next,
        ...(keepsAccountDevices(state) && sameAccount ? {} : deviceReset()),
      });
    } catch {
      set({
        status: 'cloud_unavailable',
        account: get().account,
        expiresAt: get().expiresAt,
        message: unavailableMessage,
      });
    } finally {
      set({ busy: false });
    }
  },

  signIn: async () => {
    if (get().busy) return;
    set({ busy: true, message: null });
    try {
      await cloudAuthService.beginSignIn();
      set({
        status: 'authorizing',
        message:
          '已在系统浏览器中打开 Mira Cloud 登录页，完成登录后返回 Mira。',
      });
    } catch (error) {
      const current = get();
      const failure = failureStatus(error, current.account);
      // A failed browser launch does not invalidate the session already saved
      // for this installation.
      if (current.account) {
        set({ busy: false, message: failure.message });
      } else {
        set({ ...failure, busy: false });
      }
      return;
    }
    set({ busy: false });
  },

  cancelSignIn: async () => {
    if (get().busy) return;
    set({ busy: true });
    try {
      await cloudAuthService.cancelPendingSignIn();
    } catch {
      // Pending state is not confirmed cleared; retain the authorizing
      // screen and allow the user to retry cancellation.
      set({ busy: false, message: '无法清除本次登录状态，请重试。' });
      return;
    }

    try {
      const restored = await cloudAuthService.restoreSession();
      const state = resultStatus(restored);
      set({
        ...state,
        ...(keepsAccountDevices(restored) ? {} : deviceReset()),
        busy: false,
        message:
          restored.status === 'session_rejected'
            ? state.message
            : '已取消 Mira Cloud 登录。',
      });
    } catch {
      const current = get();
      set({
        status: current.account ? 'cloud_unavailable' : 'signed_out',
        message: '已取消登录；暂时无法检查原有 Mira Cloud 会话。',
        busy: false,
      });
    }
  },

  completeSignIn: async (params: OAuthCallbackParams) => {
    set({ busy: true, message: null });
    try {
      const state = await cloudAuthService.completeSignIn(params);
      set({ ...resultStatus(state), ...deviceReset(), busy: false });
    } catch (error) {
      // An invalid/duplicate deep link must not sign out an existing account.
      // On cold start, let the initial secure-store restore finish first.
      if (!get().initialized) await get().initialize();
      const current = get();
      const failure = failureStatus(error, current.account);
      if (current.account && current.status === 'authorizing') {
        // Re-login may have started from an existing/offline Cloud session.
        // Re-check the secure record instead of presenting a false sign-out.
        try {
          const previous = await cloudAuthService.restoreSession();
          set({
            ...resultStatus(previous),
            ...(keepsAccountDevices(previous) ? {} : deviceReset()),
            message: failure.message,
            busy: false,
          });
        } catch {
          set({
            status: 'cloud_unavailable',
            message: failure.message,
            busy: false,
          });
        }
      } else if (
        current.account &&
        (current.status === 'signed_in' ||
          current.status === 'cloud_unavailable')
      ) {
        set({ busy: false, message: failure.message });
      } else {
        set({ ...failure, busy: false });
      }
    }
    return get().status;
  },

  loadDevices: async () => {
    const current = get();
    if (
      !current.account ||
      current.status !== 'signed_in' ||
      current.devicesStatus === 'loading' ||
      current.revokingDeviceId !== null
    ) {
      return;
    }

    set({ devicesStatus: 'loading', devicesMessage: null });
    try {
      const result = await cloudAuthService.listDevices();
      // The request may finish after logout, revoke, or a different login.
      // Its result belongs only to the account that initiated this load.
      const latest = get();
      if (latest.account?.id !== current.account.id) {
        // A null identity must not retain the previous account's loader.
        // A different signed-in account may have its own active request.
        if (!latest.account && latest.devicesStatus === 'loading') {
          set(deviceReset());
        }
        return;
      }
      if (latest.status !== 'signed_in') {
        // Same account, but refresh has moved it offline/authorizing. Never
        // publish the stale list, and do not strand the retry state on loading.
        if (latest.devicesStatus === 'loading') {
          set({
            devicesStatus: 'unavailable',
            devicesMessage: deviceListFailureMessage,
          });
        }
        return;
      }
      switch (result.status) {
        case 'listed':
          set({
            devices: result.devices,
            devicesStatus: 'loaded',
            devicesMessage: null,
          });
          return;
        case 'signed_out':
          set({
            status: 'signed_out',
            account: null,
            expiresAt: null,
            message: null,
            ...deviceReset(),
          });
          return;
        case 'rejected':
          set({
            status: 'session_rejected',
            account: null,
            expiresAt: null,
            message: result.message,
            ...deviceReset(),
          });
          return;
        default:
          set({
            devicesStatus: 'unavailable',
            devicesMessage: result.message,
          });
      }
    } catch {
      const latest = get();
      if (latest.devicesStatus === 'loading') {
        if (!latest.account) {
          set(deviceReset());
        } else if (latest.account.id === current.account.id) {
          set({
            devicesStatus: 'unavailable',
            devicesMessage: deviceListFailureMessage,
          });
        }
      }
    }
  },

  revokeDevice: async (deviceId: string) => {
    const current = get();
    if (!current.account || current.revokingDeviceId !== null) return;
    // Any active Cloud business request must stop before revocation can change authority.
    cloudRelayEntry.reset();

    set({ revokingDeviceId: deviceId, devicesMessage: null, message: null });
    try {
      const result = await cloudAuthService.revokeDevice(deviceId);
      switch (result.status) {
        case 'signed_out':
          // There was no stored Cloud credential, so the service never sent
          // DELETE. Do not report the requested device as revoked.
          set({
            status: 'signed_out',
            account: null,
            expiresAt: null,
            message: '本机 Mira Cloud 已退出，设备撤销未执行；请重新登录后重试。',
            ...deviceReset(),
          });
          return;
        case 'rejected':
          set({
            status: 'session_rejected',
            account: null,
            expiresAt: null,
            message: result.message,
            ...deviceReset(),
          });
          return;
        case 'failed':
          set({
            revokingDeviceId: null,
            devicesMessage: result.message,
          });
          return;
        default:
          break;
      }

      const devices = current.devices.some(
        device => device.id === result.device.id,
      )
        ? current.devices.map(device =>
            device.id === result.device.id ? result.device : device,
          )
        : [...current.devices, result.device];
      const session = resultStatus(result.session);
      let message: string;
      switch (result.session.status) {
        case 'cloud_unavailable':
          message =
            'Mira Cloud 已确认撤销这台设备，但暂时无法确认本机登录状态；本机登录记录仍保留，请稍后重试检查。';
          break;
        case 'session_rejected':
          message =
            result.session.message ??
            'Mira Cloud 已确认撤销这台设备；本机 Cloud 登录已失效，请重新登录。';
          break;
        default:
          message = 'Mira Cloud 已确认撤销这台设备。';
      }

      if (
        result.session.status === 'session_rejected' ||
        result.session.status === 'signed_out'
      ) {
        set({ ...session, message, ...deviceReset() });
        return;
      }
      set({
        ...session,
        message,
        devices,
        devicesStatus: 'loaded',
        devicesMessage: null,
        revokingDeviceId: null,
      });
    } catch {
      set({
        revokingDeviceId: null,
        devicesMessage: '设备撤销结果未确认，请稍后重试。',
      });
    }
  },

  signOut: async () => {
    if (get().busy) return;
    // Close Cloud sockets and invalidate in-flight discovery before remote logout.
    cloudRelayEntry.reset();
    set({ busy: true, message: null });
    try {
      const result = await cloudAuthService.logout();
      if (result.cleared) {
        set({
          status: 'signed_out',
          account: null,
          expiresAt: null,
          message: result.message,
          ...deviceReset(),
          busy: false,
        });
        return;
      }
      set({
        message: result.message,
        busy: false,
      });
    } catch {
      set({
        message: '退出 Mira Cloud 未完成，请稍后重试。',
        busy: false,
      });
    }
  },
}));

// A changed Cloud account or rejected/absent session must not retain the
// previous account's Relay transport and any in-flight business operations.
useCloudAccountStore.subscribe((state, previous) => {
  if (state.account?.id !== previous.account?.id ||
      (previous.status === 'signed_in' && state.status !== 'signed_in')) {
    cloudRelayEntry.reset();
  }
});
