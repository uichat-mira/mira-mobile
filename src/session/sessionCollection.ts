import type { Session } from '../types';
import { RemoteHostError } from '../api/remoteHttp';
import {
  classifySessionLoadFailure,
  type RemoteConnectionDiagnostic,
} from '../connectivity/remoteConnectionDiagnostics';
import type { SessionSourceFilter } from '../runtime/runtimeRegistry';

export type SessionCollectionState = 'loading' | 'error' | 'empty' | 'data';

export const resolveSessionCollectionState = (
  loading: boolean,
  errorMessage: string | null,
  itemCount: number,
): SessionCollectionState => {
  // Previously loaded sessions remain useful, safe local UI data while a
  // refresh is running or has failed. A transient Remote failure must not
  // replace them with a full-screen loading/error state.
  if (itemCount > 0) return 'data';
  if (loading) return 'loading';
  if (errorMessage) return 'error';
  return 'empty';
};

/**
 * Legacy message helper kept for screens outside the MOB-035's Remote diagnostic
 * migration. SessionList, Drawer and Search use structured diagnostics instead.
 */
export const getSessionLoadErrorMessage = (error: unknown): string => {
  if (error instanceof RemoteHostError) {
    if (error.status === 401) {
      return '设备认证已失效，请重新连接 Mira Host';
    }
    if (error.status === 403) {
      return '当前设备没有读取会话的权限';
    }
    if (error.status === 404) {
      return '目标会话或项目不存在，或当前设备无法访问';
    }
    if (error.code === 'NETWORK_ERROR') {
      return '无法连接 Mira Host，请检查网络后重试';
    }
  }

  return '无法加载会话，请稍后重试';
};

/**
 * Maps any session collection failure to the shared structured Remote
 * diagnostic. This is the single owner of "collection failure -> actionable
 * diagnostic" so the list, search and drawer surfaces no longer each decide
 * which errors are retryable, credential or permission problems.
 */
export const classifySessionCollectionFailure = (
  error: unknown,
): Promise<RemoteConnectionDiagnostic> => classifySessionLoadFailure(error);

export interface SessionCollectionDeps {
  listSessions: (filter: SessionSourceFilter) => Promise<Session[]>;
  /**
   * Reports whether the Remote Host currently allows deleting sessions.
   * Absent for local-provider-only reads, where delete capability is always
   * derived from the local runtime instead.
   */
  canDeleteRemoteSessions?: () => Promise<boolean>;
  /** Observes unread progress for Remote sessions. Local sessions are skipped. */
  syncUnreadSessions?: (sessions: Session[]) => Promise<void>;
  filter?: SessionSourceFilter;
}

export interface SessionCollectionSnapshot {
  sessions: Session[];
  canDeleteSessions: boolean;
}

/**
 * Reads a Local / Remote session collection and applies the minimal shared
 * projection: local delete capability, unread observation and failure
 * classification. Surface-specific ordering, grouping and filtering stay with
 * each UI surface.
 */
export const loadSessionCollection = async (
  deps: SessionCollectionDeps,
): Promise<SessionCollectionSnapshot> => {
  const filter = deps.filter ?? 'all';
  const remoteSessionsEnabled = filter !== 'local-provider';
  const [list, canDelete] = await Promise.all([
    deps.listSessions(filter),
    remoteSessionsEnabled && deps.canDeleteRemoteSessions
      ? deps.canDeleteRemoteSessions().catch(() => false)
      : Promise.resolve(false),
  ]);

  if (deps.syncUnreadSessions) {
    deps
      .syncUnreadSessions(
        list.filter((session) => session.source !== 'local-provider'),
      )
      .catch(() => undefined);
  }

  return { sessions: list, canDeleteSessions: canDelete };
};
