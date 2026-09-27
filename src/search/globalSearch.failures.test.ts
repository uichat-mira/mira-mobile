import { RemoteHostError } from '../api/remoteHttp';
import type { ChatMessage, Session } from '../types';
import {
  GlobalSearchController,
  type GlobalSearchState,
} from './globalSearch';

const sessions: Session[] = [
  {
    id: 'a',
    title: '会话 A',
    updatedAt: new Date('2026-09-02T00:00:00.000Z'),
  },
  {
    id: 'b',
    title: '会话 B',
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  },
];

const waitForFinalState = async (states: GlobalSearchState[]) => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const state = states[states.length - 1];
  if (!state) throw new Error('search never emitted state');
  return state;
};

describe('GlobalSearchController failure evidence', () => {
  it('reports the original list failure for structured diagnostics', async () => {
    const states: GlobalSearchState[] = [];
    const failure = new RemoteHostError('NETWORK_ERROR', 'offline');
    const controller = new GlobalSearchController({
      listSessions: async () => {
        throw failure;
      },
      getMessages: async () => [],
      onStateChange: (state) => states.push(state),
    });

    controller.search('Mira');
    const state = await waitForFinalState(states);

    expect(state.status).toBe('failed');
    expect(state.error).toBe(failure);
  });

  it('reports a real message failure when every message read fails', async () => {
    const states: GlobalSearchState[] = [];
    const denied = new RemoteHostError('HTTP_403', 'forbidden', 403);
    const controller = new GlobalSearchController({
      listSessions: async () => sessions,
      getMessages: async () => {
        throw denied;
      },
      onStateChange: (state) => states.push(state),
    });

    controller.search('Mira');
    const state = await waitForFinalState(states);

    expect(state.status).toBe('failed');
    expect(state.error).toBe(denied);
    expect(state.messageMatches).toEqual([]);
  });

  it('keeps partial message-read failures degraded instead of failed', async () => {
    const states: GlobalSearchState[] = [];
    const controller = new GlobalSearchController({
      listSessions: async () => sessions,
      getMessages: async (sessionId): Promise<ChatMessage[]> => {
        if (sessionId === 'b') {
          throw new RemoteHostError('NETWORK_ERROR', 'temporary failure');
        }
        return [
          {
            id: 'm1',
            role: 'user',
            content: 'Mira',
            timestamp: new Date('2026-09-02T00:00:00.000Z'),
          },
        ];
      },
      onStateChange: (state) => states.push(state),
    });

    controller.search('Mira');
    const state = await waitForFinalState(states);

    expect(state.status).toBe('degraded');
    expect(state.error).toBeUndefined();
    expect(state.messageMatches.map((match) => match.message.id)).toEqual(['m1']);
  });
});
