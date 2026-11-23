import type { CloudAccountIdentity } from '../cloud/cloudAuthApi';
import type { CloudAccountStatus } from '../cloud/cloudAccountStore';

export type DrawerAccountEntryKind =
  | 'identity'
  | 'identity_unavailable'
  | 'pending'
  | 'signed_out'
  | 'attention';

export type DrawerAccountEntryTone = 'default' | 'muted' | 'warning' | 'error';

export interface DrawerAccountEntryProjection {
  kind: DrawerAccountEntryKind;
  /** First character of the verified username; never guessed or fabricated. */
  initial: string | null;
  /** Verified Cloud account name; null whenever no trusted identity exists. */
  accountName: string | null;
  /** Primary line; the drawer truncates it on narrow layouts. */
  label: string;
  /** Secondary line that explains a non-default Cloud state. */
  detail: string | null;
  tone: DrawerAccountEntryTone;
  accessibilityLabel: string;
}

/**
 * Only `signed_in` and `cloud_unavailable` can carry a trusted identity. A
 * rejected, revoked or signed-out store deliberately drops the account, and
 * this projection must drop a stale object too instead of leaking the previous
 * username into the drawer.
 */
const trustedUsername = (
  status: CloudAccountStatus,
  account: CloudAccountIdentity | null,
): string | null => {
  if (status !== 'signed_in' && status !== 'cloud_unavailable') return null;
  if (!account) return null;
  const username = account.username.trim();
  return username.length > 0 ? username : null;
};

const initialsOf = (username: string): string =>
  Array.from(username)[0]?.toUpperCase() ?? '';

/**
 * Single owner of "Cloud store state -> drawer account entry". Every status is
 * projected from the store lifecycle truth so the drawer cannot present an
 * optimistic identity while initialization or reauthentication is unresolved.
 */
export const projectDrawerAccountEntry = (
  status: CloudAccountStatus,
  account: CloudAccountIdentity | null,
): DrawerAccountEntryProjection => {
  const accountName = trustedUsername(status, account);

  if (accountName) {
    const initial = initialsOf(accountName);
    if (status === 'signed_in') {
      return {
        kind: 'identity',
        initial,
        accountName,
        label: accountName,
        detail: null,
        tone: 'default',
        accessibilityLabel: `Mira Cloud 账号：${accountName}，打开账号页面`,
      };
    }
    return {
      kind: 'identity_unavailable',
      initial,
      accountName,
      label: accountName,
      detail: 'Cloud 连接中断',
      tone: 'warning',
      accessibilityLabel: `Mira Cloud 账号：${accountName}，Cloud 连接中断，打开账号页面`,
    };
  }

  switch (status) {
    case 'loading':
      return {
        kind: 'pending',
        initial: null,
        accountName: null,
        label: '检查中',
        detail: null,
        tone: 'muted',
        accessibilityLabel: 'Mira Cloud 登录状态检查中，打开账号页面',
      };
    case 'authorizing':
      return {
        kind: 'pending',
        initial: null,
        accountName: null,
        label: '登录中',
        detail: null,
        tone: 'muted',
        accessibilityLabel: 'Mira Cloud 正在登录，打开账号页面',
      };
    case 'session_rejected':
      return {
        kind: 'attention',
        initial: null,
        accountName: null,
        label: '登录已失效',
        detail: '重新登录',
        tone: 'error',
        accessibilityLabel: 'Mira Cloud 登录已失效，重新登录',
      };
    case 'device_revoked':
      return {
        kind: 'attention',
        initial: null,
        accountName: null,
        label: '授权已撤销',
        detail: '重新注册',
        tone: 'error',
        accessibilityLabel: 'Mira Cloud 本机授权已撤销，重新注册',
      };
    case 'cloud_unavailable':
      return {
        kind: 'signed_out',
        initial: null,
        accountName: null,
        label: '未登录',
        detail: 'Cloud 暂时不可用',
        tone: 'muted',
        accessibilityLabel: 'Mira Cloud 未登录，Cloud 暂时不可用，打开账号页面',
      };
    default:
      return {
        kind: 'signed_out',
        initial: null,
        accountName: null,
        label: '未登录',
        detail: null,
        tone: 'muted',
        accessibilityLabel: 'Mira Cloud 未登录，打开登录页面',
      };
  }
};
