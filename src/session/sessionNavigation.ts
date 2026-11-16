import type { Session } from '../types';

export type SessionOpenTarget =
  | { kind: 'chat'; cloudLegacyAgentReadOnly?: true }
  | { kind: 'workspace-list' }
  | { kind: 'contract-error'; message: string };

const hasNonEmptyId = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Global session entry points open the selected Thread directly. workspaceId is
 * ownership/context metadata, not a navigation parent. Agent sessions are the
 * only exception: Host contract requires them to own a valid Workspace.
 *
 * `workspace-list` stays in the target union temporarily for callers compiled
 * against the older navigation contract, but this resolver no longer emits it.
 */
export const resolveSessionOpenTarget = (
  session: Pick<Session, 'workspaceId' | 'agentEnabled' | 'source'>,
): SessionOpenTarget => {
  if (
    session.agentEnabled === true &&
    session.source !== 'local-provider' &&
    !hasNonEmptyId(session.workspaceId)
  ) {
    // Cloud legacy Agent history may be read; the missing Workspace still
    // forbids Agent execution and all future messages on this thread.
    if (session.source === 'cloud-host') {
      return { kind: 'chat', cloudLegacyAgentReadOnly: true };
    }
    return {
      kind: 'contract-error',
      message: '该 Agent 会话缺少项目归属，无法在移动端打开。',
    };
  }

  return { kind: 'chat' };
};
