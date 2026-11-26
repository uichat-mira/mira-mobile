import { NativeModules } from 'react-native';
import { NativeDeviceCredentialStore, type StoredDeviceCredential } from './deviceCredentialStore';

const service = 'io.tomz.mira.mobile.remote-device';
const direct: StoredDeviceCredential = {
  hostUrl: 'https://desktop.example.ts.net',
  credential: 'device-secret',
  deviceId: 'device-1',
  scopes: ['threads:read'],
  savedAt: '2026-08-02T00:00:00.000Z',
};
const legacyRelay = { endpoint: 'https://relay.example.test', relayId: 'old-room', token: 'old-secret' };

describe('retire legacy paired Relay credentials', () => {
  let raw: string | null;
  const native = {
    get: jest.fn(async (_service: string) => raw),
    set: jest.fn(async (_service: string, value: string) => { raw = value; }),
    remove: jest.fn(async (_service: string) => { raw = null; }),
  };
  const previous = NativeModules.MiraSecureCredentialStore;
  beforeEach(() => {
    jest.clearAllMocks();
    raw = null;
    NativeModules.MiraSecureCredentialStore = native;
  });
  afterAll(() => { NativeModules.MiraSecureCredentialStore = previous; });

  it('rewrites a mixed record to retain Direct identity and erase Relay token', async () => {
    raw = JSON.stringify({ ...direct, relay: legacyRelay });
    const store = new NativeDeviceCredentialStore();
    await expect(store.load()).resolves.toEqual(direct);
    expect(native.set).toHaveBeenCalledWith(service, JSON.stringify(direct));
    expect(raw).not.toContain('old-secret');
    await expect(store.load()).resolves.toEqual(direct);
    expect(native.set).toHaveBeenCalledTimes(1);
  });

  it('removes Relay-only pairing instead of making a Cloud connection', async () => {
    raw = JSON.stringify({ ...direct, hostUrl: null, relay: legacyRelay });
    const store = new NativeDeviceCredentialStore();
    await expect(store.load()).resolves.toBeNull();
    expect(native.remove).toHaveBeenCalledWith(service);
    expect(raw).toBeNull();
  });

  it('does not resurrect a pairing when clear races with migration', async () => {
    raw = JSON.stringify({ ...direct, relay: legacyRelay });
    const store = new NativeDeviceCredentialStore();
    await Promise.all([store.load(), store.clear()]);
    expect(raw).toBeNull();
    await expect(store.load()).resolves.toBeNull();
  });
});
