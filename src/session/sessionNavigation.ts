import type { Session } from '../types';

export type SessionOpenTarget =
  | { kind: 'chat' }
  | { kind: 'workspace-list' }
  | { kind: 'contract-error'; message: string };

/**
 * Global session entry points open the selected Thread directly. workspaceId is
 * ownership/context metadata, not a navigation parent.
 *
 * A Host Agent thread without a public `workspaceId` is a normal current state:
 * the Host provisions an isolated private Agent workspace for it and keeps that
 * workspace off the Remote contract. Mobile therefore must not treat a missing
 * project as a contract error, otherwise default-Agent conversations created on
 * Desktop become unopenable on Mobile.
 *
 * `workspace-list` and `contract-error` stay in the target union so existing
 * callers keep compiling, but this resolver no longer emits either of them.
 */
export const resolveSessionOpenTarget = (
  _session: Pick<Session, 'workspaceId' | 'agentEnabled' | 'source'>,
): SessionOpenTarget => ({ kind: 'chat' });
