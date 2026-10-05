import { RemoteHostError } from '../api/remoteHttp';
import type { Session } from '../types';
import {
  classifySessionCollectionFailure,
  getSessionLoadErrorMessage,
  loadSessionCollection,
  resolveSessionCollectionState,
} from './sessionCollection';

const session = (
  id: string,
  source: Session['source'] = 'remote-host',
): Session => ({
  id,
  title: id,
  updatedAt: new Date('2026-08-28T00:00:00.000Z'),
  source,
});

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

  it('keeps legacy message mapping for surfaces outside the diagnostic migration', () => {
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

describe('loadSessionCollection', () => {
  it('reads the collection with the requested source filter and reports delete capability', async () => {
    const listSessions = jest.fn(async (filter: string) =>
      filter === 'local-provider'
        ? [session('local-1', 'local-provider')]
        : [session('remote-1'), session('local-1', 'local-provider')],
    );
    const canDeleteRemoteSessions = jest.fn(async () => true);

    const snapshot = await loadSessionCollection({
      listSessions,
      canDeleteRemoteSessions,
      filter: 'all',
    });

    expect(snapshot.sessions.map(({ id }) => id)).toEqual(['remote-1', 'local-1']);
    expect(snapshot.canDeleteSessions).toBe(true);
    expect(listSessions).toHaveBeenCalledWith('all');
  });

  it('never probes remote delete capability for a local-provider-only read', async () => {
    const canDeleteRemoteSessions = jest.fn(async () => true);

    const snapshot = await loadSessionCollection({
      listSessions: async () => [session('local-1', 'local-provider')],
      canDeleteRemoteSessions,
      filter: 'local-provider',
    });

    expect(snapshot.canDeleteSessions).toBe(false);
    expect(canDeleteRemoteSessions).not.toHaveBeenCalled();
  });

  it('observes unread state only for Remote sessions', async () => {
    const observed: Session[][] = [];
    const syncUnreadSessions = jest.fn(async (items: Session[]) => {
      observed.push(items);
    });

    await loadSessionCollection({
      listSessions: async () => [
        session('remote-1'),
        session('local-1', 'local-provider'),
      ],
      syncUnreadSessions,
      filter: 'all',
    });

    expect(syncUnreadSessions).toHaveBeenCalledTimes(1);
    expect(observed[0].map((item) => item.id)).toEqual(['remote-1']);
  });

  it('keeps unread observation best-effort and retries it on the next reload', async () => {
    const syncUnreadSessions = jest.fn(async () => {
      throw new Error('read observation unavailable');
    });
    const deps = {
      listSessions: async () => [session('remote-1')],
      syncUnreadSessions,
      filter: 'remote-host' as const,
    };

    await expect(loadSessionCollection(deps)).resolves.toEqual({
      sessions: [expect.objectContaining({ id: 'remote-1' })],
      canDeleteSessions: false,
    });
    await expect(loadSessionCollection(deps)).resolves.toEqual({
      sessions: [expect.objectContaining({ id: 'remote-1' })],
      canDeleteSessions: false,
    });

    expect(syncUnreadSessions).toHaveBeenCalledTimes(2);
  });

  it('degrades remote delete capability to false when the probe fails', async () => {
    const snapshot = await loadSessionCollection({
      listSessions: async () => [session('remote-1')],
      canDeleteRemoteSessions: async () => {
        throw new Error('manifest unavailable');
      },
      filter: 'remote-host',
    });

    expect(snapshot.canDeleteSessions).toBe(false);
    expect(snapshot.sessions.map(({ id }) => id)).toEqual(['remote-1']);
  });

  it('propagates a collection read failure instead of returning an empty list', async () => {
    await expect(
      loadSessionCollection({
        listSessions: async () => {
          throw new RemoteHostError('NETWORK_ERROR', 'offline');
        },
        filter: 'all',
      }),
    ).rejects.toBeInstanceOf(RemoteHostError);
  });
});

describe('classifySessionCollectionFailure', () => {
  it('maps credential and permission failures into actionable diagnostics', async () => {
    const invalid = await classifySessionCollectionFailure(
      new RemoteHostError('HTTP_401', 'unauthorized', 401),
    );
    const denied = await classifySessionCollectionFailure(
      new RemoteHostError('HTTP_403', 'forbidden', 403),
    );

    expect(invalid.kind).toBe('credential_invalid');
    expect(denied.kind).toBe('permission_denied');
  });

  it('does not swallow an unknown failure into an empty state', async () => {
    const diagnostic = await classifySessionCollectionFailure(
      new RemoteHostError('HTTP_500', 'server error', 500),
    );

    expect(diagnostic.kind).toBe('session_service_error');
    expect(diagnostic.primaryAction.kind).toBe('retry');
  });
});
