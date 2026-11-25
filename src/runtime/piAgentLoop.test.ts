import type { OpenAiStandardClient } from '../provider/openAiStandardClient';
import type { RuntimeEvent } from './conversationRuntime';
import { LocalAgentRunController } from './localAgentRunController';
import { PiCoreAgentLoop } from './piAgentLoop';
import {
  ToolApprovalRequiredError,
  ToolGatewayError,
  type ToolApprovalRequest,
  type ToolGatewayClient,
} from '../tools/toolGatewayClient';

const collect = async (stream: AsyncIterable<RuntimeEvent>) => {
  const events: RuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
};

const approval: ToolApprovalRequest = {
  invocationId: 'inv-pi-1',
  callId: 'c1',
  name: 'terminal_session',
  arguments: '{"command":"pwd"}',
  message: 'Run terminal command',
  scope: 'terminal',
};

const approvalGateway = (): {
  gateway: ToolGatewayClient;
  callTool: jest.Mock;
  resolveApproval: jest.Mock;
} => {
  const callTool = jest.fn(async () => {
    throw new ToolApprovalRequiredError(approval);
  });
  const resolveApproval = jest.fn(async () => ({
    status: 'completed' as const,
    result: { content: '/workspace' },
  }));
  return {
    callTool,
    resolveApproval,
    gateway: {
      listTools: async () => [{
        name: 'terminal_session',
        description: 'Run a terminal command',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' } },
        },
        requiresApproval: true,
      }],
      callTool,
      resolveApproval,
    },
  };
};

describe('PiCoreAgentLoop', () => {
  it('streams text, runs an approved tool through the Tool Gateway, and continues the model', async () => {
    const { gateway, callTool, resolveApproval } = approvalGateway();
    const requests: Array<{
      messages: readonly unknown[];
      tools: readonly unknown[];
    }> = [];
    let round = 0;
    const loop = new PiCoreAgentLoop(gateway);

    const events = await collect(await loop.run(
      [{ role: 'user', content: 'show cwd' }],
      async (messages, tools) => {
        requests.push({ messages, tools });
        round += 1;
        if (round === 1) {
          return (async function* () {
            yield { type: 'text-delta' as const, delta: 'checking' };
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
        requestApproval: async () => 'approved',
      },
    ));

    expect(requests).toHaveLength(2);
    expect(callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: 'c1',
        name: 'terminal_session',
        arguments: '{"command":"pwd"}',
      }),
      expect.anything(),
    );
    expect(resolveApproval).toHaveBeenCalledWith(
      approval,
      'approved',
      expect.anything(),
    );
    expect(requests[1].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'tool',
        content: '/workspace',
        tool_call_id: 'c1',
      }),
    ]));
    expect(requests[1].tools).toEqual([
      expect.objectContaining({
        type: 'function',
        function: expect.objectContaining({ name: 'terminal_session' }),
      }),
    ]);
    expect(events).toEqual(expect.arrayContaining([
      { type: 'text-delta', delta: 'checking' },
      {
        type: 'tool-call',
        callId: 'c1',
        name: 'terminal_session',
        arguments: '{"command":"pwd"}',
      },
      { type: 'tool-running', callId: 'c1', name: 'terminal_session' },
      {
        type: 'approval-required',
        invocationId: 'inv-pi-1',
        callId: 'c1',
        name: 'terminal_session',
        message: 'Run terminal command',
        scope: 'terminal',
      },
      {
        type: 'approval-resolved',
        invocationId: 'inv-pi-1',
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
      { type: 'finish', reason: 'stop' },
    ]));
    expect(events.some((event) => event.type === 'error')).toBe(false);
  });

  it('pauses on approval rejection without running the model again or inventing a result', async () => {
    const { gateway, callTool, resolveApproval } = approvalGateway();
    resolveApproval.mockResolvedValue({ status: 'rejected' });
    const modelCall = jest.fn(async () => (async function* () {
      yield {
        type: 'tool-call' as const,
        callId: 'c1',
        name: 'terminal_session',
        arguments: '{"command":"pwd"}',
      };
      yield { type: 'finish' as const, reason: 'tool_calls' };
    })());
    const events = await collect(await new PiCoreAgentLoop(gateway).run(
      [{ role: 'user', content: 'show cwd' }],
      modelCall,
      { requestApproval: async () => 'rejected' },
    ));

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(resolveApproval).toHaveBeenCalledWith(
      approval,
      'rejected',
      expect.anything(),
    );
    expect(modelCall).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({
      type: 'run-paused',
      reason: 'approval-rejected',
    });
    expect(events.some((event) => event.type === 'tool-result')).toBe(false);
    expect(events.some((event) => event.type === 'error')).toBe(false);
  });

  it('surfaces a tool permission error and never continues as if the call succeeded', async () => {
    const modelCall = jest.fn(async () => (async function* () {
      yield {
        type: 'tool-call' as const,
        callId: 'c1',
        name: 'terminal_session',
        arguments: '{"command":"pwd"}',
      };
      yield { type: 'finish' as const, reason: 'tool_calls' };
    })());
    const gateway: ToolGatewayClient = {
      listTools: async () => [{
        name: 'terminal_session',
        description: 'Run a terminal command',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' } },
        },
      }],
      callTool: async () => {
        throw new ToolGatewayError(
          'TOOL_UNAUTHORIZED',
          'Tool authorization was revoked',
        );
      },
    };

    const events: RuntimeEvent[] = [];
    await expect((async () => {
      for await (const event of await new PiCoreAgentLoop(gateway).run(
        [{ role: 'user', content: 'show cwd' }],
        modelCall,
      )) {
        events.push(event);
      }
    })()).rejects.toThrow('Tool authorization was revoked');

    expect(modelCall).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === 'tool-result')).toBe(false);
  });

  it('rejects a provider failure instead of emitting a successful finish', async () => {
    const gateway: ToolGatewayClient = {
      listTools: async () => [],
      callTool: async () => ({ content: 'unused' }),
    };
    const modelCall = async () => (async function* () {
      yield { type: 'text-delta' as const, delta: 'partial' };
      throw new Error('provider stream broke');
    })();

    await expect(collect(await new PiCoreAgentLoop(gateway).run(
      [{ role: 'user', content: 'hello' }],
      modelCall,
    ))).rejects.toThrow('provider stream broke');
  });

  it('cancels an in-flight model stream without emitting a successful finish', async () => {
    const controller = new AbortController();
    const gateway: ToolGatewayClient = {
      listTools: async () => [],
      callTool: async () => ({ content: 'unused' }),
    };
    const modelCall = jest.fn(async () => (async function* () {
      yield { type: 'text-delta' as const, delta: 'partial' };
      await new Promise<void>(() => undefined);
    })());
    const stream = await new PiCoreAgentLoop(gateway).run(
      [{ role: 'user', content: 'hello' }],
      modelCall,
      { signal: controller.signal },
    );

    const events: RuntimeEvent[] = [];
    for await (const event of stream) {
      events.push(event);
      if (event.type === 'text-delta') controller.abort();
      if (events.length > 20) break;
    }

    expect(events).toContainEqual({ type: 'text-delta', delta: 'partial' });
    expect(events).toContainEqual({
      type: 'run-paused',
      reason: 'cancelled',
    });
    expect(events.some(
      (event) => event.type === 'finish' && event.reason === 'stop',
    )).toBe(false);
  });

  it('times out while waiting for approval instead of hanging the run', async () => {
    const { gateway, callTool } = approvalGateway();
    const modelCall = jest.fn(async () => (async function* () {
      yield {
        type: 'tool-call' as const,
        callId: 'c1',
        name: 'terminal_session',
        arguments: '{"command":"pwd"}',
      };
      yield { type: 'finish' as const, reason: 'tool_calls' };
    })());

    const events = await collect(await new PiCoreAgentLoop(gateway).run(
      [{ role: 'user', content: 'show cwd' }],
      modelCall,
      {
        overallTimeoutMs: 25,
        requestApproval: () => new Promise(() => undefined),
      },
    ));

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(modelCall).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({
      type: 'run-paused',
      reason: 'timeout',
    });
    expect(events.some(
      (event) => event.type === 'finish' && event.reason === 'stop',
    )).toBe(false);
  });

  it('does not execute a tool call when the provider did not finish with tool_calls', async () => {
    const callTool = jest.fn(async () => ({ content: 'should-not-run' }));
    const gateway: ToolGatewayClient = {
      listTools: async () => [{
        name: 'terminal_session',
        description: 'Run a terminal command',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' } },
        },
      }],
      callTool,
    };

    const events = await collect(await new PiCoreAgentLoop(gateway).run(
      [{ role: 'user', content: 'show cwd' }],
      async () => (async function* () {
        yield {
          type: 'tool-call' as const,
          callId: 'c1',
          name: 'terminal_session',
          arguments: '{"command":"pwd"}',
        };
        yield { type: 'finish' as const, reason: 'stop' };
      })(),
    ));

    expect(callTool).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === 'tool-call')).toBe(false);
    expect(events.some((event) => event.type === 'tool-running')).toBe(false);
    expect(events).toContainEqual({ type: 'finish', reason: 'stop' });
  });

  it('exposes verified mail tools without a data-source-driven tool whitelist', async () => {
    const gateway: ToolGatewayClient = {
      listTools: async () => [
        {
          name: 'whoyou_mail_search',
          description: 'Search mail',
          parameters: { type: 'object' },
          sensitiveResult: 'mail-search',
        },
        {
          name: 'web',
          description: 'Web page',
          parameters: { type: 'object' },
        },
      ],
      callTool: async () => ({ content: 'unused' }),
    };
    const seenTools: Array<readonly unknown[]> = [];
    const events = await collect(await new PiCoreAgentLoop(gateway).run(
      [{ role: 'user', content: 'web?' }],
      async (_messages, tools) => {
        seenTools.push(tools);
        return (async function* () {
          yield { type: 'text-delta' as const, delta: 'sunny' };
          yield { type: 'finish' as const, reason: 'stop' };
        })();
      },
    ));

    expect(seenTools[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        function: expect.objectContaining({ name: 'whoyou_mail_search' }),
      }),
      expect.objectContaining({
        function: expect.objectContaining({ name: 'web' }),
      }),
    ]));
    expect(events).not.toContainEqual({
      type: 'notice',
      code: 'toolset-degraded',
    });
  });

  it('is reachable through the Pi-only LocalAgentRunController', async () => {
    const { gateway } = approvalGateway();
    const executor = {
      client: { cancelActiveRun: jest.fn() } as unknown as OpenAiStandardClient,
      streamMessages: jest.fn(async () => (async function* () {
        yield { type: 'text-delta' as const, delta: 'pi-core' };
        yield { type: 'finish' as const, reason: 'stop' };
      })()),
    };
    const controller = new LocalAgentRunController(gateway);

    const run = await controller.beginRun({
      executor,
      strength: 'standard',
      initialMessages: [{ role: 'user', content: 'hello' }],
      shouldPause: () => false,
    });
    const events = await collect(run.stream);
    controller.finishRun(run);

    expect(events).toContainEqual({
      type: 'text-delta',
      delta: 'pi-core',
    });
    expect(executor.streamMessages).toHaveBeenCalledTimes(1);
  });

  it('builds the run tool gateway with the Local conversation thread id', async () => {
    const { gateway } = approvalGateway();
    const executor = {
      client: { cancelActiveRun: jest.fn() } as unknown as OpenAiStandardClient,
      streamMessages: jest.fn(async () => (async function* () {
        yield { type: 'finish' as const, reason: 'stop' };
      })()),
    };
    const factory = jest.fn(() => gateway);
    const controller = new LocalAgentRunController(factory);

    const run = await controller.beginRun({
      executor,
      strength: 'standard',
      initialMessages: [{ role: 'user', content: 'hello' }],
      threadId: 'local-thread-1',
      shouldPause: () => false,
    });
    await collect(run.stream);
    controller.finishRun(run);

    expect(factory).toHaveBeenCalledWith(
      undefined,
      undefined,
      'local-thread-1',
    );
  });

});
