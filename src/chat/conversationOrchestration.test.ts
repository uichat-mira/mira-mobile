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
): ChatMessage => ({ id, role, content, timestamp: new Date('2026-10-05T00:00:00.000Z') });

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

describe('ConversationOrchestrator', () => {
  it('streams a successful turn and performs a canonical reload', async () => {
    const harness = buildHarness({});

    const outcome = await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1' },
      harness.emit,
      () => 'generated',
    );

    expect(outcome).toEqual({ messageId: 'u1', cancelled: false, failed: false });
    expect(harness.sends).toEqual([
      { content: 'hi', messageId: 'u1', agentEnabled: false },
    ]);
    const textEvents = harness.events.filter((event) => event.type === 'text');
    expect(textEvents.at(-1)).toEqual({ type: 'text', text: 'hello' });
    expect(harness.events).toContainEqual({
      type: 'canonical-reload',
      messages: [message('a1', 'assistant', 'hello')],
    });
    expect(failureEvent(harness.events)).toBeUndefined();
  });

  it('generates a message id when none is supplied', async () => {
    const harness = buildHarness({});

    const outcome = await harness.orchestrator.dispatchTurn(
      { content: 'hi' },
      harness.emit,
      () => 'generated-id',
    );

    expect(outcome.messageId).toBe('generated-id');
    expect(harness.sends[0].messageId).toBe('generated-id');
  });

  it('treats a user cancel as cancelled and not as an ordinary failure', async () => {
    const runtime = runtimeFor('remote-host');
    const harness = buildHarness({
      runtime,
      canonical: async () => [message('u1', 'user', 'hi')],
      send: async (_input) => {
        // Cancel while the stream is still open, before any assistant message.
        harness.orchestrator.cancel();
        return streamOf([]);
      },
    });

    const outcome = await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1' },
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
      { content: 'hi', messageId: 'u1' },
      harness.emit,
      () => 'generated',
    );

    expect(outcome.failed).toBe(true);
    const failure = failureEvent(harness.events);
    expect(failure).toMatchObject({ type: 'failure', kind: 'timeout', messageId: 'u1' });
    expect(harness.events).toContainEqual({
      type: 'canonical-reload',
      messages: [message('u1', 'user', 'hi')],
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
      { content: 'hi', messageId: 'u1' },
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

  it('does not double-report a failure when the canonical read already has an assistant reply', async () => {
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
      { content: 'hi', messageId: 'u1' },
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
      { content: 'hi', messageId: 'u1' },
      harness.emit,
      () => 'generated',
    );
    await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1' },
      harness.emit,
      () => 'generated',
    );

    expect(attempts).toHaveLength(2);
    expect(attempts.every((input) => input.messageId === 'u1')).toBe(true);
  });

  it('reads canonical state exactly once on the success path', async () => {
    const harness = buildHarness({});

    await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1' },
      harness.emit,
      () => 'generated',
    );

    expect(harness.canonicalReads).toEqual([1]);
  });

  it('refreshes the canonical session title after the turn settles', async () => {
    const refreshTitle = jest.fn();
    const harness = buildHarness({ refreshTitle });

    await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1' },
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
      { content: 'hi', messageId: 'u1', agentEnabled: true },
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

  it('raises an actionable failure when the stream reports an error event', async () => {
    const harness = buildHarness({
      runtime: runtimeFor('local-provider'),
      canonical: async () => [message('u1', 'user', 'hi')],
      send: async () => streamOf([{ type: 'error', message: 'stream failed' }]),
    });

    const outcome = await harness.orchestrator.dispatchTurn(
      { content: 'hi', messageId: 'u1', agentEnabled: true },
      harness.emit,
      () => 'generated',
    );

    expect(outcome.failed).toBe(true);
    expect(failureEvent(harness.events)).toMatchObject({
      type: 'failure',
      messageId: 'u1',
    });
    expect(harness.events).toContainEqual({ type: 'phase', phase: 'error' });
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
