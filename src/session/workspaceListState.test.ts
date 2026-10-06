import { RemoteHostError } from '../api/remoteHttp';
import {
  getWorkspaceLoadErrorMessage,
  resolveWorkspaceCollectionState,
} from './workspaceListState';

describe('workspaceListState', () => {
  it('keeps loading, error, empty and data states separate', () => {
    expect(resolveWorkspaceCollectionState(true, null, 0)).toBe('loading');
    expect(resolveWorkspaceCollectionState(false, 'failed', 0)).toBe('error');
    expect(resolveWorkspaceCollectionState(false, null, 0)).toBe('empty');
    expect(resolveWorkspaceCollectionState(false, null, 2)).toBe('data');
  });

  it('describes transport permission errors without redefining projects', () => {
    expect(
      getWorkspaceLoadErrorMessage(
        new RemoteHostError('HTTP_403', 'forbidden', 403),
      ),
    ).toBe('当前远程连接没有读取项目的权限');
    expect(
      getWorkspaceLoadErrorMessage(
        new RemoteHostError('NETWORK_ERROR', 'offline'),
      ),
    ).toBe('无法连接 Mira Desktop，请检查网络后重试');
  });
});
