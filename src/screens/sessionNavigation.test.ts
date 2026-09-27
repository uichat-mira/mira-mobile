import { resolveSessionOpenTarget } from './sessionNavigation';

describe('resolveSessionOpenTarget', () => {
  it('opens ordinary sessions directly in chat', () => {
    expect(
      resolveSessionOpenTarget({ workspaceId: null, agentEnabled: false }),
    ).toEqual({ kind: 'chat' });
  });

  it('keeps role sessions without workspace ownership as direct chat', () => {
    expect(
      resolveSessionOpenTarget({ workspaceId: undefined, agentEnabled: null }),
    ).toEqual({ kind: 'chat' });
  });

  it('opens workspace-owned sessions directly in chat', () => {
    expect(
      resolveSessionOpenTarget({ workspaceId: 'workspace-1', agentEnabled: false }),
    ).toEqual({ kind: 'chat' });
  });

  it('opens valid workspace-owned Agent sessions directly in chat', () => {
    expect(
      resolveSessionOpenTarget({ workspaceId: 'workspace-agent', agentEnabled: true }),
    ).toEqual({ kind: 'chat' });
  });

  it('opens local Agent sessions without Remote workspace ownership', () => {
    expect(
      resolveSessionOpenTarget({
        workspaceId: null,
        agentEnabled: true,
        source: 'local-provider',
      }),
    ).toEqual({ kind: 'chat' });
  });

  it('rejects Agent sessions that violate the workspace ownership contract', () => {
    expect(
      resolveSessionOpenTarget({ workspaceId: '   ', agentEnabled: true }),
    ).toEqual({
      kind: 'contract-error',
      message: '该 Agent 会话缺少项目归属，无法在移动端打开。',
    });
  });
});
