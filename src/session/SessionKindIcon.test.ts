import {
  getSessionVisualKind,
  getSessionVisualKindLabel,
} from './SessionKindIcon';

describe('session visual kind', () => {
  it('prioritizes Agent over role metadata', () => {
    const session = { agentEnabled: true, roleId: 'role-1' };
    expect(getSessionVisualKind(session)).toBe('agent');
    expect(getSessionVisualKindLabel(session)).toBe('Agent 对话');
  });

  it('uses role kind for a non-empty roleId', () => {
    const session = { agentEnabled: false, roleId: 'role-1' };
    expect(getSessionVisualKind(session)).toBe('role');
    expect(getSessionVisualKindLabel(session)).toBe('角色对话');
  });

  it('treats blank roleId as a normal chat', () => {
    const session = { agentEnabled: false, roleId: '   ' };
    expect(getSessionVisualKind(session)).toBe('chat');
    expect(getSessionVisualKindLabel(session)).toBe('普通对话');
  });

  it('defaults missing metadata to a normal chat', () => {
    expect(getSessionVisualKind({})).toBe('chat');
  });
});
