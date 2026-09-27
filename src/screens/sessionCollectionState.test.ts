import { RemoteHostError } from '../api/remoteHttp';
import {
  getSessionLoadErrorMessage,
  resolveSessionCollectionState,
} from './sessionCollectionState';

describe('session collection truth state', () => {
  it('keeps loading, error, empty and data states distinct', () => {
    expect(resolveSessionCollectionState(true, null, 0)).toBe('loading');
    expect(resolveSessionCollectionState(false, 'failed', 0)).toBe('error');
    expect(resolveSessionCollectionState(false, null, 0)).toBe('empty');
    expect(resolveSessionCollectionState(false, null, 2)).toBe('data');
  });

  it('keeps previously loaded sessions visible during refresh and refresh failure', () => {
    expect(resolveSessionCollectionState(true, null, 2)).toBe('data');
    expect(resolveSessionCollectionState(false, 'failed', 2)).toBe('data');
  });

  it('keeps legacy message mapping for screens outside the MOB-035 migration', () => {
    expect(
      getSessionLoadErrorMessage(
        new RemoteHostError('HTTP_401', 'unauthorized', 401),
      ),
    ).toBe('设备认证已失效，请重新连接 Mira Host');
    expect(
      getSessionLoadErrorMessage(new RemoteHostError('HTTP_403', 'forbidden', 403)),
    ).toBe('当前设备没有读取会话的权限');
    expect(
      getSessionLoadErrorMessage(new RemoteHostError('HTTP_404', 'not found', 404)),
    ).toBe('目标会话或项目不存在，或当前设备无法访问');
    expect(
      getSessionLoadErrorMessage(
        new RemoteHostError('NETWORK_ERROR', 'offline'),
      ),
    ).toBe('无法连接 Mira Host，请检查网络后重试');
  });
});
