import type { RemoteJsonRequest } from './remoteHttp';
import {
  buildRoleNameMap,
  getSessionRoleName,
  RoleApiClient,
} from './roleApi';
import { MemoryDeviceCredentialStore } from '../security/deviceCredentialStore';

type JsonTransport = <T>(request: RemoteJsonRequest<T>) => Promise<T>;

const pairedStore = async () => {
  const store = new MemoryDeviceCredentialStore();
  await store.save({
    hostUrl: 'https://mira.example.ts.net',
    credential: 'mira_device_device-1.secret',
    deviceId: 'device-1',
    scopes: ['threads:read'],
    savedAt: '2026-08-27T00:00:00.000Z',
  });
  return store;
};

describe('RoleApiClient', () => {
  it('reads the exact Mobile-safe role summary route', async () => {
    const store = await pairedStore();
    const seen: string[] = [];
    const direct: JsonTransport = async request => {
      seen.push(request.path);
      return request.parse([{ id: 'role-1', name: '产品搭档' }]);
    };
    const client = new RoleApiClient(store, direct);

    await expect(client.listRoleSummaries()).resolves.toEqual([
      { id: 'role-1', name: '产品搭档' },
    ]);
    expect(seen).toEqual(['/remote/v1/roles']);
  });

  it('rejects Desktop-internal role fields instead of copying them into Mobile', async () => {
    const store = await pairedStore();
    const direct: JsonTransport = async request =>
      request.parse([
        { id: 'role-1', name: '产品搭档', prompt: 'internal prompt' },
      ]);
    const client = new RoleApiClient(store, direct);

    await expect(client.listRoleSummaries()).rejects.toThrow(
      'unsupported fields',
    );
  });
});

describe('role name mapping', () => {
  const names = buildRoleNameMap([
    { id: 'role-1', name: '产品搭档' },
    { id: 'role-2', name: '研究助手' },
  ]);

  it('maps a thread roleId to the authoritative role name', () => {
    expect(
      getSessionRoleName(
        { agentEnabled: false, roleId: 'role-1' },
        names,
      ),
    ).toBe('产品搭档');
  });

  it('does not expose a raw id or invent a name when the role is missing', () => {
    expect(
      getSessionRoleName(
        { agentEnabled: false, roleId: 'role-missing' },
        names,
      ),
    ).toBeNull();
  });

  it('keeps Agent display priority over role metadata', () => {
    expect(
      getSessionRoleName(
        { agentEnabled: true, roleId: 'role-1' },
        names,
      ),
    ).toBeNull();
  });
});
