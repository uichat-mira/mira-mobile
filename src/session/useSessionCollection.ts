import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '../types';
import type { SessionSourceFilter } from '../runtime/runtimeRegistry';
import type { RemoteConnectionDiagnostic } from '../connectivity/remoteConnectionDiagnostics';
import {
  classifySessionCollectionFailure,
  loadSessionCollection,
} from './sessionCollection';

export interface UseSessionCollectionOptions {
  listSessions: (filter: SessionSourceFilter) => Promise<Session[]>;
  canDeleteRemoteSessions?: () => Promise<boolean>;
  syncUnreadSessions?: (sessions: Session[]) => Promise<void>;
  /** Hydrates device-local pin/read state before the collection is read. */
  hydrateLocalState?: () => Promise<void>;
  /** Defaults to true. SessionList disables this and drives reads from focus. */
  autoLoad?: boolean;
  filter?: SessionSourceFilter;
}

export interface SessionCollectionHandle {
  sessions: Session[];
  loading: boolean;
  diagnostic: RemoteConnectionDiagnostic | null;
  canDeleteSessions: boolean;
  /** Re-reads the collection, reusing the surface's current filter. */
  reload: () => Promise<void>;
  /** Drops a deleted session from the in-memory collection. */
  removeSession: (sessionId: string) => void;
}

/**
 * Owns the shared collection-loading lifecycle used by SessionList, Search and
 * Drawer: hydrate device-local state, read the Local / Remote collection,
 * classify failures into the shared Remote diagnostic and expose an in-place
 * reload. Surface-specific rendering, filtering and search stay with the UI.
 */
export const useSessionCollection = (
  options: UseSessionCollectionOptions,
): SessionCollectionHandle => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [diagnostic, setDiagnostic] =
    useState<RemoteConnectionDiagnostic | null>(null);
  const [canDeleteSessions, setCanDeleteSessions] = useState(false);
  const requestSequenceRef = useRef(0);

  // Keep the latest options in a ref so reload stays stable across renders
  // while still reading the surface's current filter and deps.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const reload = useCallback(async () => {
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    const current = optionsRef.current;
    setLoading(true);
    setDiagnostic(null);
    try {
      const snapshot = await loadSessionCollection({
        listSessions: current.listSessions,
        canDeleteRemoteSessions: current.canDeleteRemoteSessions,
        syncUnreadSessions: current.syncUnreadSessions,
        filter: current.filter,
      });
      if (requestSequence !== requestSequenceRef.current) return;
      setSessions(snapshot.sessions);
      setCanDeleteSessions(snapshot.canDeleteSessions);
    } catch (error) {
      if (requestSequence !== requestSequenceRef.current) return;
      setCanDeleteSessions(false);
      setDiagnostic(await classifySessionCollectionFailure(error));
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Read hydration through the ref so a caller that recreates the callback
  // (for example an inline `useCallback` with an unstable dep list) cannot
  // retrigger the collection load on every render. The mount effect is the
  // single load lifecycle; `reload` handles explicit refreshes.
  useEffect(() => {
    if (optionsRef.current.autoLoad === false) {
      return () => {
        requestSequenceRef.current += 1;
      };
    }

    let cancelled = false;
    (async () => {
      const hydrate = optionsRef.current.hydrateLocalState;
      if (hydrate) {
        await hydrate().catch(() => undefined);
      }
      if (cancelled) return;
      await reload();
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      requestSequenceRef.current += 1;
    };
  }, [reload]);

  const filter = options.filter ?? 'all';
  const previousFilterRef = useRef(filter);
  useEffect(() => {
    if (previousFilterRef.current === filter) return;
    previousFilterRef.current = filter;
    reload().catch(() => undefined);
  }, [filter, reload]);

  const removeSession = useCallback((sessionId: string) => {
    setSessions((current) => current.filter((item) => item.id !== sessionId));
  }, []);

  return {
    sessions,
    loading,
    diagnostic,
    canDeleteSessions,
    reload,
    removeSession,
  };
};
