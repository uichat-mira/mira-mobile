import type { SessionSourceFilter } from '../runtime/runtimeRegistry';

/** Route the one remote choice by the user's current source, not a stale pairing. */
export const resolveRemoteCreateSource = (
  selected: SessionSourceFilter,
  cloudSignedIn: boolean,
): 'cloud-host' | 'remote-host' => {
  if (selected === 'cloud-host') return 'cloud-host';
  if (selected === 'remote-host') return 'remote-host';
  return cloudSignedIn ? 'cloud-host' : 'remote-host';
};
