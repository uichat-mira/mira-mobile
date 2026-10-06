import { RemoteHostError } from '../api/remoteHttp';

export type WorkspaceCollectionState = 'loading' | 'error' | 'empty' | 'data';

export const resolveWorkspaceCollectionState = (
  loading: boolean,
  errorMessage: string | null,
  itemCount: number,
): WorkspaceCollectionState => {
  if (loading) return 'loading';
  if (errorMessage) return 'error';
  if (itemCount === 0) return 'empty';
  return 'data';
};

export const getWorkspaceLoadErrorMessage = (error: unknown): string => {
  if (error instanceof RemoteHostError) {
    if (error.code === 'PAIRING_REQUIRED') {
      return '尚未连接 Mira Desktop，请先完成设备连接';
    }
    if (error.status === 401) {
      return '设备认证已失效，请重新连接 Mira Desktop';
    }
    if (error.status === 403) {
      return '当前远程连接没有读取项目的权限';
    }
    if (
      error.code === 'NETWORK_ERROR' ||
      error.code.startsWith('RELAY_') ||
      error.code === 'REMOTE_ENDPOINT_UNAVAILABLE'
    ) {
      return '无法连接 Mira Desktop，请检查网络后重试';
    }
  }

  return '无法加载项目，请稍后重试';
};
