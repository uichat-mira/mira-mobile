import { create } from 'zustand';
import type { AppRelease } from './appUpdate';
import {
  UPDATE_PERMISSION_MESSAGE,
  canInstallPackages,
  cancelUpdateDownload,
  confirmUpdateInstallation,
  downloadUpdate,
  installDownloadedUpdate,
  isInAppUpdateSupported,
  openInstallPermissionSettings,
  observeUpdateInstallFailures,
  observeUpdateInstallConfirmations,
  type UpdateInstallFailure,
  toAppUpdateError,
  updateInstallErrorMessage,
} from './appUpdateInstall';

/**
 * User-visible position of one in-app update run. `handed-off` means the system
 * installer now owns the flow; the app cannot observe its result, so the UI must
 * say so instead of claiming the update finished.
 */
export type AppUpdateFlowStatus =
  | 'downloading'
  | 'installing'
  | 'handed-off'
  | 'confirmation-required'
  | 'permission-required'
  | 'failed';

export interface AppUpdateFlow {
  release: AppRelease;
  status: AppUpdateFlowStatus;
  receivedBytes: number;
  totalBytes: number | null;
  errorMessage: string | null;
}

interface AppUpdateState {
  flow: AppUpdateFlow | null;
  start(release: AppRelease): void;
  cancel(): void;
  retry(): void;
  openPermissionSettings(): void;
  confirmInstall(): void;
  dismiss(): void;
}

/**
 * Only the newest run may write state. Cancelling, dismissing or restarting
 * bumps the run id so a late native callback from an abandoned run cannot
 * reopen the sheet or overwrite a newer progress value.
 */
let activeRun = 0;
let activeInstallFailureListener: { remove(): void } | null = null;
let activeInstallConfirmationListener: { remove(): void } | null = null;
let activeInstallSessionId: number | null = null;
const stopListeningForInstallEvents = (): void => {
  activeInstallFailureListener?.remove();
  activeInstallConfirmationListener?.remove();
  activeInstallFailureListener = null;
  activeInstallConfirmationListener = null;
};

export const useAppUpdateStore = create<AppUpdateState>()((set, get) => {
  const markStopped = (
    run: number,
    status: AppUpdateFlowStatus,
    message: string,
  ): void => {
    if (run !== activeRun) return;
    set((state) =>
      state.flow === null ? state : { flow: { ...state.flow, status, errorMessage: message } },
    );
  };

  const beginRun = (release: AppRelease): void => {
    stopListeningForInstallEvents();
    activeInstallSessionId = null;
    activeRun += 1;
    const run = activeRun;

    set({
      flow: {
        release,
        status: 'downloading',
        receivedBytes: 0,
        totalBytes: null,
        errorMessage: null,
      },
    });

    void (async () => {
      // A previous native transfer has to be fully torn down first: the native
      // module refuses a concurrent download, so a retry issued while the
      // abandoned thread is still winding down would fail spuriously.
      await cancelUpdateDownload();
      if (run !== activeRun) return;

      // Asking for install consent up front avoids fetching tens of megabytes
      // only to stop at the installer's own permission gate.
      if (isInAppUpdateSupported() && !(await canInstallPackages())) {
        if (run !== activeRun) return;
        markStopped(run, 'permission-required', UPDATE_PERMISSION_MESSAGE);
        return;
      }
      if (run !== activeRun) return;

      try {
        const filePath = await downloadUpdate(release, (progress) => {
          if (run !== activeRun) return;
          set((state) =>
            state.flow === null || state.flow.status !== 'downloading'
              ? state
              : {
                  flow: {
                    ...state.flow,
                    receivedBytes: progress.receivedBytes,
                    totalBytes: progress.totalBytes,
                  },
                },
          );
        });
        if (run !== activeRun) return;
        set((state) =>
          state.flow === null ? state : { flow: { ...state.flow, status: 'installing' } },
        );

        let sessionId: number | null = null;
        const earlyFailures: UpdateInstallFailure[] = [];
        const earlyConfirmations: number[] = [];
        activeInstallConfirmationListener = observeUpdateInstallConfirmations((confirmationId) => {
          if (run !== activeRun) return;
          if (sessionId === null) {
            if (earlyConfirmations.length < 4) earlyConfirmations.push(confirmationId);
            return;
          }
          if (confirmationId !== sessionId) return;
          set((state) =>
            state.flow === null || state.flow.status === 'failed'
              ? state
              : { flow: { ...state.flow, status: 'confirmation-required' } },
          );
        });
        activeInstallFailureListener = observeUpdateInstallFailures((failure) => {
          if (run !== activeRun) return;
          if (sessionId === null) {
            // The native callback can precede the install() Promise result.
            if (earlyFailures.length < 4) earlyFailures.push(failure);
            return;
          }
          if (failure.sessionId !== sessionId) return;
          stopListeningForInstallEvents();
          markStopped(run, 'failed', failure.message);
        });
        sessionId = await installDownloadedUpdate(filePath, release.sha256);
        if (run !== activeRun) return;
        activeInstallSessionId = sessionId;
        const earlyFailure = earlyFailures.find((failure) => failure.sessionId === sessionId);
        if (earlyFailure !== undefined) {
          stopListeningForInstallEvents();
          markStopped(run, 'failed', earlyFailure.message);
        } else {
          const needsConfirmation = earlyConfirmations.includes(sessionId);
          set((state) =>
            state.flow === null ? state : {
              flow: {
                ...state.flow,
                status: needsConfirmation ? 'confirmation-required' : 'handed-off',
              },
            },
          );
        }
      } catch (error) {
        if (run !== activeRun) return;
        stopListeningForInstallEvents();
        const code = toAppUpdateError(error).code;
        if (code === 'UPDATE_CANCELLED') {
          set({ flow: null });
          return;
        }
        markStopped(
          run,
          code === 'UPDATE_PERMISSION_REQUIRED' ? 'permission-required' : 'failed',
          updateInstallErrorMessage(error),
        );
      }
    })();
  };

  return {
    flow: null,

    start: (release) => {
      const { flow } = get();
      if (flow !== null && (flow.status === 'downloading' || flow.status === 'installing' || flow.status === 'confirmation-required')) {
        return;
      }
      beginRun(release);
    },

    cancel: () => {
      const { flow } = get();
      if (flow === null) return;
      stopListeningForInstallEvents();
      activeInstallSessionId = null;
      activeRun += 1;
      set({ flow: null });
      void cancelUpdateDownload();
    },

    retry: () => {
      const { flow } = get();
      if (flow === null) return;
      beginRun(flow.release);
    },

    confirmInstall: () => {
      const { flow } = get();
      const sessionId = activeInstallSessionId;
      if (flow?.status !== 'confirmation-required' || sessionId === null) return;
      const run = activeRun;
      set({ flow: { ...flow, status: 'installing' } });
      void confirmUpdateInstallation(sessionId).then(() => {
        if (run !== activeRun) return;
        set((state) =>
          state.flow?.status !== 'installing'
            ? state
            : { flow: { ...state.flow, status: 'handed-off' } },
        );
      }).catch((error: unknown) => {
        markStopped(run, 'failed', updateInstallErrorMessage(error));
      });
    },

    openPermissionSettings: () => {
      void openInstallPermissionSettings().catch(() => {
        // The overlay already explains the permission; failing to open the
        // system page leaves the user exactly where they were.
      });
    },

    dismiss: () => {
      if (get().flow === null) return;
      stopListeningForInstallEvents();
      activeInstallSessionId = null;
      activeRun += 1;
      set({ flow: null });
    },
  };
});
