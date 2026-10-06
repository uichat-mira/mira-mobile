import type { ChatMessage } from '../types';
import { RemoteHostError } from '../api/remoteHttp';
import type {
  ConversationRuntime,
  RuntimeEvent,
} from '../runtime/conversationRuntime';
import {
  ConversationOrchestrator,
  classifyConversationSendError,
  type ConversationLifecycleEvent,
  type ConversationSendInput,
} from './conversationOrchestration';

const runtimeFor = (
  kind: 'remote-host' | 'local-provider',
  overrides: Partial<ConversationRuntime> = {},
): ConversationRuntime => ({
  kind,
  listSessions: async () => [],
  deleteSession: async () => undefined,
  getMessages: async () => [],
  sendMessage: async () => (async function* (): AsyncIterable<RuntimeEvent> {})(),
  cancelActiveRun: () => undefined,
  ...overrides,
});

const message = (
  id: string,
  role: ChatMessage['role'],
  content: string,
  timestampMs = Date.parse('2026-10-05T00:00:00.000Z'),
): ChatMessage => ({ id, role, content, timestamp: new Date(timestampMs) });

const streamOf = (events: RuntimeEvent[]): AsyncIterable<RuntimeEvent> =>
  (async function* () {
    for (const event of events) yield event;
  })();

interface Harness {
  orchestrator: ConversationOrchestrator;
  events: ConversationLifecycleEvent[];
  sends: ConversationSendInput[];
  emit: { emit(event: ConversationLifecycleEvent): void };
  canonicalReads: number[];
}

const buildHarness = (options: {
  runtime?: ConversationRuntime;
  send?: (input: ConversationSendInput) => Promise<AsyncIterable<RuntimeEvent>>;
  canonical?: () => Promise<ChatMessage[] | null>;
  refreshTitle?: () => void;
}): Harness => {
  const events: ConversationLifecycleEvent[] = [];
  const sends: ConversationSendInput[] = [];
  const canonicalReads: number[] = [];
  let readCount = 0;
  const send =
    options.send ??
    (async (_input: ConversationSendInput) =>
      streamOf([
        { type: 'text-delta', delta: 'hello' },
        { type: 'finish', reason: 'stop' },
      ]));
  const orchestrator = new ConversationOrchestrator(
    {
      runtime: options.runtime ?? runtimeFor('remote-host'),
      loadCanonicalMessages:
        options.canonical ??
        (async () => {
          readCount += 1;
          canonicalReads.push(readCount);
          return [message('a1', 'assistant', 'hello')];
        }),
      refreshSessionTitle: options.refreshTitle ?? (() => undefined),
    },
    async (input) => {
      sends.push(input);
      return send(input);
    },
  );
  return { orchestrator, events, sends, emit: { emit: (e) => events.push(e) }, canonicalReads };
};

const failureEvent = (events: ConversationLifecycleEvent[]) =>
  events.find((event) => event.type === 'failure');

const eventTypes = (events: ConversationLifecycleEvent[]) =>
  events.map((event) => event.type);

/** Applies a lifecycle event stream to agent UI state, mirroring ChatScreen wiring. */
const reduceAgentState = (events: ConversationLifecycleEvent[]) => {
  let pendingApproval: unknown = null;
  let approvalAction: unknown = null;
  let phase = 'idle';
  let pauseReason: string | null = null;
  for (const event of events) {
    switch (event.type) {
      case 'agent-reset':
        pendingApproval = null;
        approvalAction = null;
        phase = 'idle';
        pauseReason = null;
        break;
      case 'clear-approval-action':
        approvalAction = null;
        break;
      case 'clear-approval':
        pendingApproval = null;
        approvalAction = null;
        break;
      case 'approval-required':
        pendingApproval = event.approval;
        break;
      case 'phase':
        phase = event.phase;
        break;
      case 'pause':
        pauseReason = event.reason;
        break;
      default:
        break;
    }
  }
  return { pendingApproval, approvalAction, phase, pauseReason };
};

describe('ConversationOrchestrator', () => {
  it('streams a successful turn and performs a canonical reload', async () => {
    const harness = buildHarness({});

    const outcome = await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1', userTimestamp: 1000 },
      harness.emit,
      () => 'generated',
    );

    expect(outcome).toEqual({ messageId: 'u1', cancelled: false, failed: false });
    expect(harness.sends).toEqual([
      { content: 'hi', messageId: 'u1', agentEnabled: false },
    ]);
    expect(harness.events).toContainEqual({ type: 'text', text: 'hello' });
    expect(harness.events).toContainEqual({
      type: 'canonical-reload',
      messages: [message('a1', 'assistant', 'hello')],
    });
    expect(failureEvent(harness.events)).toBeUndefined();
  });

  it('generates a message id when none is supplied', async () => {
    const harness = buildHarness({});

    const outcome = await harness.orchestrator.dispatchTurn(
      { content: 'hi', userTimestamp: 1000 },
      harness.emit,
      () => 'generated-id',
    );

    expect(outcome.messageId).toBe('generated-id');
    expect(harness.sends[0].messageId).toBe('generated-id');
  });

  it('treats a user cancel as cancelled and not as an ordinary failure', async () => {
    const harness: Harness = buildHarness({
      runtime: runtimeFor('remote-host'),
      canonical: async () => [message('u1', 'user', 'hi')],
      send: async (_input) => {
        harness.orchestrator.cancel();
        return streamOf([]);
      },
    });

    const outcome = await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1', userTimestamp: 1000 },
      harness.emit,
      () => 'generated',
    );

    expect(outcome.cancelled).toBe(true);
    expect(outcome.failed).toBe(false);
    expect(failureEvent(harness.events)).toBeUndefined();
  });

  it('surfaces a timeout as an actionable failure and does not fabricate an assistant message', async () => {
    const harness = buildHarness({
      runtime: runtimeFor('local-provider'),
      canonical: async () => [message('u1', 'user', 'hi')],
      send: async () => {
        throw new RemoteHostError('PROVIDER_TIMEOUT', 'provider timed out');
      },
    });

    const outcome = await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1', userTimestamp: 1000 },
      harness.emit,
      () => 'generated',
    );

    expect(outcome.failed).toBe(true);
    expect(failureEvent(harness.events)).toMatchObject({
      type: 'failure',
      kind: 'timeout',
      messageId: 'u1',
    });
  });

  it('reloads canonical state after a late stream failure discards transient text', async () => {
    const canonical = [message('u1', 'user', 'hi')];
    const harness = buildHarness({
      runtime: runtimeFor('local-provider'),
      canonical: async () => canonical,
      send: async () =>
        (async function* () {
          yield { type: 'text-delta' as const, delta: 'partial' };
          throw new RemoteHostError(
            'INVALID_PROVIDER_EVENT',
            'provider stream became invalid',
          );
        })(),
    });

    const outcome = await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1', userTimestamp: 1000 },
      harness.emit,
      () => 'generated',
    );

    expect(outcome.failed).toBe(true);
    expect(harness.events).toContainEqual({ type: 'text', text: 'partial' });
    expect(harness.events).toContainEqual({
      type: 'canonical-reload',
      messages: canonical,
    });
    expect(failureEvent(harness.events)).toMatchObject({
      type: 'failure',
      kind: 'provider-or-host',
      messageId: 'u1',
    });
  });

  it('surfaces a provider/host failure without inventing an assistant message', async () => {
    const harness = buildHarness({
      runtime: runtimeFor('local-provider'),
      canonical: async () => [message('u1', 'user', 'hi')],
      send: async () => {
        throw new Error('boom');
      },
    });

    const outcome = await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1', userTimestamp: 1000 },
      harness.emit,
      () => 'generated',
    );

    expect(outcome.failed).toBe(true);
    expect(failureEvent(harness.events)).toMatchObject({
      type: 'failure',
      kind: 'provider-or-host',
      messageId: 'u1',
    });
  });

  it('does not double-report a failure when this turn is already canonical', async () => {
    const harness = buildHarness({
      runtime: runtimeFor('local-provider'),
      canonical: async () => [
        message('u1', 'user', 'hi'),
        message('a1', 'assistant', 'already persisted'),
      ],
      send: async () => {
        throw new Error('stream dropped after the reply was persisted');
      },
    });

    const outcome = await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1', userTimestamp: 1000 },
      harness.emit,
      () => 'generated',
    );

    expect(outcome.failed).toBe(false);
    expect(failureEvent(harness.events)).toBeUndefined();
  });

  it('still reports a failure on a later turn when only older history has an assistant reply', async () => {
    // old user -> old assistant -> current user -> current send fails.
    // A historical assistant reply must not suppress this turn's failure.
    const harness = buildHarness({
      runtime: runtimeFor('local-provider'),
      canonical: async () => [
        message('u0', 'user', 'previous question', Date.parse('2026-10-04T00:00:00.000Z')),
        message('a0', 'assistant', 'previous answer', Date.parse('2026-10-04T00:00:01.000Z')),
        message('u1', 'user', 'hi', Date.parse('2026-10-05T00:00:00.000Z')),
      ],
      send: async () => {
        throw new RemoteHostError('PROVIDER_TIMEOUT', 'provider timed out');
      },
    });

    const outcome = await harness.orchestrator.dispatchTurn(
      {
        content: 'hi',
        messageId: 'u1',
        userTimestamp: Date.parse('2026-10-05T00:00:00.000Z'),
      },
      harness.emit,
      () => 'generated',
    );

    expect(outcome.failed).toBe(true);
    expect(failureEvent(harness.events)).toMatchObject({
      type: 'failure',
      messageId: 'u1',
    });
  });

  it('suppresses the failure when this turn is canonical even if older assistants exist', async () => {
    const harness = buildHarness({
      runtime: runtimeFor('local-provider'),
      canonical: async () => [
        message('u0', 'user', 'previous question', Date.parse('2026-10-04T00:00:00.000Z')),
        message('a0', 'assistant', 'previous answer', Date.parse('2026-10-04T00:00:01.000Z')),
        message('u1', 'user', 'hi', Date.parse('2026-10-05T00:00:00.000Z')),
        message('a1', 'assistant', 'this turn reply', Date.parse('2026-10-05T00:00:02.000Z')),
      ],
      send: async () => {
        throw new Error('stream dropped after the reply was persisted');
      },
    });

    const outcome = await harness.orchestrator.dispatchTurn(
      {
        content: 'hi',
        messageId: 'u1',
        userTimestamp: Date.parse('2026-10-05T00:00:00.000Z'),
      },
      harness.emit,
      () => 'generated',
    );

    expect(outcome.failed).toBe(false);
    expect(failureEvent(harness.events)).toBeUndefined();
  });

  it('reuses the supplied message id on retry so the user message is not duplicated', async () => {
    const attempts: ConversationSendInput[] = [];
    let attempt = 0;
    const harness = buildHarness({
      runtime: runtimeFor('remote-host'),
      canonical: async () => [message('u1', 'user', 'hi')],
      send: async (input) => {
        attempts.push(input);
        attempt += 1;
        if (attempt === 1) throw new RemoteHostError('NETWORK_ERROR', 'offline');
        return streamOf([
          { type: 'text-delta', delta: 'recovered' },
          { type: 'finish', reason: 'stop' },
        ]);
      },
    });

    await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1', userTimestamp: 1000 },
      harness.emit,
      () => 'generated',
    );
    await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1', userTimestamp: 1000 },
      harness.emit,
      () => 'generated',
    );

    expect(attempts).toHaveLength(2);
    expect(attempts.every((input) => input.messageId === 'u1')).toBe(true);
  });

  it('reads canonical state exactly once on the success path', async () => {
    const harness = buildHarness({});

    await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1', userTimestamp: 1000 },
      harness.emit,
      () => 'generated',
    );

    expect(harness.canonicalReads).toEqual([1]);
  });

  it('refreshes the canonical session title after the turn settles', async () => {
    const refreshTitle = jest.fn();
    const harness = buildHarness({ refreshTitle });

    await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1', userTimestamp: 1000 },
      harness.emit,
      () => 'generated',
    );

    expect(refreshTitle).toHaveBeenCalledTimes(1);
  });

  it('drives the local Agent phases and activities for tool events', async () => {
    const harness = buildHarness({
      runtime: runtimeFor('local-provider', { supportsAgent: true }),
      send: async () =>
        streamOf([
          { type: 'tool-call', callId: 'c1', name: 'search', arguments: '{}' },
          { type: 'tool-running', callId: 'c1', name: 'search' },
          { type: 'tool-result', callId: 'c1', name: 'search', content: 'result' },
          { type: 'text-delta', delta: 'final' },
          { type: 'finish', reason: 'stop' },
        ]),
    });

    const outcome = await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1', agentEnabled: true, userTimestamp: 1000 },
      harness.emit,
      () => 'generated',
    );

    expect(outcome.failed).toBe(false);
    expect(harness.events).toContainEqual({ type: 'agent-reset' });
    expect(harness.events).toContainEqual({
      type: 'activity',
      callId: 'c1',
      name: 'search',
      status: 'requested',
    });
    expect(harness.events).toContainEqual({ type: 'phase', phase: 'running-tool' });
    expect(harness.events).toContainEqual({ type: 'phase', phase: 'continuing' });
    expect(harness.events).toContainEqual({ type: 'phase', phase: 'completed' });
  });

  it('keeps the pending approval request visible while waiting and only clears the action', async () => {
    const harness = buildHarness({
      runtime: runtimeFor('local-provider', { supportsAgent: true }),
      send: async () =>
        streamOf([
          {
            type: 'approval-required',
            invocationId: 'inv-1',
            callId: 'c1',
            name: 'terminal_session',
            message: 'Run terminal command',
            scope: 'terminal',
          },
          { type: 'finish', reason: 'stop' },
        ]),
    });

    await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1', agentEnabled: true, userTimestamp: 1000 },
      harness.emit,
      () => 'generated',
    );

    const approvalRequiredIndex = harness.events.findIndex(
      (event) => event.type === 'approval-required',
    );
    expect(approvalRequiredIndex).toBeGreaterThanOrEqual(0);

    // The approval-required branch must never emit a blanket clear-approval that
    // would drop the pending request the user needs to act on.
    expect(harness.events[approvalRequiredIndex + 1]).toEqual({
      type: 'clear-approval-action',
    });
    expect(eventTypes(harness.events).slice(0, approvalRequiredIndex + 2)).not.toContain(
      'clear-approval',
    );

    // State as observed when the user is actually asked to approve: the pending
    // request must still be present (approval-required, clear-approval-action,
    // then the waiting-approval phase).
    const stateWhileWaiting = reduceAgentState(
      harness.events.slice(0, approvalRequiredIndex + 3),
    );
    expect(stateWhileWaiting.pendingApproval).toMatchObject({ invocationId: 'inv-1' });
    expect(stateWhileWaiting.approvalAction).toBeNull();
    expect(stateWhileWaiting.phase).toBe('waiting-approval');
  });

  it('clears the pending approval and pauses the phase when the run is paused', async () => {
    const harness = buildHarness({
      runtime: runtimeFor('local-provider', { supportsAgent: true }),
      send: async () =>
        streamOf([{ type: 'run-paused', reason: 'timeout' }]),
    });

    await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1', agentEnabled: true, userTimestamp: 1000 },
      harness.emit,
      () => 'generated',
    );

    const pauseIndex = eventTypes(harness.events).indexOf('pause');
    expect(pauseIndex).toBeGreaterThanOrEqual(0);
    expect(harness.events[pauseIndex]).toEqual({
      type: 'pause',
      reason: 'timeout',
    });
    // The paused phase must be re-established, not left on an earlier phase.
    expect(harness.events[pauseIndex + 1]).toEqual({
      type: 'phase',
      phase: 'paused',
    });

    const state = reduceAgentState(harness.events);
    expect(state.pendingApproval).toBeNull();
    expect(state.approvalAction).toBeNull();
    expect(state.phase).toBe('paused');
    expect(state.pauseReason).toBe('timeout');
  });

  it('does not emit a completed phase after a pause', async () => {
    const harness = buildHarness({
      runtime: runtimeFor('local-provider', { supportsAgent: true }),
      send: async () =>
        streamOf([
          { type: 'run-paused', reason: 'cancelled' },
          { type: 'finish', reason: 'stop' },
        ]),
    });

    await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1', agentEnabled: true, userTimestamp: 1000 },
      harness.emit,
      () => 'generated',
    );

    const pauseIndex = eventTypes(harness.events).indexOf('pause');
    const completedAfterPause = harness.events
      .slice(pauseIndex + 1)
      .some((event) => event.type === 'phase' && event.phase === 'completed');
    expect(completedAfterPause).toBe(false);
    expect(reduceAgentState(harness.events).phase).toBe('paused');
  });

  it('clears the pending approval and enters the error phase on a stream error', async () => {
    const harness = buildHarness({
      runtime: runtimeFor('local-provider', { supportsAgent: true }),
      canonical: async () => [message('u1', 'user', 'hi', 1000)],
      send: async () => streamOf([{ type: 'error', message: 'stream failed' }]),
    });

    const outcome = await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1', agentEnabled: true, userTimestamp: 1000 },
      harness.emit,
      () => 'generated',
    );

    expect(outcome.failed).toBe(true);
    expect(failureEvent(harness.events)).toMatchObject({
      type: 'failure',
      messageId: 'u1',
    });
    expect(reduceAgentState(harness.events).phase).toBe('error');
  });
});

describe('classifyConversationSendError', () => {
  it('classifies cancellation, timeout and provider/host failures distinctly', () => {
    expect(
      classifyConversationSendError(
        new RemoteHostError('REQUEST_ABORTED', 'aborted'),
        'local-provider',
      ),
    ).toBe('cancelled');
    expect(
      classifyConversationSendError(
        new RemoteHostError('PROVIDER_TIMEOUT', 'timed out'),
        'local-provider',
      ),
    ).toBe('timeout');
    expect(
      classifyConversationSendError(new Error('boom'), 'remote-host'),
    ).toBe('provider-or-host');
  });
});
