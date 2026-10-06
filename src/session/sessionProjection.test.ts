import type { Session } from '../types';
import type { RoleNameMap } from '../api/roleApi';
import type { ThreadPinMap } from '../store/threadPinning';
import type { ThreadReadMap } from '../store/threadReadState';
import {
  buildSessionRowAccessibilityLabel,
  projectSessionRow,
} from './sessionProjection';

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 'thread-1',
  title: '会话标题',
  updatedAt: new Date('2026-08-28T00:00:00.000Z'),
  ...overrides,
});

describe('projectSessionRow', () => {
  it('projects workspace ownership, pin and unread from their true owners', () => {
    const pins: ThreadPinMap = { 'thread-1': '2026-08-28T00:00:00.000Z' };
    const reads: ThreadReadMap = {
      'thread-1': {
        observedMessageCount: 3,
        latestContentMessageId: 'm3',
        latestContentAt: '2026-08-28T00:09:00.000Z',
      },
    };
    const roleNames: RoleNameMap = {};

    expect(
      projectSessionRow(
        session({ workspaceId: 'workspace-1' }),
        pins,
        reads,
        roleNames,
      ),
    ).toEqual({
      belongsToWorkspace: true,
      pinned: true,
      unread: true,
      roleName: null,
    });
  });

  it('treats blank workspace ids as non-workspace sessions', () => {
    expect(
      projectSessionRow(session({ workspaceId: '   ' }), {}, {}, {}),
    ).toEqual({
      belongsToWorkspace: false,
      pinned: false,
      unread: false,
      roleName: null,
    });
  });

  it('does not surface a role name for Agent sessions', () => {
    const roleNames: RoleNameMap = { 'role-1': '助手' };

    expect(
      projectSessionRow(
        session({ roleId: 'role-1', agentEnabled: true }),
        {},
        {},
        roleNames,
      ).roleName,
    ).toBeNull();
  });

  it('resolves a role name for role sessions', () => {
    const roleNames: RoleNameMap = { 'role-1': '助手' };

    expect(
      projectSessionRow(session({ roleId: 'role-1' }), {}, {}, roleNames).roleName,
    ).toBe('助手');
  });
});

describe('buildSessionRowAccessibilityLabel', () => {
  it('keeps pinned / unread / workspace semantics visible across surfaces', () => {
    const label = buildSessionRowAccessibilityLabel(
      session({ title: '需求评审' }),
      {
        belongsToWorkspace: true,
        pinned: true,
        unread: true,
        roleName: '助手',
      },
      '普通对话',
    );

    expect(label).toBe('普通对话：需求评审，角色助手，项目会话，已在本机置顶，未读');
  });

  it('omits optional device-local and ownership hints when absent', () => {
    const label = buildSessionRowAccessibilityLabel(
      session({ title: '闲聊' }),
      {
        belongsToWorkspace: false,
        pinned: false,
        unread: false,
        roleName: null,
      },
      '普通对话',
    );

    expect(label).toBe('普通对话：闲聊');
  });
});
