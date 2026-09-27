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
  type LocalKeyValueStore,
} from '../storage/localKeyValueStore';
import { formatSavedAt, loadSecurityStatus, type SecurityStatus } from './securityStatus';

// 每个用例都用全新的 Memory* 单例替换模块级默认单例，保证互不污染。
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

const resetAll = () => {
  setRemoteDeviceStore(new MemoryDeviceCredentialStore());
  setRemoteDesktopStore(new MemoryDesktopCredentialStore());
  setProviderStore(new MemoryProviderCredentialStore());
  setLocalKeyValueStore(new MemoryLocalKeyValueStore());
};

describe('loadSecurityStatus', () => {
  afterEach(() => {
    resetAll();
  });

  it('reports nothing stored when every store is empty', async () => {
    resetAll();
    const status: SecurityStatus = await loadSecurityStatus();
    expect(status.remoteHost.available).toBe(false);
    expect(status.remoteHost.supported).toBe(true);
    expect(status.remoteHost.error).toBe(false);
    expect(status.remoteHost.hostUrl).toBeNull();
    expect(status.desktopHost.available).toBe(false);
    expect(status.providers.total).toBe(0);
    expect(status.providers.error).toBe(false);
    expect(status.providers.keyReadErrors).toBe(0);
    expect(status.shiyan.available).toBe(false);
    expect(status.hasError).toBe(false);
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
    // 聚合结果只允许这三态 + 非敏感元数据，绝不能含 token / credential 字段
    expect(Object.keys(status.remoteHost).sort()).toEqual(
      ['available', 'error', 'hostUrl', 'savedAt', 'supported'].sort(),
    );
  });

  it('distinguishes a read failure from "not saved"', async () => {
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
    expect(status.remoteHost.error).toBe(true);
    // 读取失败不能被当作"当前构建不支持"，也不能被当作"未保存"
    expect(status.remoteHost.supported).toBe(true);
    expect(status.hasError).toBe(true);
  });

  it('distinguishes an unsupported secure store from "not saved"', async () => {
    const unavailableDeviceStore: DeviceCredentialStore = {
      isAvailable: () => false,
      load: () => Promise.reject(new Error('not installed')),
      save: () => Promise.reject(new Error('not installed')),
      clear: () => Promise.reject(new Error('not installed')),
    };
    setRemoteDeviceStore(unavailableDeviceStore);
    setRemoteDesktopStore(new MemoryDesktopCredentialStore());
    setProviderStore(new MemoryProviderCredentialStore());
    setLocalKeyValueStore(new MemoryLocalKeyValueStore());

    const status = await loadSecurityStatus();
    expect(status.remoteHost.available).toBe(false);
    expect(status.remoteHost.supported).toBe(false);
    expect(status.remoteHost.error).toBe(false);
    // 没有安全存储不代表读取出错，不触发错误横幅
    expect(status.hasError).toBe(false);
  });

  it('counts stored provider API keys and flags per-provider read failures', async () => {
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

    const ok = await loadSecurityStatus();
    expect(ok.providers.total).toBe(2);
    expect(ok.providers.withApiKey).toBe(1);
    expect(ok.providers.error).toBe(false);
    expect(ok.providers.keyReadErrors).toBe(0);
    expect(ok.providers.items.find((item) => item.id === 'prov-a')?.hasApiKey).toBe(true);
    expect(ok.providers.items.find((item) => item.id === 'prov-b')?.hasApiKey).toBe(false);
    for (const item of ok.providers.items) {
      expect(Object.keys(item).sort()).toEqual(['baseUrl', 'hasApiKey', 'id', 'name'].sort());
    }

    // 让 prov-a 的 Key 读取抛错：必须单独计数、不得谎报"已保存"，也不得整段失败
    const failingProviderStore: ProviderCredentialStore = {
      isAvailable: () => true,
      load: (providerId: string) =>
        providerId === 'prov-a'
          ? Promise.reject(new Error('keychain unavailable'))
          : Promise.resolve(null),
      save: () => Promise.reject(new Error('keychain unavailable')),
      clear: () => Promise.resolve(),
    };
    setProviderStore(failingProviderStore);

    const degraded = await loadSecurityStatus();
    expect(degraded.providers.total).toBe(2);
    expect(degraded.providers.error).toBe(false);
    expect(degraded.providers.keyReadErrors).toBe(1);
    expect(degraded.providers.withApiKey).toBe(0);
    expect(degraded.hasError).toBe(true);
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
    expect(Object.keys(status.desktopHost).sort()).toEqual(
      ['available', 'error', 'hostUrl', 'savedAt', 'supported', 'username'].sort(),
    );
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
