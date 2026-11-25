/**
 * Remote Thread Workspace V1 projection.
 *
 * Desktop owns the workspace lifecycle and exposes only an opaque locator.
 * Mobile must never infer a real directory from a thread id or local state.
 */

export const REMOTE_THREAD_CONTEXT_HEADER = 'X-Mira-Thread-Id';

export type RemoteThreadWorkspaceStatus = 'not_started' | 'active' | 'ended';

export interface RemoteThreadWorkspaceTarget {
  /** Opaque Desktop locator; never an absolute filesystem path. */
  ref: string;
  kind: 'private';
  available: boolean;
  startedAt: string | null;
}

export interface RemoteThreadWorkspaceProjection {
  threadId: string;
  status: RemoteThreadWorkspaceStatus;
  workspace: RemoteThreadWorkspaceTarget | null;
  startedAt: string | null;
  endedAt: string | null;
  /** Present on an explicit end response. */
  stoppedInvocations?: number;
  stoppedTerminalSessions?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const requiredString = (
  value: Record<string, unknown>,
  key: string,
  owner: string,
): string => {
  const field = value[key];
  if (typeof field !== 'string' || field.length === 0) {
    throw new Error(`${owner}.${key} must be a non-empty string`);
  }
  return field;
};

const nullableString = (
  value: Record<string, unknown>,
  key: string,
  owner: string,
): string | null => {
  const field = value[key];
  if (field === null) return null;
  if (typeof field !== 'string') {
    throw new Error(`${owner}.${key} must be a string or null`);
  }
  return field;
};

const optionalCount = (
  value: Record<string, unknown>,
  key: string,
): number | undefined => {
  const field = value[key];
  if (field === undefined) return undefined;
  if (typeof field !== 'number' || !Number.isInteger(field) || field < 0) {
    throw new Error(`threadWorkspace.${key} must be a non-negative integer`);
  }
  return field;
};

const parseStatus = (value: unknown): RemoteThreadWorkspaceStatus => {
  if (value === 'not_started' || value === 'active' || value === 'ended') {
    return value;
  }
  throw new Error('Unsupported remote thread workspace status');
};

const parseTarget = (
  value: unknown,
): RemoteThreadWorkspaceTarget | null => {
  if (value === null) return null;
  if (!isRecord(value)) {
    throw new Error('threadWorkspace.workspace must be an object or null');
  }
  if (value.kind !== 'private') {
    throw new Error('Unsupported remote thread workspace kind');
  }
  if (typeof value.available !== 'boolean') {
    throw new Error('threadWorkspace.workspace.available must be a boolean');
  }
  return {
    ref: requiredString(value, 'ref', 'threadWorkspace.workspace'),
    kind: 'private',
    available: value.available,
    startedAt: nullableString(value, 'startedAt', 'threadWorkspace.workspace'),
  };
};

export const parseRemoteThreadWorkspace = (
  value: unknown,
): RemoteThreadWorkspaceProjection => {
  if (!isRecord(value)) {
    throw new Error('Remote thread workspace must be an object');
  }
  const stoppedInvocations = optionalCount(value, 'stoppedInvocations');
  const stoppedTerminalSessions = optionalCount(
    value,
    'stoppedTerminalSessions',
  );
  return {
    threadId: requiredString(value, 'threadId', 'threadWorkspace'),
    status: parseStatus(value.status),
    workspace: parseTarget(value.workspace),
    startedAt: nullableString(value, 'startedAt', 'threadWorkspace'),
    endedAt: nullableString(value, 'endedAt', 'threadWorkspace'),
    ...(stoppedInvocations !== undefined ? { stoppedInvocations } : {}),
    ...(stoppedTerminalSessions !== undefined
      ? { stoppedTerminalSessions }
      : {}),
  };
};
