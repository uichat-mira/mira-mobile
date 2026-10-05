import { getWorkspaceDetailContractError } from './workspaceDetailState';

describe('workspaceDetailState', () => {
  it('requires authoritative workspace id and name', () => {
    expect(getWorkspaceDetailContractError('', 'Project')).toBeTruthy();
    expect(getWorkspaceDetailContractError('workspace-1', '   ')).toBeTruthy();
    expect(getWorkspaceDetailContractError('workspace-1', 'Project')).toBeNull();
  });
});
