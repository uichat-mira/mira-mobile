import type { ConnectionStatus } from '../types';
import {
  DEFAULT_GENERAL_SETTINGS,
  type GeneralSettings,
} from '../settings/generalSettings';
import type { LastOpenedSession } from '../session/lastOpenedSession';
import { classifyAvailableUpdate, type AppRelease } from '../update/appUpdate';
import type { SemverVersion } from '../update/semver';

/**
 * The single committed output of a cold start. `hasDeviceCredential` decides the
 * connectivity state, never entry permission. A Local Provider user must
 * reach SessionList without Desktop pairing. `restoreTarget` is the one-shot
 * Chat target SessionList consumes on first focus.
 */
export interface AppBootstrapResult {
  hasDeviceCredential: boolean;
  restoreTarget: LastOpenedSession | null;
}

/**
 * Every effect the startup sequence needs, injected so the ordering and failure
 * isolation can be exercised without React, native storage or the network.
 */
export interface AppBootstrapDeps {
  isSecureStorageAvailable(): boolean;
  loadDeviceCredential(): Promise<unknown | null>;
  restoreConnection(): Promise<unknown | null>;
  setConnectionStatus(status: ConnectionStatus): void;
  loadGeneralSettings(): Promise<GeneralSettings>;
  resolveRestoreTarget(): Promise<LastOpenedSession | null>;
  fetchLatestRelease(): Promise<AppRelease | null>;
  parseCurrentVersion(): SemverVersion | null;
  presentUpdatePrompt(latest: AppRelease): void;
}

const promptUpdateIfNeeded = async (
  deps: AppBootstrapDeps,
  isCancelled: () => boolean,
): Promise<void> => {
  // The prompt must never fire for an unmounted tree, so bootstrap's own
  // cancellation flag also guards this alert.
  const latest = await deps.fetchLatestRelease().catch(() => null);
  if (isCancelled() || !latest) return;

  // Only major/minor bumps interrupt the user. A patch-only release is
  // quiet-notified through the About badge (same source of truth) and must not
  // auto-prompt. A broken installed semver is treated as "cannot decide" rather
  // than silently as no update.
  const current = deps.parseCurrentVersion();
  if (!current) return;

  const level = classifyAvailableUpdate(current, latest);
  if (level === 'major' || level === 'minor') {
    deps.presentUpdatePrompt(latest);
  }
};

/**
 * Runs the cold-start sequence once and resolves the initial navigation inputs.
 *
 * Ordering is a behavior contract: connection restore → settings hydration →
 * last-opened restore → automatic update check. Each step is failure-isolated so
 * a single failure cannot block an unrelated startup path, and the function
 * never rejects: an unexpected failure still commits whatever was resolved so
 * the navigator can mount instead of being stranded on a blank tree.
 */
export const runAppBootstrap = async (
  deps: AppBootstrapDeps,
  isCancelled: () => boolean = () => false,
): Promise<AppBootstrapResult> => {
  let hasDeviceCredential = false;
  let restoreTarget: LastOpenedSession | null = null;
  const snapshot = (): AppBootstrapResult => ({ hasDeviceCredential, restoreTarget });

  try {
    // Remote pairing is optional; local restoration and updates still run.
    if (!deps.isSecureStorageAvailable()) {
      deps.setConnectionStatus('disconnected');
    } else {
      let stored: unknown | null = null;
      try {
        stored = await deps.loadDeviceCredential();
      } catch {
        stored = null;
      }
      if (isCancelled()) return snapshot();

      if (!stored) {
        deps.setConnectionStatus('disconnected');
      } else {
        hasDeviceCredential = true;
        try {
          const restored = await deps.restoreConnection();
          if (isCancelled()) return snapshot();
          const connected = restored != null;
          hasDeviceCredential = connected;
          deps.setConnectionStatus(connected ? 'connected' : 'disconnected');
        } catch {
          if (isCancelled()) return snapshot();
          hasDeviceCredential = true;
          deps.setConnectionStatus('reconnecting');
        }
      }
    }
    if (isCancelled()) return snapshot();

    const settings = await deps.loadGeneralSettings().catch(() => DEFAULT_GENERAL_SETTINGS);
    if (isCancelled()) return snapshot();

    if (settings.launchBehavior === 'last-session') {
      restoreTarget = await deps.resolveRestoreTarget().catch(() => null);
      if (isCancelled()) return snapshot();
    }

    if (settings.autoCheckUpdates) {
      await promptUpdateIfNeeded(deps, isCancelled);
    }
  } catch {
    // Defensive: a bootstrap step must never reject and strand the navigator.
  }

  return snapshot();
};
