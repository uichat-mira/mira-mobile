import type { Session } from '../types';
import type { RoleNameMap } from '../api/roleApi';
import { getSessionRoleName } from '../api/roleApi';
import { isThreadPinned, type ThreadPinMap } from '../store/threadPinning';
import { selectThreadUnread } from '../store/threadReadStore';
import type { ThreadReadMap } from '../store/threadReadState';

export interface SessionRowProjection {
  /** Host ownership metadata: true when the thread belongs to a Workspace. */
  belongsToWorkspace: boolean;
  pinned: boolean;
  unread: boolean;
  roleName: string | null;
}

const hasNonEmptyId = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Single owner of the device-local projection every session surface renders:
 * pin / unread state plus canonical Host ownership and role metadata.
 *
 * Surfaces keep their own layout and copy; they must not each re-derive
 * `belongsToWorkspace`, `isThreadPinned` or `selectThreadUnread`.
 */
export const projectSessionRow = (
  session: Session,
  pinMap: ThreadPinMap,
  readMap: ThreadReadMap,
  roleNames: RoleNameMap,
): SessionRowProjection => ({
  belongsToWorkspace: hasNonEmptyId(session.workspaceId),
  pinned: isThreadPinned(pinMap, session.id),
  unread: selectThreadUnread(readMap, session.id),
  roleName: getSessionRoleName(session, roleNames),
});

/**
 * Accessibility label shared by the session list, search results and drawer
 * rows. Keeps the visible device-local semantics (pinned / unread / workspace)
 * identical across surfaces while each surface stays free to render its own
 * visual affordances.
 */
export const buildSessionRowAccessibilityLabel = (
  session: Session,
  projection: SessionRowProjection,
  kindLabel: string,
): string =>
  `${kindLabel}：${session.title}` +
  `${projection.roleName ? `，角色${projection.roleName}` : ''}` +
  `${projection.belongsToWorkspace ? '，项目会话' : ''}` +
  `${projection.pinned ? '，已在本机置顶' : ''}` +
  `${projection.unread ? '，未读' : ''}`;
