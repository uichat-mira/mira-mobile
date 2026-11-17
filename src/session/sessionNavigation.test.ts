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

  it('opens Host Agent sessions with private workspace even when workspaceId is null', () => {
    expect(resolveSessionOpenTarget({
      workspaceId: null, agentEnabled: true, source: 'cloud-host',
    })).toEqual({ kind: 'chat' });
    expect(resolveSessionOpenTarget({
      workspaceId: '   ', agentEnabled: true, source: 'cloud-host',
    })).toEqual({ kind: 'chat' });
  });

  it('opens paired Agent sessions without a public project as direct chat', () => {
    // Desktop's current default-Agent thread has no public workspaceId; the Host
    // owns a private Agent workspace for it. Blocking that state made ordinary
    // Desktop conversations unusable on Mobile.
    expect(
      resolveSessionOpenTarget({ workspaceId: '   ', agentEnabled: true }),
    ).toEqual({ kind: 'chat' });
    expect(
      resolveSessionOpenTarget({
        workspaceId: null,
        agentEnabled: true,
        source: 'remote-host',
      }),
    ).toEqual({ kind: 'chat' });
  });
});
