import React from 'react';
import { Bot, MessageSquare, UserRound } from 'lucide-react-native';
import type { Session } from '../types';

export type SessionVisualKind = 'chat' | 'role' | 'agent';

type SessionKindSource = Pick<Session, 'agentEnabled' | 'roleId'>;

export const getSessionVisualKind = (
  session: SessionKindSource,
): SessionVisualKind => {
  if (session.agentEnabled === true) return 'agent';
  if (typeof session.roleId === 'string' && session.roleId.trim().length > 0) {
    return 'role';
  }
  return 'chat';
};

export const getSessionVisualKindLabel = (
  session: SessionKindSource,
): string => {
  switch (getSessionVisualKind(session)) {
    case 'agent':
      return 'Agent 对话';
    case 'role':
      return '角色对话';
    default:
      return '普通对话';
  }
};

interface SessionKindIconProps {
  session: SessionKindSource;
  color: string;
  size?: number;
  strokeWidth?: number;
}

export function SessionKindIcon({
  session,
  color,
  size = 20,
  strokeWidth = 1.8,
}: SessionKindIconProps) {
  const kind = getSessionVisualKind(session);
  const Icon = kind === 'agent' ? Bot : kind === 'role' ? UserRound : MessageSquare;

  return <Icon size={size} color={color} strokeWidth={strokeWidth} />;
}
