import { useEffect } from 'react';
import {
  installDesktopConnectionLifecycle,
  restoreDesktopConnection,
} from './desktopConnectionAuthority';

/**
 * Runs once per app process after Cloud account restore begins. Restore is
 * intentionally explicit-intent-only: already retained credentials alone never
 * activate a Desktop transport.
 */
export const useDesktopConnectionBootstrap = (): void => {
  useEffect(() => {
    installDesktopConnectionLifecycle();
    void restoreDesktopConnection().catch(() => undefined);
  }, []);
};
