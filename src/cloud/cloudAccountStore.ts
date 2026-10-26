import { create } from 'zustand';
import type { CloudAccountIdentity } from './cloudAuthApi';
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

interface CloudAccountStore {
  status: CloudAccountStatus;
  account: CloudAccountIdentity | null;
  expiresAt: string | null;
  message: string | null;
  busy: boolean;
  initialized: boolean;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  signIn: () => Promise<void>;
  cancelSignIn: () => Promise<void>;
  completeSignIn: (params: OAuthCallbackParams) => Promise<CloudAccountStatus>;
  signOut: () => Promise<void>;
}

let initialization: Promise<void> | null = null;

const unavailableMessage =
  'Mira Cloud 暂时不可用。本地模型和 Tailscale 直连不受影响。';
const rejectedMessage = 'Mira Cloud 登录已失效，请重新登录。';

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
        message: rejectedMessage,
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

  initialize: async () => {
    if (get().initialized) return;
    if (!initialization) {
      initialization = (async () => {
        try {
          const state = await cloudAuthService.restoreSession();
          set({ ...resultStatus(state), initialized: true });
        } catch {
          set({
            status: 'signed_out',
            account: null,
            expiresAt: null,
            message: '无法读取 Mira Cloud 登录状态。',
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
      set(resultStatus(state));
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
      set({ ...failureStatus(error, get().account), busy: false });
      return;
    }
    set({ busy: false });
  },

  cancelSignIn: async () => {
    try {
      await cloudAuthService.cancelPendingSignIn();
      set({
        status: 'signed_out',
        account: null,
        expiresAt: null,
        message: '已取消 Mira Cloud 登录。',
      });
    } catch (error) {
      set({
        ...failureStatus(error, get().account),
        message: '无法清除本次登录状态，请重试。',
      });
    }
  },

  completeSignIn: async (params: OAuthCallbackParams) => {
    set({ busy: true, message: null });
    try {
      const state = await cloudAuthService.completeSignIn(params);
      set({ ...resultStatus(state), busy: false });
    } catch (error) {
      // An invalid/duplicate deep link must not sign out an existing account.
      // On cold start, let the initial secure-store restore finish first.
      if (!get().initialized) await get().initialize();
      const current = get();
      const failure = failureStatus(error, current.account);
      if (
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

  signOut: async () => {
    if (get().busy) return;
    set({ busy: true, message: null });
    try {
      const result = await cloudAuthService.logout();
      if (result.cleared) {
        set({
          status: 'signed_out',
          account: null,
          expiresAt: null,
          message: result.message,
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
