import { RemoteHostError } from '../api/remoteHttp';

export type SessionCollectionState = 'loading' | 'error' | 'empty' | 'data';

export const resolveSessionCollectionState = (
  loading: boolean,
  errorMessage: string | null,
  itemCount: number,
): SessionCollectionState => {
  // Previously loaded sessions remain useful, safe local UI data while a
  // refresh is running or has failed. A transient Remote failure must not
  // replace them with a full-screen loading/error state.
  if (itemCount > 0) return 'data';
  if (loading) return 'loading';
  if (errorMessage) return 'error';
  return 'empty';
};

/**
 * Legacy message helper kept for screens outside MOB-035's Remote diagnostic
 * migration. SessionList, Drawer and Search use structured diagnostics instead.
 */
export const getSessionLoadErrorMessage = (error: unknown): string => {
  if (error instanceof RemoteHostError) {
    if (error.status === 401) {
      return '设备认证已失效，请重新连接 Mira Host';
    }
    if (error.status === 403) {
      return '当前设备没有读取会话的权限';
    }
    if (error.status === 404) {
      return '目标会话或项目不存在，或当前设备无法访问';
    }
    if (error.code === 'NETWORK_ERROR') {
      return '无法连接 Mira Host，请检查网络后重试';
    }
  }

  return '无法加载会话，请稍后重试';
};
