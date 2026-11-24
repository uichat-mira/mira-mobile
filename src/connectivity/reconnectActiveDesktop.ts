import { remoteMiraHostClient } from '../api/remoteMiraHost';
import { cloudRemoteBusinessClient } from '../cloud/cloudRemoteBusiness';
import { useDesktopConnectionStore } from './desktopConnectionAuthority';

export const activeDesktopConnectionKey = () => {
  const { mode, generation } = useDesktopConnectionStore.getState();
  return mode === 'none' ? null : `${mode}:${generation}`;
};

/** Recover the selected transport only. An idle app must not open a Desktop
 * connection just because a credential or Cloud login is retained. */
export const reconnectActiveDesktop = async (
  deps = {
    direct: () => remoteMiraHostClient.restoreConnection() as Promise<unknown | null>,
    cloud: () => cloudRemoteBusinessClient.getManifest() as Promise<unknown | null>,
  },
): Promise<unknown | null> => {
  const { mode, transitioning } = useDesktopConnectionStore.getState();
  const key = activeDesktopConnectionKey();
  if (!key || transitioning) return null;
  const result = await (mode === 'direct' ? deps.direct() : deps.cloud());
  return activeDesktopConnectionKey() === key ? result : null;
};
