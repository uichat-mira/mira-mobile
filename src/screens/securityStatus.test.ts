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
import { LocalKeyValueStore } from '../storage/localKeyValueStore';
import { formatSavedAt, loadSecurityStatus, type SecurityStatus } from './securityStatus';

class MemoryLocalKeyValueStore implements LocalKeyValueStore {
  private readonly values = new Map<string, string>();
  async get(key: string) {
    return this.values.has(key) ? (this.values.get(key) as string) : null;
  }
  async set(key: string, value: string) {
    this.values.set(key, value);
  }
  async remove(key: string) {
    this.values.delete(key);
  }
}

const installStores = () => {
  const deviceStore: DeviceCredentialStore = new MemoryDeviceCredentialStore();
  const desktopStore: DesktopCredentialStore = new MemoryDesktopCredentialStore();
  const providerStore: ProviderCredentialStore = new MemoryProviderCredentialStore();
  // 通过 jest.mock 的方式替换默认导出模块，下面 mutate the module cache.
  // 这里我们直接改写运行时单例：jest.mock 之外的方案是动态 require 并替换。
  // 为保持测试干净，我们仅在每个 case 内 monkey-patch 模块导出对象。
  return { deviceStore, desktopStore, providerStore };
};

// 由于模块使用具名导出单例，本文件采用 jest.mock 风格不便（jest 在 RN 中已启用）。
// 直接改写模块对象即可，运行时单例是 ES module 绑定。
const setRemoteDeviceStore = (store: DeviceCredentialStore) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../security/deviceCredentialStore') as typeof import('../security/deviceCredentialStore');
  (mod.deviceCredentialStore as unknown as DeviceCredentialStore) = store;
};
const setRemoteDesktopStore = (store: DesktopCredentialStore) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../security/desktopCredentialStore') as typeof import('../security/desktopCredentialStore');
  (mod.desktopCredentialStore as unknown as DesktopCredentialStore) = store;
};
const setProviderStore = (store: ProviderCredentialStore) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../security/providerCredentialStore') as typeof import('../security/providerCredentialStore');
  (mod.providerCredentialStore as unknown as ProviderCredentialStore) = store;
};

describe('loadSecurityStatus', () => {
  afterEach(() => {
    setRemoteDeviceStore(new MemoryDeviceCredentialStore());
    setRemoteDesktopStore(new MemoryDesktopCredentialStore());
    setProviderStore(new MemoryProviderCredentialStore());
  });

  it('reports no remote host credential when store is empty', async () => {
    const stores = installStores();
    setRemoteDeviceStore(stores.deviceStore);
    setRemoteDesktopStore(stores.desktopStore);
    setProviderStore(stores.providerStore);

    const status: SecurityStatus = await loadSecurityStatus();
    expect(status.remoteHost.available).toBe(false);
    expect(status.remoteHost.hostUrl).toBeNull();
    expect(status.desktopHost.available).toBe(false);
    expect(status.providers.total).toBe(0);
    expect(status.shiyan.available).toBe(false);
  });

  it('surfaces a stored remote host credential without leaking its secret', async () => {
    const stores = installStores();
    setRemoteDeviceStore(stores.deviceStore);
    setRemoteDesktopStore(stores.desktopStore);
    setProviderStore(stores.providerStore);

    await stores.deviceStore.save({
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
    const stores = installStores();
    setRemoteDeviceStore(stores.deviceStore);
    setRemoteDesktopStore(stores.desktopStore);
    setProviderStore(stores.providerStore);

    await stores.providerStore.save('prov-a', 'sk-test-A');
    // prov-b 故意不存
    // 直接写 local KV：仿照 ProviderConfigStore 的存储键
    const kv = new MemoryLocalKeyValueStore();
    await kv.set(
      'mira.local-provider.configs.v1',
      JSON.stringify([
        { id: 'prov-a', name: 'A', baseUrl: 'https://a.example.com', model: 'm', protocol: 'chat-completions' },
        { id: 'prov-b', name: 'B', baseUrl: 'https://b.example.com', model: 'm', protocol: 'chat-completions' },
      ]),
    );
    // 覆盖 localKeyValueStore 模块导出
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const kvMod = require('../storage/localKeyValueStore') as typeof import('../storage/localKeyValueStore');
    (kvMod.localKeyValueStore as unknown as LocalKeyValueStore) = kv;

    const status = await loadSecurityStatus();
    expect(status.providers.total).toBe(2);
    expect(status.providers.withApiKey).toBe(1);
    expect(status.providers.items.find((item) => item.id === 'prov-a')?.hasApiKey).toBe(true);
    expect(status.providers.items.find((item) => item.id === 'prov-b')?.hasApiKey).toBe(false);

    // 恢复默认 KV 单例，避免污染其它测试
    (kvMod.localKeyValueStore as unknown as LocalKeyValueStore) = new MemoryLocalKeyValueStore();
  });

  it('marks desktop host credential as available when stored', async () => {
    const stores = installStores();
    setRemoteDeviceStore(stores.deviceStore);
    setRemoteDesktopStore(stores.desktopStore);
    setProviderStore(stores.providerStore);

    await stores.desktopStore.save({
      hostUrl: 'https://desktop.example.com',
      token: 'jwt-placeholder',
      username: 'dang',
      savedAt: '2026-09-02T00:00:00.000Z',
    });

    const status = await loadSecurityStatus();
    expect(status.desktopHost.available).toBe(true);
    expect(status.desktopHost.username).toBe('dang');
    expect(status.desktopHost.hostUrl).toBe('https://desktop.example.com');
    // 不允许把 token 写入聚合结果
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