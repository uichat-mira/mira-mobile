import type { LastOpenedSession } from '../session/lastOpenedSession';
import {
  resolveLocalRestoreVerdict,
  resolveRemoteRestoreVerdict,
  resolveRestoreTarget,
  type RestoreTargetDeps,
} from './restoreTarget';

const target = (
  overrides: Partial<LastOpenedSession> = {},
): LastOpenedSession => ({
  sessionId: 'thread-1',
  title: '会话',
  source: 'remote-host',
  providerName: null,
  providerModel: null,
  ...overrides,
});

const buildDeps = (
  overrides: Partial<RestoreTargetDeps> = {},
): RestoreTargetDeps => ({
  loadLastOpenedSession: async () => null,
  listLocalSessions: async () => [],
  listRemoteSessions: async () => [],
  isRemoteConnected: () => true,
  ...overrides,
});

describe('resolveRestoreTarget', () => {
  it('returns null when nothing was stored', async () => {
    await expect(resolveRestoreTarget(buildDeps())).resolves.toBeNull();
  });

  it('returns null when the stored record cannot be read', async () => {
    const deps = buildDeps({
      loadLastOpenedSession: async () => {
        throw new Error('storage unavailable');
      },
    });
    await expect(resolveRestoreTarget(deps)).resolves.toBeNull();
  });

  it('restores a remote target that the connected Host lists', async () => {
    const stored = target();
    const deps = buildDeps({
      loadLastOpenedSession: async () => stored,
      listRemoteSessions: async () => [{ id: 'thread-1' }],
    });
    await expect(resolveRestoreTarget(deps)).resolves.toEqual(stored);
  });

  it('drops a remote target a connected Host authoritatively lists as absent', async () => {
    const deps = buildDeps({
      loadLastOpenedSession: async () => target(),
      listRemoteSessions: async () => [{ id: 'thread-2' }],
    });
    await expect(resolveRestoreTarget(deps)).resolves.toBeNull();
  });

  it('keeps a remote target while the Host is not connected, without listing', async () => {
    const stored = target();
    const listRemoteSessions = jest.fn(async () => []);
    const deps = buildDeps({
      loadLastOpenedSession: async () => stored,
      listRemoteSessions,
      isRemoteConnected: () => false,
    });
    await expect(resolveRestoreTarget(deps)).resolves.toEqual(stored);
    expect(listRemoteSessions).not.toHaveBeenCalled();
  });

  it('keeps a remote target when the Host listing fails', async () => {
    const stored = target();
    const deps = buildDeps({
      loadLastOpenedSession: async () => stored,
      listRemoteSessions: async () => {
        throw new Error('list failed');
      },
    });
    await expect(resolveRestoreTarget(deps)).resolves.toEqual(stored);
  });

  it('restores a local target present in device storage', async () => {
    const stored = target({ sessionId: 'local-1', source: 'local-provider' });
    const deps = buildDeps({
      loadLastOpenedSession: async () => stored,
      listLocalSessions: async () => [{ id: 'local-1' }],
    });
    await expect(resolveRestoreTarget(deps)).resolves.toEqual(stored);
  });

  it('drops a local target absent from device storage', async () => {
    const deps = buildDeps({
      loadLastOpenedSession: async () => target({ sessionId: 'local-1', source: 'local-provider' }),
      listLocalSessions: async () => [{ id: 'local-2' }],
    });
    await expect(resolveRestoreTarget(deps)).resolves.toBeNull();
  });

  it('drops a local target when the local listing fails', async () => {
    const deps = buildDeps({
      loadLastOpenedSession: async () => target({ sessionId: 'local-1', source: 'local-provider' }),
      listLocalSessions: async () => {
        throw new Error('list failed');
      },
    });
    await expect(resolveRestoreTarget(deps)).resolves.toBeNull();
  });

  it('routes by source and never consults the other authority', async () => {
    const listRemoteSessions = jest.fn(async () => [{ id: 'local-1' }]);
    const listLocalSessions = jest.fn(async () => [{ id: 'local-1' }]);
    const local = target({ sessionId: 'local-1', source: 'local-provider' });

    await expect(
      resolveRestoreTarget(
        buildDeps({
          loadLastOpenedSession: async () => local,
          listLocalSessions,
          listRemoteSessions,
        }),
      ),
    ).resolves.toEqual(local);

    expect(listLocalSessions).toHaveBeenCalledTimes(1);
    expect(listRemoteSessions).not.toHaveBeenCalled();
  });
});

describe('restore verdicts', () => {
  it('treats a failed local listing as "cannot confirm" and drops', async () => {
    await expect(
      resolveLocalRestoreVerdict(
        target({ source: 'local-provider' }),
        buildDeps({
          listLocalSessions: async () => {
            throw new Error('failed');
          },
        }),
      ),
    ).resolves.toBe('drop');
  });

  it('treats a failed remote listing as "cannot confirm" and restores', async () => {
    await expect(
      resolveRemoteRestoreVerdict(
        target(),
        buildDeps({
          listRemoteSessions: async () => {
            throw new Error('failed');
          },
        }),
      ),
    ).resolves.toBe('restore');
  });
});
