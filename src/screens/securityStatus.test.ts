import {
  MemoryDeviceCredentialStore,
  type DeviceCredentialStore,
} from '../security/deviceCredentialStore';
import {
  MemoryDesktopCredentialStore,
  type DesktopCredentialStore,
} from '../security/desktopCredentialStore';
import {
  MemoryProviderCredentialStore,
  type ProviderCredentialStore,
} from '../security/providerCredentialStore';
import {
  MemoryLocalKeyValueStore,
  localKeyValueStore as defaultLocalKeyValueStore,
  type LocalKeyValueStore,
} from '../storage/localKeyValueStore';
import { formatSavedAt, loadSecurityStatus, type SecurityStatus } from './securityStatus';

// We re-bind the default `deviceCredentialStore` / `desktopCredentialStore` /
// `providerCredentialStore` / `localKeyValueStore` module-level singletons to
// fresh Memory* instances so each test starts with an empty credential surface.
// The production code never sees these bindings, but the test does.
const setRemoteDeviceStore = (store: DeviceCredentialStore) => {
  const mod = require('../security/deviceCredentialStore') as typeof import('../security/deviceCredentialStore');
  (mod.deviceCredentialStore as unknown as DeviceCredentialStore) = store;
};
const setRemoteDesktopStore = (store: DesktopCredentialStore) => {
  const mod = require('../security/desktopCredentialStore') as typeof import('../security/desktopCredentialStore');
  (mod.desktopCredentialStore as unknown as DesktopCredentialStore) = store;
};
const setProviderStore = (store: ProviderCredentialStore) => {
  const mod = require('../security/providerCredentialStore') as typeof import('../security/providerCredentialStore');
  (mod.providerCredentialStore as unknown as ProviderCredentialStore) = store;
};
const setLocalKeyValueStore = (store: LocalKeyValueStore) => {
  const mod = require('../storage/localKeyValueStore') as typeof import('../storage/localKeyValueStore');
  (mod.localKeyValueStore as unknown as LocalKeyValueStore) = store;
};

describe('loadSecurityStatus', () => {
  afterEach(() => {
    setRemoteDeviceStore(new MemoryDeviceCredentialStore());
    setRemoteDesktopStore(new MemoryDesktopCredentialStore());
    setProviderStore(new MemoryProviderCredentialStore());
    setLocalKeyValueStore(new MemoryLocalKeyValueStore());
  });

  it('reports no remote host credential when store is empty', async () => {
    setRemoteDeviceStore(new MemoryDeviceCredentialStore());
    setRemoteDesktopStore(new MemoryDesktopCredentialStore());
    setProviderStore(new MemoryProviderCredentialStore());
    setLocalKeyValueStore(new MemoryLocalKeyValueStore());

    const status: SecurityStatus = await loadSecurityStatus();
    expect(status.remoteHost.available).toBe(false);
    expect(status.remoteHost.hostUrl).toBeNull();
    expect(status.desktopHost.available).toBe(false);
    expect(status.providers.total).toBe(0);
    expect(status.shiyan.available).toBe(false);
  });

  it('surfaces a stored remote host credential without leaking its secret', async () => {
    const deviceStore = new MemoryDeviceCredentialStore();
    setRemoteDeviceStore(deviceStore);
    setRemoteDesktopStore(new MemoryDesktopCredentialStore());
    setProviderStore(new MemoryProviderCredentialStore());
    setLocalKeyValueStore(new MemoryLocalKeyValueStore());

    await deviceStore.save({
      hostUrl: 'https://host.example.com',
      relay: null,
      credential: 'mira_device_super_secret',
      deviceId: 'dev-1',
      scopes: ['messages:read'],
      savedAt: '2026-09-01T00:00:00.000Z',
    });

    const status = await loadSecurityStatus();
    expect(status.remoteHost.available).toBe(true);
    expect(status.remoteHost.hostUrl).toBe('https://host.example.com');
    expect(status.remoteHost.savedAt).toBe('2026-09-01T00:00:00.000Z');
    // 聚合结果不能包含凭据字段，防止误用造成泄露
    expect(Object.keys(status.remoteHost)).toEqual(['available', 'hostUrl', 'savedAt']);
  });

  it('counts stored provider API keys without exposing them', async () => {
    const providerStore = new MemoryProviderCredentialStore();
    setRemoteDeviceStore(new MemoryDeviceCredentialStore());
    setRemoteDesktopStore(new MemoryDesktopCredentialStore());
    setProviderStore(providerStore);
    const kv = new MemoryLocalKeyValueStore();
    setLocalKeyValueStore(kv);

    await providerStore.save('prov-a', 'sk-test-A');
    await kv.set(
      'mira.local-provider.configs.v1',
      JSON.stringify([
        { id: 'prov-a', name: 'A', baseUrl: 'https://a.example.com', model: 'm', protocol: 'chat-completions' },
        { id: 'prov-b', name: 'B', baseUrl: 'https://b.example.com', model: 'm', protocol: 'chat-completions' },
      ]),
    );

    const status = await loadSecurityStatus();
    expect(status.providers.total).toBe(2);
    expect(status.providers.withApiKey).toBe(1);
    expect(status.providers.items.find((item) => item.id === 'prov-a')?.hasApiKey).toBe(true);
    expect(status.providers.items.find((item) => item.id === 'prov-b')?.hasApiKey).toBe(false);

    // 聚合结果不应泄露任何 Provider 凭据本身
    for (const item of status.providers.items) {
      expect(Object.keys(item)).toEqual(['id', 'name', 'baseUrl', 'hasApiKey']);
    }
  });

  it('marks desktop host credential as available when stored', async () => {
    const desktopStore = new MemoryDesktopCredentialStore();
    setRemoteDeviceStore(new MemoryDeviceCredentialStore());
    setRemoteDesktopStore(desktopStore);
    setProviderStore(new MemoryProviderCredentialStore());
    setLocalKeyValueStore(new MemoryLocalKeyValueStore());

    await desktopStore.save({
      hostUrl: 'https://desktop.example.com',
      token: 'jwt-placeholder',
      username: 'dang',
      savedAt: '2026-09-02T00:00:00.000Z',
    });

    const status = await loadSecurityStatus();
    expect(status.desktopHost.available).toBe(true);
    expect(status.desktopHost.username).toBe('dang');
    expect(status.desktopHost.hostUrl).toBe('https://desktop.example.com');
    expect('token' in status.desktopHost).toBe(false);
  });

  it('handles credential load failures by reporting unavailable', async () => {
    const failingDeviceStore: DeviceCredentialStore = {
      isAvailable: () => true,
      load: () => Promise.reject(new Error('storage corrupted')),
      save: () => Promise.reject(new Error('storage corrupted')),
      clear: () => Promise.resolve(),
    };
    setRemoteDeviceStore(failingDeviceStore);
    setRemoteDesktopStore(new MemoryDesktopCredentialStore());
    setProviderStore(new MemoryProviderCredentialStore());
    setLocalKeyValueStore(new MemoryLocalKeyValueStore());

    const status = await loadSecurityStatus();
    expect(status.remoteHost.available).toBe(false);
  });
});

describe('formatSavedAt', () => {
  const now = new Date('2026-09-16T12:00:00.000Z');
  it('returns null for invalid input', () => {
    expect(formatSavedAt(null, now)).toBeNull();
    expect(formatSavedAt('not-a-date', now)).toBeNull();
  });
  it('renders a recent save as 刚刚保存', () => {
    expect(formatSavedAt('2026-09-16T11:59:30.000Z', now)).toBe('刚刚保存');
  });
  it('renders minutes / hours / days / months', () => {
    expect(formatSavedAt('2026-09-16T11:30:00.000Z', now)).toBe('30 分钟前保存');
    expect(formatSavedAt('2026-09-16T09:00:00.000Z', now)).toBe('3 小时前保存');
    expect(formatSavedAt('2026-09-14T12:00:00.000Z', now)).toBe('2 天前保存');
    expect(formatSavedAt('2026-04-16T12:00:00.000Z', now)).toBe('5 个月前保存');
  });
});

// silence unused-import warning for defaultLocalKeyValueStore: keep the
// import referenced so future readers see that the production default singleton
// is the one module under test (other tests rebind it).
void defaultLocalKeyValueStore;