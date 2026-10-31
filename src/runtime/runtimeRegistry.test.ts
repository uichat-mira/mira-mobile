import type { Session } from '../types';
import type { ConversationRuntime, RuntimeEvent } from './conversationRuntime';
import { RuntimeRegistry } from './runtimeRegistry';
import { RemoteHostError } from '../api/remoteHttp';

const session = (id: string, source: 'remote-host' | 'local-provider', updatedAt: string): Session => ({
  id,
  title: id,
  source,
  updatedAt: new Date(updatedAt),
});

const runtime = (kind: 'remote-host' | 'local-provider', sessions: Session[]): ConversationRuntime => ({
  kind,
  listSessions: async () => sessions,
  deleteSession: async () => undefined,
  getMessages: async () => [],
  sendMessage: async () => (async function* (): AsyncIterable<RuntimeEvent> {})(),
  cancelActiveRun: () => undefined,
});

describe('RuntimeRegistry', () => {
  it('merges remote and local sessions by updated time', async () => {
    const registry = new RuntimeRegistry(
      runtime('local-provider', [session('local-1', 'local-provider', '2026-09-06T02:00:00.000Z')]) as never,
      runtime('remote-host', [session('remote-1', 'remote-host', '2026-09-06T01:00:00.000Z')]) as never,
    );

    await expect(registry.listSessions()).resolves.toMatchObject([
      { id: 'local-1', source: 'local-provider' },
      { id: 'remote-1', source: 'remote-host' },
    ]);
  });

  it('queries only the requested session source', async () => {
    let localCalls = 0;
    let remoteCalls = 0;
    const local = runtime('local-provider', [session('local-1', 'local-provider', '2026-09-06T02:00:00.000Z')]);
    const remote = runtime('remote-host', [session('remote-1', 'remote-host', '2026-09-06T01:00:00.000Z')]);
    local.listSessions = async () => {
      localCalls += 1;
      return [session('local-1', 'local-provider', '2026-09-06T02:00:00.000Z')];
    };
    remote.listSessions = async () => {
      remoteCalls += 1;
      return [session('remote-1', 'remote-host', '2026-09-06T01:00:00.000Z')];
    };
    const registry = new RuntimeRegistry(local as never, remote as never);

    await expect(registry.listSessions('local-provider')).resolves.toMatchObject([
      { id: 'local-1', source: 'local-provider' },
    ]);
    expect(localCalls).toBe(1);
    expect(remoteCalls).toBe(0);

    await expect(registry.listSessions('remote-host')).resolves.toMatchObject([
      { id: 'remote-1', source: 'remote-host' },
    ]);
    expect(localCalls).toBe(1);
    expect(remoteCalls).toBe(1);
  });

  it('routes session deletion to the matching runtime only', async () => {
    const localDeletes: string[] = [];
    const remoteDeletes: string[] = [];
    const local = {
      ...runtime('local-provider', []),
      deleteSession: async (sessionId: string) => { localDeletes.push(sessionId); },
    };
    const remote = {
      ...runtime('remote-host', []),
      deleteSession: async (sessionId: string) => { remoteDeletes.push(sessionId); },
    };
    const registry = new RuntimeRegistry(local as never, remote as never);

    await registry.deleteSession('local-1', 'local-provider');
    await registry.deleteSession('remote-1', 'remote-host');
    await registry.deleteSession('local-looking-remote', 'remote-host');

    expect(localDeletes).toEqual(['local-1']);
    expect(remoteDeletes).toEqual(['remote-1', 'local-looking-remote']);
  });

  it('shows an empty list instead of a Remote failure with no Desktop pairing', async () => {
    const local = runtime('local-provider', []);
    const remote = runtime('remote-host', []) as ConversationRuntime;
    remote.listSessions = async () => {
      throw new RemoteHostError('PAIRING_REQUIRED', 'Not paired to Desktop');
    };
    const registry = new RuntimeRegistry(local as never, remote as never);

    await expect(registry.listSessions()).resolves.toEqual([]);
    await expect(registry.listSessions('remote-host')).rejects.toMatchObject({
      code: 'PAIRING_REQUIRED',
    });
  });

  it('does not hide genuine Local Provider storage failures when unpaired', async () => {
    const local = runtime('local-provider', []) as ConversationRuntime;
    const remote = runtime('remote-host', []) as ConversationRuntime;
    local.listSessions = async () => { throw new Error('local storage failed'); };
    remote.listSessions = async () => {
      throw new RemoteHostError('PAIRING_REQUIRED', 'Not paired to Desktop');
    };
    const registry = new RuntimeRegistry(local as never, remote as never);

    await expect(registry.listSessions()).rejects.toThrow('local storage failed');
  });

  it('still reports genuine Remote network errors with an empty local list', async () => {
    const local = runtime('local-provider', []);
    const remote = runtime('remote-host', []) as ConversationRuntime;
    remote.listSessions = async () => {
      throw new RemoteHostError('NETWORK_ERROR', 'Host offline');
    };
    const registry = new RuntimeRegistry(local as never, remote as never);

    await expect(registry.listSessions()).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('keeps the available source when the other source fails', async () => {
    const local = runtime('local-provider', [session('local-1', 'local-provider', '2026-09-06T02:00:00.000Z')]);
    const remote = runtime('remote-host', []) as ConversationRuntime;
    remote.listSessions = async () => { throw new Error('Host unavailable'); };
    const registry = new RuntimeRegistry(local as never, remote as never);

    await expect(registry.listSessions()).resolves.toMatchObject([{ id: 'local-1' }]);
  });
});
