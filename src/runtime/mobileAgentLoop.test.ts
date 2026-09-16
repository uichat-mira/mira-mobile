import type { RuntimeEvent } from './conversationRuntime';
import { MobileAgentLoop } from './mobileAgentLoop';
import {
  ToolApprovalRequiredError,
  ToolGatewayError,
  type ToolApprovalDecision,
  type ToolApprovalRequest,
  type ToolGatewayClient,
} from '../tools/toolGatewayClient';

const collect = async (stream: AsyncIterable<RuntimeEvent>) => {
  const events: RuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
};

describe('MobileAgentLoop', () => {
  it('executes an allowed tool and feeds the result into the next model round', async () => {
    const calls: unknown[][] = [];
    const gateway: ToolGatewayClient = {
      listTools: async () => [{ name: 'search', parameters: { type: 'object' } }],
      callTool: async (request) => ({ content: `result:${request.name}` }),
    };
    let round = 0;
    const loop = new MobileAgentLoop(gateway);
    const events = await collect(await loop.run(
      [{ role: 'user', content: 'find' }],
      async (messages, tools) => {
        calls.push([messages, tools]);
        round += 1;
        if (round === 1) {
          return (async function* () {
            yield { type: 'tool-call' as const, callId: 'c1', name: 'search', arguments: '{}' };
            yield { type: 'finish' as const, reason: 'tool_calls' };
          })();
        }
        return (async function* () {
          yield { type: 'text-delta' as const, delta: 'done' };
          yield { type: 'finish' as const, reason: 'stop' };
        })();
      },
    ));

    expect(calls).toHaveLength(2);
    expect(calls[1][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', content: 'result:search', tool_call_id: 'c1' }),
    ]));
    expect(events).toEqual(expect.arrayContaining([
      { type: 'tool-result', callId: 'c1', name: 'search', content: 'result:search' },
      { type: 'text-delta', delta: 'done' },
    ]));
  });

  it('pauses for mobile approval, resumes the frozen call, and continues the model', async () => {
    const approval: ToolApprovalRequest = {
      invocationId: 'inv-1',
      callId: 'c1',
      name: 'terminal_session',
      arguments: '{"command":"pwd"}',
      message: 'Run terminal command',
      scope: 'terminal',
    };
    const gateway: ToolGatewayClient = {
      listTools: async () => [
        {
          name: 'terminal_session',
          parameters: { type: 'object' },
          requiresApproval: true,
        },
      ],
      callTool: async () => {
        throw new ToolApprovalRequiredError(approval);
      },
      resolveApproval: async (request, decision) => {
        expect(request).toEqual(approval);
        expect(decision).toBe('approved');
        return {
          status: 'completed',
          result: { content: '/workspace' },
        };
      },
    };
    const requested: ToolApprovalRequest[] = [];
    let round = 0;
    const loop = new MobileAgentLoop(gateway);

    const events = await collect(
      await loop.run(
        [{ role: 'user', content: 'pwd' }],
        async () => {
          round += 1;
          if (round === 1) {
            return (async function* () {
              yield {
                type: 'tool-call' as const,
                callId: 'c1',
                name: 'terminal_session',
                arguments: '{"command":"pwd"}',
              };
              yield { type: 'finish' as const, reason: 'tool_calls' };
            })();
          }
          return (async function* () {
            yield { type: 'text-delta' as const, delta: 'done' };
            yield { type: 'finish' as const, reason: 'stop' };
          })();
        },
        {
          requestApproval: async value => {
            requested.push(value);
            return 'approved';
          },
        },
      ),
    );

    expect(requested).toEqual([approval]);
    expect(events).toEqual(
      expect.arrayContaining([
        {
          type: 'approval-required',
          invocationId: 'inv-1',
          callId: 'c1',
          name: 'terminal_session',
          message: 'Run terminal command',
          scope: 'terminal',
        },
        {
          type: 'approval-resolved',
          invocationId: 'inv-1',
          callId: 'c1',
          name: 'terminal_session',
          decision: 'approved',
        },
        {
          type: 'tool-result',
          callId: 'c1',
          name: 'terminal_session',
          content: '/workspace',
        },
        { type: 'text-delta', delta: 'done' },
      ]),
    );
  });

  it('stops the current Agent run after mobile rejection without adding a tool result', async () => {
    const approval: ToolApprovalRequest = {
      invocationId: 'inv-reject',
      callId: 'c1',
      name: 'terminal_session',
      arguments: '{"command":"rm -rf tmp"}',
      message: 'Approval required',
    };
    const gateway: ToolGatewayClient = {
      listTools: async () => [
        { name: 'terminal_session', parameters: { type: 'object' } },
      ],
      callTool: async () => {
        throw new ToolApprovalRequiredError(approval);
      },
      resolveApproval: async (_request, decision) => {
        expect(decision).toBe('rejected');
        return { status: 'rejected' };
      },
    };
    const loop = new MobileAgentLoop(gateway);

    const events = await collect(
      await loop.run(
        [],
        async () =>
          (async function* () {
            yield {
              type: 'tool-call' as const,
              callId: 'c1',
              name: 'terminal_session',
              arguments: approval.arguments,
            };
            yield { type: 'finish' as const, reason: 'tool_calls' };
          })(),
        { requestApproval: async () => 'rejected' },
      ),
    );

    expect(events).toContainEqual({
      type: 'approval-resolved',
      invocationId: 'inv-reject',
      callId: 'c1',
      name: 'terminal_session',
      decision: 'rejected',
    });
    expect(events.at(-1)).toEqual({
      type: 'run-paused',
      reason: 'approval-rejected',
    });
    expect(events.some(event => event.type === 'tool-result')).toBe(false);
  });

  it('times out while waiting for mobile approval', async () => {
    jest.useFakeTimers();
    try {
      const approval: ToolApprovalRequest = {
        invocationId: 'inv-timeout',
        callId: 'c1',
        name: 'terminal_session',
        arguments: '{}',
        message: 'Approval required',
      };
      const gateway: ToolGatewayClient = {
        listTools: async () => [
          { name: 'terminal_session', parameters: { type: 'object' } },
        ],
        callTool: async () => {
          throw new ToolApprovalRequiredError(approval);
        },
        resolveApproval: async () => ({
          status: 'completed',
          result: { content: 'should not run' },
        }),
      };
      const loop = new MobileAgentLoop(gateway);
      const stream = await loop.run(
        [],
        async () =>
          (async function* () {
            yield {
              type: 'tool-call' as const,
              callId: 'c1',
              name: 'terminal_session',
              arguments: '{}',
            };
            yield { type: 'finish' as const, reason: 'tool_calls' };
          })(),
        {
          overallTimeoutMs: 50,
          requestApproval: async () => new Promise<ToolApprovalDecision>(() => undefined),
        },
      );
      const collected = collect(stream);
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(50);
      await expect(collected).resolves.toContainEqual({
        type: 'run-paused',
        reason: 'timeout',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('marks oversized tool results as truncated before the next model round', async () => {
    const gateway: ToolGatewayClient = {
      listTools: async () => [
        { name: 'search', parameters: { type: 'object' } },
      ],
      callTool: async () => ({ content: 'abcdefghij' }),
    };
    let round = 0;
    const loop = new MobileAgentLoop(gateway);
    const events = await collect(
      await loop.run(
        [],
        async () => {
          round += 1;
          if (round === 1) {
            return (async function* () {
              yield {
                type: 'tool-call' as const,
                callId: 'c1',
                name: 'search',
                arguments: '{}',
              };
              yield { type: 'finish' as const, reason: 'tool_calls' };
            })();
          }
          return (async function* () {
            yield { type: 'finish' as const, reason: 'stop' };
          })();
        },
        { maxToolResultBytes: 4 },
      ),
    );

    expect(events).toContainEqual({
      type: 'tool-result',
      callId: 'c1',
      name: 'search',
      content: 'abcd',
      truncated: true,
    });
  });

  it('times out a stalled approval resolution request within the overall deadline', async () => {
    jest.useFakeTimers();
    try {
      const approval: ToolApprovalRequest = {
        invocationId: 'inv-resolve-timeout',
        callId: 'c1',
        name: 'terminal_session',
        arguments: '{}',
        message: 'Approval required',
      };
      let markResolveStarted!: () => void;
      const resolveStarted = new Promise<void>(resolve => {
        markResolveStarted = resolve;
      });
      const gateway: ToolGatewayClient = {
        listTools: async () => [
          { name: 'terminal_session', parameters: { type: 'object' } },
        ],
        callTool: async () => {
          throw new ToolApprovalRequiredError(approval);
        },
        resolveApproval: async (_request, _decision, options) => {
          markResolveStarted();
          return new Promise((_resolve, reject) => {
            options?.signal?.addEventListener(
              'abort',
              () =>
                reject(
                  new ToolGatewayError(
                    'TOOL_CANCELLED',
                    'approval request cancelled',
                  ),
                ),
              { once: true },
            );
          });
        },
      };
      const loop = new MobileAgentLoop(gateway);
      const stream = await loop.run(
        [],
        async () =>
          (async function* () {
            yield {
              type: 'tool-call' as const,
              callId: 'c1',
              name: 'terminal_session',
              arguments: '{}',
            };
            yield { type: 'finish' as const, reason: 'tool_calls' };
          })(),
        {
          overallTimeoutMs: 50,
          requestApproval: async () => 'approved',
        },
      );

      const collected = collect(stream);
      await resolveStarted;
      await jest.advanceTimersByTimeAsync(50);

      await expect(collected).resolves.toContainEqual({
        type: 'run-paused',
        reason: 'timeout',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not misreport an uncertain approval dispatch as cancellation', async () => {
    const approval: ToolApprovalRequest = {
      invocationId: 'inv-uncertain',
      callId: 'c1',
      name: 'terminal_session',
      arguments: '{}',
      message: 'Approval required',
    };
    const controller = new AbortController();
    const gateway: ToolGatewayClient = {
      listTools: async () => [
        { name: 'terminal_session', parameters: { type: 'object' } },
      ],
      callTool: async () => {
        throw new ToolApprovalRequiredError(approval);
      },
      resolveApproval: async () => {
        controller.abort();
        throw new ToolGatewayError(
          'TOOL_APPROVAL_UNCERTAIN',
          'Mira Host may have accepted the approval',
        );
      },
    };
    const loop = new MobileAgentLoop(gateway);

    await expect(
      collect(
        await loop.run(
          [],
          async () =>
            (async function* () {
              yield {
                type: 'tool-call' as const,
                callId: 'c1',
                name: 'terminal_session',
                arguments: '{}',
              };
              yield { type: 'finish' as const, reason: 'tool_calls' };
            })(),
          {
            signal: controller.signal,
            requestApproval: async () => 'approved',
          },
        ),
      ),
    ).rejects.toMatchObject({
      code: 'TOOL_APPROVAL_UNCERTAIN',
    });
  });

  it('stops at the configured round limit', async () => {
    const gateway: ToolGatewayClient = {
      listTools: async () => [{ name: 'search', parameters: { type: 'object' } }],
      callTool: async () => ({ content: 'ok' }),
    };
    const loop = new MobileAgentLoop(gateway);
    const events = await collect(await loop.run([], async () => (async function* () {
      yield { type: 'tool-call' as const, callId: 'c1', name: 'search', arguments: '{}' };
      yield { type: 'finish' as const, reason: 'tool_calls' };
    })(), { maxToolRounds: 1 }));

    expect(events.at(-1)).toEqual({ type: 'error', message: 'Tool round limit reached (1)' });
  });

  it('reports app suspension when the run signal is also aborted', async () => {
    const callTool = jest.fn(async () => ({ content: 'unused' }));
    const gateway: ToolGatewayClient = {
      listTools: async () => [
        { name: 'search', parameters: { type: 'object' } },
      ],
      callTool,
    };
    const controller = new AbortController();
    let suspended = false;
    const loop = new MobileAgentLoop(gateway);
    const events = await collect(
      await loop.run(
        [],
        async () =>
          (async function* () {
            yield {
              type: 'tool-call' as const,
              callId: 'c1',
              name: 'search',
              arguments: '{}',
            };
            suspended = true;
            controller.abort();
            yield { type: 'finish' as const, reason: 'tool_calls' };
          })(),
        {
          signal: controller.signal,
          shouldPause: () => suspended,
        },
      ),
    );

    expect(events.at(-1)).toEqual({
      type: 'run-paused',
      reason: 'app-suspended',
    });
    expect(callTool).not.toHaveBeenCalled();
  });

  it('reports an app suspension boundary instead of claiming background continuation', async () => {
    const gateway: ToolGatewayClient = {
      listTools: async () => [],
      callTool: async () => ({ content: 'unused' }),
    };
    const loop = new MobileAgentLoop(gateway);
    const events = await collect(await loop.run([], async () => (async function* () {
      yield { type: 'finish' as const, reason: 'stop' };
    })(), { shouldPause: () => true }));

    expect(events).toEqual([{ type: 'run-paused', reason: 'app-suspended' }]);
  });
});
