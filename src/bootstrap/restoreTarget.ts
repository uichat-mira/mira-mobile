import type { LastOpenedSession } from '../session/lastOpenedSession';

/**
 * Whether a stored restore target can be confirmed gone.
 *
 * - `restore`: the session exists, or the authority that owns it cannot be
 *   reached right now. An unreachable Host must not be silently reinterpreted as
 *   "this session was deleted"; the restore intent is preserved and the existing
 *   chat error/retry path explains the connection problem instead.
 * - `drop`: the owning authority authoritatively reports the session is absent,
 *   so the app safely falls back to the session list.
 */
export type RestoreVerdict = 'restore' | 'drop';

/**
 * The startup restore decision only needs two authorities and one connectivity
 * fact. Keeping them injected keeps this module free of the app singletons and
 * makes every "gone / unreachable / listing failed" path directly testable.
 */
export interface RestoreTargetDeps {
  loadLastOpenedSession(): Promise<LastOpenedSession | null>;
  listLocalSessions(): Promise<{ id: string }[]>;
  listRemoteSessions(): Promise<{ id: string }[]>;
  isRemoteConnected(): boolean;
}

const listsSession = (
  sessions: { id: string }[],
  sessionId: string,
): boolean => sessions.some((session) => session.id === sessionId);

/**
 * Local sessions live on this device, so device storage is authoritative: an
 * absent id is dropped, and a listing failure is treated as "cannot confirm"
 * and also dropped, matching the existing local fallback behavior.
 */
export const resolveLocalRestoreVerdict = async (
  target: LastOpenedSession,
  deps: RestoreTargetDeps,
): Promise<RestoreVerdict> =>
  deps
    .listLocalSessions()
    .then((sessions) => (listsSession(sessions, target.sessionId) ? 'restore' : 'drop'))
    .catch(() => 'drop');

/**
 * Remote sessions are owned by the Host. Only a connected Host that can list
 * sessions is authoritative: if it lists them and the id is absent, the session
 * is genuinely gone. While the Host is reconnecting/unavailable, or when the
 * listing itself fails, the verdict is `restore` so the app still opens the
 * chat and lets the existing error/retry path surface the connection problem.
 */
export const resolveRemoteRestoreVerdict = async (
  target: LastOpenedSession,
  deps: RestoreTargetDeps,
): Promise<RestoreVerdict> => {
  if (!deps.isRemoteConnected()) return 'restore';

  return deps
    .listRemoteSessions()
    .then((sessions) => (listsSession(sessions, target.sessionId) ? 'restore' : 'drop'))
    .catch(() => 'restore');
};

/**
 * Resolves the cold-start restore target once, during bootstrap. Returns the
 * stored record when it can be restored, and null only when the owning authority
 * has authoritatively confirmed it no longer exists. This is the single decision
 * point for the "last session" launch behavior and must run before the navigator
 * commits its initial route.
 */
export const resolveRestoreTarget = async (
  deps: RestoreTargetDeps,
): Promise<LastOpenedSession | null> => {
  const lastOpened = await deps.loadLastOpenedSession().catch(() => null);
  if (!lastOpened) return null;

  const verdict =
    lastOpened.source === 'local-provider'
      ? await resolveLocalRestoreVerdict(lastOpened, deps)
      : await resolveRemoteRestoreVerdict(lastOpened, deps);

  return verdict === 'restore' ? lastOpened : null;
};
