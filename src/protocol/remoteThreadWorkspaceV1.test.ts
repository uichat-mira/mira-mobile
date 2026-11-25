import { parseRemoteThreadWorkspace } from './remoteThreadWorkspaceV1';

describe('Remote Thread Workspace V1 parser', () => {
  test('parses the real not_started projection without inventing a directory', () => {
    expect(parseRemoteThreadWorkspace({
      threadId: 'local-thread-1',
      status: 'not_started',
      workspace: null,
      startedAt: null,
      endedAt: null,
    })).toEqual({
      threadId: 'local-thread-1',
      status: 'not_started',
      workspace: null,
      startedAt: null,
      endedAt: null,
    });
  });

  test('parses an active opaque workspace and the explicit end counters', () => {
    const projection = parseRemoteThreadWorkspace({
      threadId: 'local-thread-1',
      status: 'ended',
      workspace: {
        ref: 'mira-thread-workspace:remote-mcp-abc',
        kind: 'private',
        available: true,
        startedAt: '2026-11-25 00:00:00',
      },
      startedAt: '2026-11-25 00:00:00',
      endedAt: '2026-11-25 00:00:10',
      stoppedInvocations: 1,
      stoppedTerminalSessions: 2,
    });

    expect(projection.status).toBe('ended');
    expect(projection.workspace).toEqual({
      ref: 'mira-thread-workspace:remote-mcp-abc',
      kind: 'private',
      available: true,
      startedAt: '2026-11-25 00:00:00',
    });
    expect(projection.stoppedInvocations).toBe(1);
    expect(projection.stoppedTerminalSessions).toBe(2);
  });

  test('rejects malformed or foreign workspace shapes', () => {
    expect(() => parseRemoteThreadWorkspace({
      threadId: 'local-thread-1',
      status: 'creating',
      workspace: null,
      startedAt: null,
      endedAt: null,
    })).toThrow('Unsupported remote thread workspace status');

    expect(() => parseRemoteThreadWorkspace({
      threadId: 'local-thread-1',
      status: 'active',
      workspace: {
        ref: '/Users/secret/real/path',
        kind: 'shared',
        available: true,
        startedAt: null,
      },
      startedAt: null,
      endedAt: null,
    })).toThrow('Unsupported remote thread workspace kind');

    expect(() => parseRemoteThreadWorkspace({
      threadId: 'local-thread-1',
      status: 'ended',
      workspace: null,
      startedAt: null,
      endedAt: null,
      stoppedInvocations: -1,
    })).toThrow('non-negative integer');
  });
});
