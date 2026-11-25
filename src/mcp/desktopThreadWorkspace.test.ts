import { RemoteHostError } from '../api/remoteHttp';
import {
  MemoryLocalKeyValueStore,
} from '../storage/localKeyValueStore';
import {
  DESKTOP_THREAD_WORKSPACE_STORAGE_KEY,
  DesktopThreadWorkspaceError,
  DesktopThreadWorkspaceRepository,
  DesktopThreadWorkspaceService,
  type DesktopThreadBinding,
} from './desktopThreadWorkspace';

const binding: DesktopThreadBinding = {
  threadId: 'local-thread-1',
  accountId: 'account-a',
  hostId: 'host-a',
  deviceId: 'mobile-device-a',
  generation: 7,
  boundAt: '2026-11-25T00:00:00.000Z',
};

const activeProjection = {
  threadId: 'local-thread-1',
  status: 'active' as const,
  workspace: {
    ref: 'mira-thread-workspace:remote-mcp-abc',
    kind: 'private' as const,
    available: true,
    startedAt: '2026-11-25 00:00:00',
  },
  startedAt: '2026-11-25 00:00:00',
  endedAt: null,
};

const endedProjection = {
  ...activeProjection,
  status: 'ended' as const,
  endedAt: '2026-11-25 00:00:10',
  stoppedInvocations: 1,
  stoppedTerminalSessions: 2,
};

const repositoryWith = async (value?: DesktopThreadBinding) => {
  const store = new MemoryLocalKeyValueStore();
  const repository = new DesktopThreadWorkspaceRepository(store);
  if (value) await repository.remember(value);
  return { store, repository };
};

describe('DesktopThreadWorkspaceRepository', () => {
  test('persists only routing identity and forgets one thread', async () => {
    const store = new MemoryLocalKeyValueStore();
    const repository = new DesktopThreadWorkspaceRepository(store);
    await repository.remember(binding);

    const reloaded = new DesktopThreadWorkspaceRepository(store);
    await expect(reloaded.get(binding.threadId)).resolves.toEqual(binding);
    const raw = await store.get(DESKTOP_THREAD_WORKSPACE_STORAGE_KEY);
    expect(raw).not.toContain('credential');
    expect(raw).not.toContain('workspace-ref');

    await reloaded.forget(binding.threadId);
    await expect(reloaded.get(binding.threadId)).resolves.toBeNull();
    await expect(store.get(DESKTOP_THREAD_WORKSPACE_STORAGE_KEY))
      .resolves.toBeNull();
  });

  test('fails closed on corrupted local records instead of losing a Host', async () => {
    const store = new MemoryLocalKeyValueStore();
    await store.set(DESKTOP_THREAD_WORKSPACE_STORAGE_KEY, '{not-json');
    const repository = new DesktopThreadWorkspaceRepository(store);
    await expect(repository.get(binding.threadId)).rejects.toMatchObject({ code: 'THREAD_BINDING_STORAGE_FAILED' });
  });
});

describe('DesktopThreadWorkspaceService', () => {
  test('reports not_started without a binding and never invents a directory', async () => {
    const { repository } = await repositoryWith();
    const makeClient = jest.fn();
    const service = new DesktopThreadWorkspaceService({
      repository,
      makeClient,
    });

    await expect(service.getWorkspace(binding.threadId)).resolves.toEqual({
      threadId: binding.threadId,
      status: 'not_started',
      workspace: null,
      startedAt: null,
      endedAt: null,
    });
    await expect(service.endThread(binding.threadId)).resolves.toEqual({
      kind: 'no_remote_work',
      threadId: binding.threadId,
    });
    expect(makeClient).not.toHaveBeenCalled();
  });

  test('reads the real projection from the bound Host and device', async () => {
    const { repository } = await repositoryWith(binding);
    const getThreadWorkspace = jest.fn(async () => activeProjection);
    const makeClient = jest.fn(() => ({
      getThreadWorkspace,
      endThreadWorkspace: jest.fn(),
    }));
    const service = new DesktopThreadWorkspaceService({
      repository,
      makeClient,
    });

    await expect(service.getWorkspace(binding.threadId))
      .resolves.toEqual(activeProjection);
    expect(makeClient).toHaveBeenCalledWith(binding);
    expect(getThreadWorkspace).toHaveBeenCalledWith(
      binding.threadId,
      binding.deviceId,
    );
  });

  test('concurrent first bindings cannot assign one thread to two Hosts', async () => {
    const { repository } = await repositoryWith();
    const service = new DesktopThreadWorkspaceService({ repository });
    const results = await Promise.allSettled([
      service.rememberBinding(binding),
      service.rememberBinding({ ...binding, hostId: 'host-b' }),
    ]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect((await repository.get(binding.threadId))?.hostId).toBe('host-a');
  });

  test('keeps a thread on its original account/Host/device', async () => {
    const { repository } = await repositoryWith(binding);
    const service = new DesktopThreadWorkspaceService({ repository });

    await expect(service.assertBindingCompatible({
      threadId: binding.threadId,
      accountId: binding.accountId,
      hostId: binding.hostId,
      deviceId: binding.deviceId,
    })).resolves.toBeUndefined();

    await expect(service.assertBindingCompatible({
      threadId: binding.threadId,
      accountId: binding.accountId,
      hostId: 'host-b',
      deviceId: binding.deviceId,
    })).rejects.toMatchObject({ code: 'THREAD_BINDING_CHANGED' });

    await expect(service.rememberBinding({
      threadId: binding.threadId,
      accountId: binding.accountId,
      hostId: 'host-b',
      deviceId: binding.deviceId,
      generation: 8,
    })).rejects.toMatchObject({ code: 'THREAD_BINDING_CHANGED' });
  });

  test('retains the original Host and confirmed end to locate retained results', async () => {
    const { repository } = await repositoryWith(binding);
    const endThreadWorkspace = jest.fn(async () => endedProjection);
    const service = new DesktopThreadWorkspaceService({
      repository,
      makeClient: () => ({
        getThreadWorkspace: jest.fn(),
        endThreadWorkspace,
      }),
    });

    await expect(service.endThread(binding.threadId)).resolves.toEqual({
      kind: 'ended',
      threadId: binding.threadId,
      projection: endedProjection,
    });
    expect(endThreadWorkspace).toHaveBeenCalledWith(
      binding.threadId,
      binding.deviceId,
    );
    await expect(repository.get(binding.threadId)).resolves.toEqual({ ...binding, endState: 'confirmed' });
    await expect(service.rememberBinding({ ...binding, generation: 8 })).rejects.toMatchObject({ code: 'THREAD_ALREADY_ENDING' });
  });

  test('keeps an unconfirmed end retryable and idempotent', async () => {
    const { repository } = await repositoryWith(binding);
    let attempt = 0;
    const endThreadWorkspace = jest.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new RemoteHostError(
          'thread_cleanup_incomplete',
          'cleanup still draining',
          409,
        );
      }
      return endedProjection;
    });
    const service = new DesktopThreadWorkspaceService({
      repository,
      makeClient: () => ({
        getThreadWorkspace: jest.fn(),
        endThreadWorkspace,
      }),
    });

    await expect(service.endThread(binding.threadId)).rejects.toMatchObject({
      code: 'THREAD_END_NOT_CONFIRMED',
    });
    await expect(repository.get(binding.threadId)).resolves.toEqual({ ...binding, endState: 'pending' });
    await expect(service.rememberBinding(binding)).rejects.toMatchObject({ code: 'THREAD_ALREADY_ENDING' });

    await expect(service.endThread(binding.threadId)).resolves.toMatchObject({
      kind: 'ended',
    });
    await expect(repository.get(binding.threadId)).resolves.toEqual({ ...binding, endState: 'confirmed' });
    expect(endThreadWorkspace).toHaveBeenCalledTimes(2);
  });

  test('does not claim a thread ended after a transport loss', async () => {
    const { repository } = await repositoryWith(binding);
    const service = new DesktopThreadWorkspaceService({
      repository,
      makeClient: () => ({
        getThreadWorkspace: jest.fn(),
        endThreadWorkspace: jest.fn(async () => {
          throw new RemoteHostError(
            'CLOUD_RELAY_HOST_OFFLINE',
            'Host offline',
          );
        }),
      }),
    });

    const error = await service.endThread(binding.threadId)
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(DesktopThreadWorkspaceError);
    expect(error).toMatchObject({
      code: 'THREAD_END_NOT_CONFIRMED',
      retryable: true,
    });
    await expect(repository.get(binding.threadId)).resolves.toEqual({ ...binding, endState: 'pending' });
  });

  test('surfaces workspace read failures as unavailable, not not_started', async () => {
    const { repository } = await repositoryWith(binding);
    const service = new DesktopThreadWorkspaceService({
      repository,
      makeClient: () => ({
        getThreadWorkspace: jest.fn(async () => {
          throw new RemoteHostError('CLOUD_RELAY_HOST_OFFLINE', 'Host offline');
        }),
        endThreadWorkspace: jest.fn(),
      }),
    });

    await expect(service.getWorkspace(binding.threadId)).rejects.toMatchObject({
      code: 'THREAD_WORKSPACE_UNAVAILABLE',
      retryable: true,
    });
  });
});
