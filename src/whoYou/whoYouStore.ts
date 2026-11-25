import { create } from 'zustand';
import {
  useCloudAccountStore,
  type CloudAccountStatus,
} from '../cloud/cloudAccountStore';
import {
  cloudSessionStore,
  type StoredCloudSession,
} from '../cloud/cloudSessionStore';
import { WhoYouError } from './whoYouError';
import { accountMcpServiceDirectory } from '../mcp/accountServiceRegistry';
import {
  type WhoYouIdentity,
  type WhoYouMailbox,
  type WhoYouMcpClientLike,
} from './whoYouMcpClient';

export type WhoYouStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'signed_out'
  | 'session_rejected'
  | 'unavailable'
  | 'error';

export interface WhoYouStoreState {
  status: WhoYouStatus;
  identity: WhoYouIdentity | null;
  mailboxes: WhoYouMailbox[];
  message: string | null;
  refresh: () => Promise<void>;
  invalidate: () => void;
}

export interface WhoYouCloudSnapshot {
  status: CloudAccountStatus;
  accountId: string | null;
}

export interface WhoYouStoreDependencies {
  loadSession: () => Promise<StoredCloudSession | null>;
  getCloudAccount: () => WhoYouCloudSnapshot;
  client: WhoYouMcpClientLike;
  now?: () => Date;
}

const emptyState = {
  status: 'idle' as const,
  identity: null,
  mailboxes: [] as WhoYouMailbox[],
  message: null,
};

const cloudFailure = (
  cloud: WhoYouCloudSnapshot,
): Pick<WhoYouStoreState, 'status' | 'message'> => {
  switch (cloud.status) {
    case 'signed_in':
      return {
        status: cloud.accountId ? 'signed_out' : 'session_rejected',
        message: cloud.accountId
          ? '请先在 Mira Cloud 完成登录，再打开狐邮。'
          : 'Mira Cloud 登录已失效，请重新登录。',
      };
    case 'session_rejected':
    case 'device_revoked':
      return {
        status: 'session_rejected',
        message:
          cloud.status === 'device_revoked'
            ? '本机 Mira Cloud 授权已撤销，请重新注册设备。'
            : 'Mira Cloud 登录已失效，请重新登录。',
      };
    case 'loading':
    case 'authorizing':
      return {
        status: 'unavailable',
        message: '正在检查 Mira Cloud 登录状态，请稍后刷新。',
      };
    case 'cloud_unavailable':
      return {
        status: 'unavailable',
        message: 'Mira Cloud 暂时不可用，无法获取狐邮只读凭证。',
      };
    default:
      return {
        status: 'signed_out',
        message: '请先在 Mira Cloud 完成登录，再打开狐邮。',
      };
  }
};

const whoYouFailure = (
  error: unknown,
): Pick<WhoYouStoreState, 'status' | 'message'> => {
  if (error instanceof WhoYouError) {
    switch (error.kind) {
      case 'network':
        return {
          status: 'unavailable',
          message: '无法连接狐邮，请检查网络后重试。',
        };
      case 'unavailable':
        return {
          status: 'unavailable',
          message: '狐邮暂时不可用，请稍后重试。',
        };
      case 'session_rejected':
        return {
          status: 'session_rejected',
          message: 'Mira Cloud 登录已失效，请重新登录。',
        };
      case 'unauthorized':
        return {
          status: 'error',
          message: error.code === 'SERVICE_REGISTRATION_NOT_FOUND' || error.code === 'SERVICE_REGISTRATION_CHANGED'
            ? '当前 Mira ID 未注册狐邮服务或授权已撤销。'
            : '狐邮拒绝了当前只读凭证，请稍后重试或重新登录 Mira Cloud。',
        };
      case 'rejected':
        return {
          status: 'error',
          message: '狐邮拒绝了只读邮箱请求，请稍后重试。',
        };
      case 'not_configured':
        return {
          status: 'error',
          message: '狐邮地址未配置，当前构建无法读取邮箱。',
        };
      case 'invalid_response':
        return {
          status: 'error',
          message: '狐邮返回了无法识别的数据，请稍后重试。',
        };
      default:
        break;
    }
  }
  return {
    status: 'error',
    message: '无法读取狐邮邮箱，请稍后重试。',
  };
};

/**
 * The Who You screen owns no credential state. Each load obtains a fresh
 * short-lived bearer inside the MCP client, and a newer account intent or load
 * invalidates every older result before it can be published.
 */
export const createWhoYouStore = (deps: WhoYouStoreDependencies) => {
  let generation = 0;
  const current = (request: number) => request === generation;

  return create<WhoYouStoreState>(set => ({
    ...emptyState,

    invalidate: () => {
      generation += 1;
      set({ ...emptyState, mailboxes: [] });
    },

    refresh: async () => {
      const request = ++generation;
      const cloud = deps.getCloudAccount();
      if (cloud.status !== 'signed_in' || !cloud.accountId) {
        set({
          ...emptyState,
          ...cloudFailure(cloud),
          mailboxes: [],
        });
        return;
      }

      set({ ...emptyState, status: 'loading', mailboxes: [] });

      let stored: StoredCloudSession | null;
      try {
        stored = await deps.loadSession();
      } catch {
        if (!current(request)) return;
        set({
          status: 'unavailable',
          identity: null,
          mailboxes: [],
          message: '无法读取 Mira Cloud 登录状态，暂时无法连接狐邮。',
        });
        return;
      }
      if (!current(request)) return;

      const now = (deps.now ?? (() => new Date()))().getTime();
      if (
        !stored ||
        stored.account.id !== cloud.accountId ||
        Date.parse(stored.expiresAt) <= now
      ) {
        set({
          status: 'session_rejected',
          identity: null,
          mailboxes: [],
          message: 'Mira Cloud 登录已失效，请重新登录。',
        });
        return;
      }

      try {
        const snapshot = await deps.client.load({
          sessionToken: stored.sessionToken,
          accountId: cloud.accountId,
        });
        if (!current(request)) return;

        // The account/authority may have changed while the network calls were
        // in flight. An old result must never appear under the new identity.
        const latest = deps.getCloudAccount();
        if (
          latest.status !== 'signed_in' ||
          latest.accountId !== cloud.accountId
        ) {
          set({
            ...emptyState,
            mailboxes: [],
            ...cloudFailure(latest),
          });
          return;
        }

        set({
          status: snapshot.mailboxes.length > 0 ? 'ready' : 'empty',
          identity: snapshot.identity,
          mailboxes: snapshot.mailboxes,
          message: null,
        });
      } catch (error) {
        if (!current(request)) return;
        const latest = deps.getCloudAccount();
        if (
          latest.status !== 'signed_in' ||
          latest.accountId !== cloud.accountId
        ) {
          set({
            ...emptyState,
            mailboxes: [],
            ...cloudFailure(latest),
          });
          return;
        }
        set({
          identity: null,
          mailboxes: [],
          ...whoYouFailure(error),
        });
      }
    },
  }));
};

const productionDependencies: WhoYouStoreDependencies = {
  loadSession: () => cloudSessionStore.load(),
  getCloudAccount: () => {
    const state = useCloudAccountStore.getState();
    return {
      status: state.status,
      accountId: state.account?.id ?? null,
    };
  },
  client: { load: input => accountMcpServiceDirectory.loadWhoYouSnapshot(input) },
  now: () => new Date(),
};

export const useWhoYouStore = createWhoYouStore(productionDependencies);

useCloudAccountStore.subscribe((state, previous) => {
  if (
    state.account?.id !== previous.account?.id ||
    (previous.status === 'signed_in' && state.status !== 'signed_in')
  ) {
    useWhoYouStore.getState().invalidate();
  }
});
