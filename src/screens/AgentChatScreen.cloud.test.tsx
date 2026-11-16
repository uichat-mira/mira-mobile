import React from 'react';
import { AppState } from 'react-native';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { AgentChatScreen } from './AgentChatScreen';

const mockRoute = {
  params: {
    sessionId: 'thread-1', title: 'Cloud Agent',
    source: 'cloud-host', cloudAccountId: 'account-a',
  },
};
let mockCloudState = {
  status: 'signed_in',
  account: { id: 'account-a' },
};
const mockRun = {
  id: 'run-1', threadId: 'thread-1', userId: 1,
  status: 'waiting_approval',
  traceId: 'trace-1', createdAt: '2026-11-16T00:00:00.000Z',
  updatedAt: '2026-11-16T00:00:00.000Z',
  pendingApproval: {
    id: 'approval-1', runId: 'run-1', stepId: 'step-1',
    toolId: 'terminal_session', reason: 'Confirm', createdAt: '2026-11-16T00:00:00.000Z',
  },
};
const mockCloudClient = {
  getSession: jest.fn(async () => ({ agentEnabled: true })),
  getMessages: jest.fn(async () => [{
    id: 'message-1', role: 'assistant', content: 'Ready',
    metadata: { agent: { runId: 'run-1' } },
    timestamp: new Date('2026-11-16T00:00:00.000Z'),
  }]),
};
const mockPairedClient = {
  getSession: jest.fn(async () => ({ agentEnabled: true })),
  getMessages: jest.fn(async () => []),
  subscribeMessageSnapshots: jest.fn(() => () => undefined),
};
const mockHostRunClient = {
  getManifest: jest.fn(async () => ({
    device: { scopes: ['agent:read', 'agent:approve', 'agent:control'] },
    routes: {
      agent: ['GET /agent/runs/:runId',
        'POST /agent/runs/:runId/approve',
        'POST /agent/runs/:runId/reject',
        'POST /agent/runs/:runId/cancel'],
    },
  })),
  getAgentRun: jest.fn(async () => mockRun),
  approveAgentRun: jest.fn(async () => ({ ...mockRun, status: 'running' })),
  rejectAgentRun: jest.fn(async () => ({ ...mockRun, status: 'blocked' })),
  cancelAgentRun: jest.fn(async () => ({ ...mockRun, status: 'cancelled' })),
};

jest.mock('@react-navigation/native', () => ({
  useRoute: () => mockRoute,
  useFocusEffect: (effect: () => (() => void) | undefined) => {
    const ReactActual = jest.requireActual('react') as typeof import('react');
    ReactActual.useEffect(effect, [effect]);
  },
}));
jest.mock('../cloud/cloudAccountStore', () => ({
  useCloudAccountStore: (selector: (state: typeof mockCloudState) => unknown) =>
    selector(mockCloudState),
}));
jest.mock('../cloud/cloudHostAgentRunClient', () => ({
  CloudHostAgentRunClient: jest.fn().mockImplementation(() => mockHostRunClient),
}));
jest.mock('../runtime/runtimeRegistry', () => ({
  runtimeRegistry: { get cloud() { return mockCloudClient; } },
}));
jest.mock('../api/miraHostClient', () => ({
  get miraHostClient() { return mockPairedClient; },
}));
jest.mock('./ChatScreen', () => ({
  ChatScreen: () => null,
}));
jest.mock('../session/lastOpenedSession', () => ({
  saveLastOpenedSession: jest.fn(async () => undefined),
}));
jest.mock('../agent/AgentRunApprovalCard', () => ({
  AgentRunApprovalCard: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual('react') as typeof import('react');
    return ReactActual.createElement('MockAgentApprovalCard', props);
  },
}));

describe('AgentChatScreen Cloud source routing', () => {
  let tree: ReactTestRenderer | undefined;
  beforeEach(() => {
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  });
  afterEach(async () => {
    if (tree) await act(async () => tree?.unmount());
    tree = undefined;
    mockCloudState = { status: 'signed_in', account: { id: 'account-a' } };
    jest.clearAllMocks();
  });

  it('uses Cloud canonical history and Cloud Agent Run instead of paired tokens', async () => {
    await act(async () => {
      tree = renderer.create(<AgentChatScreen />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCloudClient.getSession).toHaveBeenCalledWith('thread-1');
    expect(mockCloudClient.getMessages).toHaveBeenCalledWith('thread-1');
    expect(mockHostRunClient.getAgentRun).toHaveBeenCalledWith('run-1');
    expect(mockPairedClient.getSession).not.toHaveBeenCalled();
    expect(mockPairedClient.getMessages).not.toHaveBeenCalled();
    expect(mockPairedClient.subscribeMessageSnapshots).not.toHaveBeenCalled();
    const card = tree!.root.findAll(node => Boolean(node.props.onAction && node.props.run))[0]!;
    expect(card.props.run?.status).toBe('waiting_approval');
    await act(async () => {
      card.props.onAction('approve');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockHostRunClient.approveAgentRun).toHaveBeenCalledWith('run-1');
    expect(mockPairedClient.getMessages).not.toHaveBeenCalled();
  });

  it('unmounts Cloud Agent controller when the Cloud identity signs out', async () => {
    await act(async () => {
      tree = renderer.create(<AgentChatScreen />);
      await Promise.resolve();
    });
    mockCloudState = {
      status: 'signed_out', account: { id: 'account-a' },
    };
    await act(async () => {
      tree?.update(<AgentChatScreen />);
      await Promise.resolve();
    });
    const { CloudHostAgentRunClient } = jest.requireMock(
      '../cloud/cloudHostAgentRunClient',
    );
    expect(CloudHostAgentRunClient).toHaveBeenCalledTimes(1);
    expect(mockPairedClient.getMessages).not.toHaveBeenCalled();
  });
});
