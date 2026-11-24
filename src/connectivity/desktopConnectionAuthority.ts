import { create } from 'zustand';
import { miraHostClient } from '../api/miraHostClient';
import { RemoteHostError } from '../api/remoteHttp';
import { remoteMiraHostClient } from '../api/remoteMiraHost';
import { cloudRemoteBusinessClient } from '../cloud/cloudRemoteBusiness';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import {
  localKeyValueStore,
  type LocalKeyValueStore,
} from '../storage/localKeyValueStore';
import { useHostStore } from '../store/hostStore';
import type { ConnectionStatus } from '../types';

/**
 * The one Mobile authority for the active Desktop remote connection.
 *
 * This is deliberately not a second connection registry: retained
 * authorization still lives in the existing secure credential / Cloud Session
 * stores, and transient health still lives in the existing Tailscale / Cloud
 * stores. This module answers a single question: which transport is currently
 * allowed to execute new Desktop work.
 */
export type DesktopConnectionMode = 'none' | 'direct' | 'cloud';

export interface DesktopConnectionState {
  mode: DesktopConnectionMode;
  /** Increments on every committed mode change; late async results compare it. */
  generation: number;
  hydrated: boolean;
  transitioning: boolean;
  cloudConnectionStatus: ConnectionStatus;
  message: string | null;
  restore: (deps?: DesktopConnectionRestoreDeps) => Promise<void>;
  activateDirect: (storage?: LocalKeyValueStore) => Promise<boolean>;
  activateCloud: (storage?: LocalKeyValueStore) => Promise<boolean>;
  disconnect: (storage?: LocalKeyValueStore) => Promise<void>;
}

export interface DesktopConnectionRestoreDeps {
  storage?: LocalKeyValueStore;
  /** Whether a retained Tailscale Direct authorization exists. */
  hasDirectAuthorization?: () => Promise<boolean>;
  ensureCloudInitialized?: () => Promise<void>;
}

const MODE_STORAGE_KEY = 'mira.mobile.desktopConnection.v1';

// Persisted values are a user intent, never an authorization. A restored Direct
// mode still requires a stored device credential and a restored Cloud mode still
// requires a restored Cloud session.
const parseStoredMode = (value: string | null): DesktopConnectionMode =>
  value === 'direct' || value === 'cloud' ? value : 'none';

let activationSequence = 0;
let restorePromise: Promise<void> | null = null;

const readStoredMode = async (
  storage: LocalKeyValueStore,
): Promise<DesktopConnectionMode> => {
  try {
    return parseStoredMode(await storage.get(MODE_STORAGE_KEY));
  } catch {
    // An unreadable preference must not invent an active transport.
    return 'none';
  }
};

const modeWrites = new WeakMap<LocalKeyValueStore, Promise<void>>();
const persistMode = async (
  storage: LocalKeyValueStore,
  mode: DesktopConnectionMode,
): Promise<void> => {
  try {
    const previous = modeWrites.get(storage) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => storage.set(MODE_STORAGE_KEY, mode));
    modeWrites.set(storage, next);
    await next;
  } catch {
    // The in-memory authority stays correct for this session. On next launch
    // the user is asked again instead of an unverified mode being inferred.
  }
};

/**
 * Locally detaches the previous transport before a new one becomes active.
 * Credentials are never revoked here; the other long-term authorization stays
 * usable for a later explicit switch. Mutations already sent are never replayed.
 */
const releaseTransport = (mode: DesktopConnectionMode): void => {
  if (mode === 'cloud') {
    // Closing the Relay generation also invalidates in-flight Cloud business
    // calls, Agent observations and tool invocations.
    cloudRemoteBusinessClient.reset();
    return;
  }
  if (mode === 'direct') {
    // A paired request has no long-lived socket to keep open; stop the active
    // chat stream so its late result cannot be presented under the new mode.
    miraHostClient.cancelCurrentSend();
  }
};

const hasStoredDirectAuthorization = async (): Promise<boolean> => {
  if (!remoteMiraHostClient.isSecureStorageAvailable()) return false;
  try {
    return Boolean(await remoteMiraHostClient.getStoredHostUrl());
  } catch {
    return false;
  }
};

const hasCloudAuthorization = (): boolean => {
  const state = useCloudAccountStore.getState();
  return state.status === 'signed_in' && state.account !== null;
};

const hasRetainedCloudAuthorization = (): boolean => {
  const state = useCloudAccountStore.getState();
  return (
    (state.status === 'signed_in' || state.status === 'cloud_unavailable') &&
    state.account !== null
  );
};

export const useDesktopConnectionStore = create<DesktopConnectionState>(
  (set, get) => ({
    mode: 'none',
    generation: 0,
    hydrated: false,
    transitioning: false,
    cloudConnectionStatus: 'disconnected',
    message: null,

    restore: async (deps = {}) => {
      if (get().hydrated) return;
      if (restorePromise) return restorePromise;

      restorePromise = (async () => {
        const sequence = activationSequence;
        const storage = deps.storage ?? localKeyValueStore;
        const storedMode = await readStoredMode(storage);
        let mode: DesktopConnectionMode = 'none';

        if (storedMode === 'direct') {
          const authorized = deps.hasDirectAuthorization
            ? await deps.hasDirectAuthorization()
            : await hasStoredDirectAuthorization();
          // Keep the explicit intent only while its authorization still exists.
          mode = authorized ? 'direct' : 'none';
        } else if (storedMode === 'cloud') {
          if (deps.ensureCloudInitialized) {
            await deps.ensureCloudInitialized();
          } else {
            await useCloudAccountStore.getState().initialize();
          }
          // Login is independent from transport activation: only the persisted
          // explicit Cloud mode may restore Cloud. Never infer it from account.
          // A transient outage that still retains the account keeps the explicit
          // mode; a rejected/absent session does not.
          mode = hasRetainedCloudAuthorization() ? 'cloud' : 'none';
        }

        if (sequence !== activationSequence) {
          set({ hydrated: true });
          return;
        }
        set({
          mode,
          generation: ++activationSequence,
          hydrated: true,
          transitioning: false,
          message: null,
        });
      })();

      try {
        await restorePromise;
      } finally {
        restorePromise = null;
      }
    },

    activateDirect: async (storage = localKeyValueStore) => {
      const sequence = ++activationSequence;
      set({ transitioning: true, message: null });

      const configured = Boolean(useHostStore.getState().config);
      if (!configured && !remoteMiraHostClient.isSecureStorageAvailable()) {
        set({
          transitioning: false,
          message: '当前构建无法安全读取桌面配对凭据。',
        });
        return false;
      }
      const authorized = configured || (await hasStoredDirectAuthorization());
      // A newer explicit activation owns the result; do not release its
      // transport from this superseded call.
      if (sequence !== activationSequence) {
        return false;
      }
      if (!authorized) {
        set({
          transitioning: false,
          message: '尚未配对 Mira Desktop，无法启用 Tailscale 直连。',
        });
        return false;
      }

      const previous = get().mode;
      releaseTransport(previous);

      set({
        mode: 'direct',
        generation: sequence,
        transitioning: false,
        message: null,
      });
      await persistMode(storage, 'direct');
      return true;
    },

    activateCloud: async (storage = localKeyValueStore) => {
      if (!hasCloudAuthorization()) {
        set({ message: '请先登录 Mira Cloud 账号，再启用 Cloud 桌面连接。' });
        return false;
      }

      const sequence = ++activationSequence;
      const previous = get().mode;
      set({ transitioning: true, message: null });
      releaseTransport(previous);

      if (sequence !== activationSequence) return false;

      set({
        mode: 'cloud',
        cloudConnectionStatus: 'connecting',
        generation: sequence,
        transitioning: false,
        message: null,
      });
      await persistMode(storage, 'cloud');
      return true;
    },

    disconnect: async (storage = localKeyValueStore) => {
      const sequence = ++activationSequence;
      const previous = get().mode;
      set({ transitioning: true, message: null });
      releaseTransport(previous);

      if (sequence !== activationSequence) return;

      set({
        mode: 'none',
        cloudConnectionStatus: 'disconnected',
        generation: sequence,
        transitioning: false,
        message: null,
      });
      await persistMode(storage, 'none');
    },
  }),
);

/** Restores only the last explicitly active mode, after authorization checks. */
export const restoreDesktopConnection = (deps?: DesktopConnectionRestoreDeps) =>
  useDesktopConnectionStore.getState().restore(deps);

/**
 * Runtime gate for a new Desktop operation. Reading retained history stays
 * allowed; executing new remote work must match the active transport.
 */
export const assertDesktopConnectionActive = (
  expected: 'direct' | 'cloud',
): void => {
  const state = useDesktopConnectionStore.getState();
  if (state.mode === expected && !state.transitioning) return;
  throw new RemoteHostError(
    'DESKTOP_CONNECTION_INACTIVE',
    expected === 'direct'
      ? 'Tailscale 直连桌面连接未启用，请先在连接入口启用。'
      : 'Mira Cloud 桌面连接未启用，请先在连接入口启用。',
    409,
  );
};

/**
 * Cloud login remains independent from transport. Losing the Cloud session
 * deactivates Cloud Relay without falling back to Direct or touching Direct
 * credentials; a transient Cloud outage keeps the explicit Cloud mode.
 */
let lifecycleInstalled = false;
export const installDesktopConnectionLifecycle = (): void => {
  if (lifecycleInstalled) return;
  lifecycleInstalled = true;
  useCloudAccountStore.subscribe((state, previous) => {
    if (useDesktopConnectionStore.getState().mode !== 'cloud') return;
    const lostAuthorization =
      state.status === 'signed_out' ||
      state.status === 'session_rejected' ||
      state.status === 'device_revoked';
    const accountChanged =
      previous.account?.id !== state.account?.id && state.account !== null;
    if (lostAuthorization || accountChanged) {
      void useDesktopConnectionStore.getState().disconnect();
    }
  });
};
