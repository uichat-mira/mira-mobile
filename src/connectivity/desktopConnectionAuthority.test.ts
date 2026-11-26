import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import { useHostStore } from '../store/hostStore';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import { miraHostClient } from '../api/miraHostClient';
import { remoteMiraHostClient } from '../api/remoteMiraHost';
import { cloudRemoteBusinessClient } from '../cloud/cloudRemoteBusiness';
import {
  installDesktopConnectionLifecycle,
  restoreDesktopConnection,
  useDesktopConnectionStore,
} from './desktopConnectionAuthority';

const MODE_STORAGE_KEY = 'mira.mobile.desktopConnection.v1';

const resetAuthority = () => {
  useDesktopConnectionStore.setState({
    mode: 'none',
    generation: 0,
    hydrated: false,
    transitioning: false,
    message: null,
  });
};

const setSignedIn = () =>
  useCloudAccountStore.setState({
    status: 'signed_in',
    account: { id: 'account-a', username: 'alice' },
    initialized: true,
  });

const setSignedOut = () =>
  useCloudAccountStore.setState({
    status: 'signed_out',
    account: null,
    initialized: true,
  });

describe('Desktop connection authority', () => {
  beforeEach(() => {
    resetAuthority();
    useHostStore.setState({ config: null, connectionStatus: 'disconnected' });
    setSignedOut();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts with no active transport and does not infer one from credentials', async () => {
    const storage = new MemoryLocalKeyValueStore();
    setSignedIn();
    jest.spyOn(remoteMiraHostClient, 'isSecureStorageAvailable').mockReturnValue(true);
    const storedHost = jest
      .spyOn(remoteMiraHostClient, 'getStoredHostUrl')
      .mockResolvedValue('https://desktop.example.ts.net');

    await restoreDesktopConnection({ storage });

    expect(useDesktopConnectionStore.getState().mode).toBe('none');
    expect(useDesktopConnectionStore.getState().hydrated).toBe(true);
    expect(storedHost).not.toHaveBeenCalled();
  });

  it('restores Direct only when the explicit mode and its authorization both remain', async () => {
    const storage = new MemoryLocalKeyValueStore();
    await storage.set(MODE_STORAGE_KEY, 'direct');
    jest.spyOn(remoteMiraHostClient, 'isSecureStorageAvailable').mockReturnValue(true);
    jest
      .spyOn(remoteMiraHostClient, 'getStoredHostUrl')
      .mockResolvedValue('https://desktop.example.ts.net');

    await restoreDesktopConnection({ storage });

    expect(useDesktopConnectionStore.getState().mode).toBe('direct');

    resetAuthority();
    await storage.set(MODE_STORAGE_KEY, 'direct');
    jest
      .spyOn(remoteMiraHostClient, 'getStoredHostUrl')
      .mockResolvedValue(null);

    await restoreDesktopConnection({ storage });

    expect(useDesktopConnectionStore.getState().mode).toBe('none');
  });

  it('restores Cloud only from the persisted explicit mode, never from login', async () => {
    const storage = new MemoryLocalKeyValueStore();
    setSignedIn();
    const ensure = jest.fn(async () => undefined);

    await restoreDesktopConnection({ storage, ensureCloudInitialized: ensure });
    expect(useDesktopConnectionStore.getState().mode).toBe('none');

    resetAuthority();
    await storage.set(MODE_STORAGE_KEY, 'cloud');
    setSignedIn();
    await restoreDesktopConnection({ storage, ensureCloudInitialized: ensure });
    expect(useDesktopConnectionStore.getState().mode).toBe('cloud');

    resetAuthority();
    await storage.set(MODE_STORAGE_KEY, 'cloud');
    setSignedOut();
    await restoreDesktopConnection({ storage, ensureCloudInitialized: ensure });
    expect(useDesktopConnectionStore.getState().mode).toBe('none');

    resetAuthority();
    await storage.set(MODE_STORAGE_KEY, 'cloud');
    useCloudAccountStore.setState({
      status: 'cloud_unavailable',
      account: { id: 'account-a', username: 'alice' },
      initialized: true,
    });
    await restoreDesktopConnection({ storage, ensureCloudInitialized: ensure });
    expect(useDesktopConnectionStore.getState().mode).toBe('cloud');
  });

  it('releases the old transport before activating Direct and keeps both authorizations', async () => {
    const storage = new MemoryLocalKeyValueStore();
    useHostStore.setState({
      config: { hostUrl: 'https://desktop.example.ts.net', token: '' },
      connectionStatus: 'connected',
    });
    setSignedIn();
    useDesktopConnectionStore.setState({ mode: 'cloud', hydrated: true });
    const resetCloud = jest
      .spyOn(cloudRemoteBusinessClient, 'reset')
      .mockImplementation(() => undefined);

    await expect(
      useDesktopConnectionStore.getState().activateDirect(storage),
    ).resolves.toBe(true);

    expect(resetCloud).toHaveBeenCalledTimes(1);
    expect(useDesktopConnectionStore.getState().mode).toBe('direct');
    expect(await storage.get(MODE_STORAGE_KEY)).toBe('direct');
    // Cloud login is independent from the transport switch.
    expect(useCloudAccountStore.getState().status).toBe('signed_in');
    useHostStore.setState({
      config: { hostUrl: 'https://desktop.example.ts.net', token: '' },
    });
  });

  it('activates Cloud without logging out or revoking Direct', async () => {
    const storage = new MemoryLocalKeyValueStore();
    useHostStore.setState({
      config: { hostUrl: 'https://desktop.example.ts.net', token: '' },
      connectionStatus: 'connected',
    });
    setSignedIn();
    useDesktopConnectionStore.setState({ mode: 'direct', hydrated: true });
    const cancelDirect = jest
      .spyOn(miraHostClient, 'cancelCurrentSend')
      .mockImplementation(() => undefined);

    await expect(
      useDesktopConnectionStore.getState().activateCloud(storage),
    ).resolves.toBe(true);

    expect(cancelDirect).toHaveBeenCalledTimes(1);
    expect(useDesktopConnectionStore.getState().mode).toBe('cloud');
    expect(await storage.get(MODE_STORAGE_KEY)).toBe('cloud');
    expect(useHostStore.getState().config).not.toBeNull();
  });

  it('refuses Cloud activation while signed out without changing the mode', async () => {
    const storage = new MemoryLocalKeyValueStore();
    useDesktopConnectionStore.setState({ mode: 'direct', hydrated: true });

    await expect(
      useDesktopConnectionStore.getState().activateCloud(storage),
    ).resolves.toBe(false);

    expect(useDesktopConnectionStore.getState().mode).toBe('direct');
    expect(await storage.get(MODE_STORAGE_KEY)).toBeNull();
  });

  it('disconnects locally without clearing Cloud or Direct authorization', async () => {
    const storage = new MemoryLocalKeyValueStore();
    setSignedIn();
    useHostStore.setState({
      config: { hostUrl: 'https://desktop.example.ts.net', token: '' },
    });
    useDesktopConnectionStore.setState({ mode: 'cloud', hydrated: true });
    jest
      .spyOn(cloudRemoteBusinessClient, 'reset')
      .mockImplementation(() => undefined);

    await useDesktopConnectionStore.getState().disconnect(storage);

    expect(useDesktopConnectionStore.getState().mode).toBe('none');
    expect(await storage.get(MODE_STORAGE_KEY)).toBe('none');
    expect(useCloudAccountStore.getState().status).toBe('signed_in');
    expect(useHostStore.getState().config?.hostUrl).toBe(
      'https://desktop.example.ts.net',
    );
  });

  it('lets the latest explicit activation win over a superseded Direct restore', async () => {
    const storage = new MemoryLocalKeyValueStore();
    setSignedIn();
    jest.spyOn(remoteMiraHostClient, 'isSecureStorageAvailable').mockReturnValue(true);
    let resolveHost!: (value: string | null) => void;
    const storedHost = new Promise<string | null>(resolve => {
      resolveHost = resolve;
    });
    jest
      .spyOn(remoteMiraHostClient, 'getStoredHostUrl')
      .mockReturnValue(storedHost);

    const direct = useDesktopConnectionStore.getState().activateDirect(storage);
    await Promise.resolve();
    const cloud = await useDesktopConnectionStore.getState().activateCloud(storage);
    resolveHost('https://desktop.example.ts.net');

    await expect(direct).resolves.toBe(false);
    expect(cloud).toBe(true);
    expect(useDesktopConnectionStore.getState().mode).toBe('cloud');
    expect(useDesktopConnectionStore.getState().transitioning).toBe(false);
    expect(await storage.get(MODE_STORAGE_KEY)).toBe('cloud');
  });

  it('deactivates Cloud when the account session is lost instead of falling back', async () => {
    installDesktopConnectionLifecycle();
    setSignedIn();
    useDesktopConnectionStore.setState({ mode: 'cloud', hydrated: true });

    useCloudAccountStore.setState({ status: 'signed_out', account: null });
    await Promise.resolve();

    expect(useDesktopConnectionStore.getState().mode).toBe('none');
    expect(useHostStore.getState().config).toBeNull();
  });
});
