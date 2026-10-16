import { create } from 'zustand';
import type { AppRelease } from './appUpdate';
import {
  cancelUpdateDownload,
  downloadUpdate,
  installDownloadedUpdate,
  openInstallPermissionSettings,
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
  dismiss(): void;
}

/**
 * Only the newest run may write state. Cancelling, dismissing or restarting
 * bumps the run id so a late native callback from an abandoned run cannot
 * reopen the sheet or overwrite a newer progress value.
 */
let activeRun = 0;

export const useAppUpdateStore = create<AppUpdateState>()((set, get) => {
  const beginRun = (release: AppRelease): void => {
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

    void downloadUpdate(release, (progress) => {
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
    })
      .then((filePath) => {
        if (run !== activeRun) return;
        set((state) =>
          state.flow === null ? state : { flow: { ...state.flow, status: 'installing' } },
        );
        return installDownloadedUpdate(filePath, release.sha256).then(() => {
          if (run !== activeRun) return;
          set((state) =>
            state.flow === null
              ? state
              : { flow: { ...state.flow, status: 'handed-off' } },
          );
        });
      })
      .catch((error: unknown) => {
        if (run !== activeRun) return;
        const code = toAppUpdateError(error).code;
        if (code === 'UPDATE_CANCELLED') {
          set({ flow: null });
          return;
        }
        set((state) =>
          state.flow === null
            ? state
            : {
                flow: {
                  ...state.flow,
                  status:
                    code === 'UPDATE_PERMISSION_REQUIRED'
                      ? 'permission-required'
                      : 'failed',
                  errorMessage: updateInstallErrorMessage(error),
                },
              },
        );
      });
  };

  return {
    flow: null,

    start: (release) => {
      const { flow } = get();
      if (flow !== null && (flow.status === 'downloading' || flow.status === 'installing')) {
        return;
      }
      beginRun(release);
    },

    cancel: () => {
      const { flow } = get();
      if (flow === null) return;
      activeRun += 1;
      set({ flow: null });
      void cancelUpdateDownload();
    },

    retry: () => {
      const { flow } = get();
      if (flow === null) return;
      beginRun(flow.release);
    },

    openPermissionSettings: () => {
      void openInstallPermissionSettings().catch(() => {
        // The overlay already explains the permission; failing to open the
        // system page leaves the user exactly where they were.
      });
    },

    dismiss: () => {
      if (get().flow === null) return;
      activeRun += 1;
      set({ flow: null });
    },
  };
});
