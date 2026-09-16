import { RemoteHostError } from '../api/remoteHttp';
import {
  ToolApprovalRequiredError,
  type ToolCallRequest,
} from './toolGatewayClient';
import { RemoteToolGatewayClient } from './remoteToolGatewayClient';

const tool = {
  id: 'mcp:server-1:tool:search',
  name: 'mcp_server_1_tool_search_a1b2c3d4e5',
  description: 'Search',
  parameters: { type: 'object' },
  destructive: false,
  requiresApproval: false,
};

const request: ToolCallRequest = {
  callId: 'call-1',
  name: tool.name,
  arguments: '{"query":"mira"}',
};

const host = () => ({
  listRemoteTools: jest.fn(async () => [tool]),
  openToolInvocation: jest.fn(),
  resolveToolApproval: jest.fn(),
  cancelToolInvocation: jest.fn(async (invocationId: string) => ({
    invocationId,
    accepted: true,
    status: 'cancelling',
  })),
});

describe('RemoteToolGatewayClient', () => {
  it('maps model-safe aliases back to canonical Host tool ids', async () => {
    const remote = host();
    remote.openToolInvocation.mockResolvedValue({
      abort: jest.fn(),
      events: (async function* () {
        yield {
          type: 'tool:start' as const,
          invocationId: 'inv-1',
          toolId: tool.id,
        };
        yield {
          type: 'tool:complete' as const,
          invocation: {
            invocationId: 'inv-1',
            toolId: tool.id,
            status: 'completed' as const,
            content: 'result',
          },
        };
      })(),
    });
    const client = new RemoteToolGatewayClient(remote as never);

    await expect(client.callTool(request)).resolves.toEqual({
      content: 'result',
    });
    expect(remote.openToolInvocation).toHaveBeenCalledWith({
      toolId: tool.id,
      args: { query: 'mira' },
    });
  });

  it('turns Host approval requirements into a typed protocol-neutral pause', async () => {
    const remote = host();
    remote.openToolInvocation.mockResolvedValue({
      abort: jest.fn(),
      events: (async function* () {
        yield {
          type: 'tool:approval_required' as const,
          invocationId: 'inv-approval',
          message: 'Approval required',
          scope: 'terminal',
        };
        yield {
          type: 'tool:complete' as const,
          invocation: {
            invocationId: 'inv-approval',
            toolId: tool.id,
            status: 'awaiting_approval' as const,
            approval: {
              message: 'Approval required',
              scope: 'terminal',
            },
          },
        };
      })(),
    });
    const client = new RemoteToolGatewayClient(remote as never);

    await expect(client.callTool(request)).rejects.toMatchObject({
      name: 'ToolApprovalRequiredError',
      approval: {
        invocationId: 'inv-approval',
        callId: 'call-1',
        name: tool.name,
        arguments: request.arguments,
        message: 'Approval required',
        scope: 'terminal',
      },
    });
  });

  it('preserves Host approval details when the final projection omits them', async () => {
    const remote = host();
    remote.openToolInvocation.mockResolvedValue({
      abort: jest.fn(),
      events: (async function* () {
        yield {
          type: 'tool:approval_required' as const,
          invocationId: 'inv-approval-fallback',
          message: 'Run command outside workspace',
          scope: 'terminal',
        };
        yield {
          type: 'tool:complete' as const,
          invocation: {
            invocationId: 'inv-approval-fallback',
            toolId: tool.id,
            status: 'awaiting_approval' as const,
          },
        };
      })(),
    });
    const client = new RemoteToolGatewayClient(remote as never);

    await expect(client.callTool(request)).rejects.toMatchObject({
      name: 'ToolApprovalRequiredError',
      approval: {
        invocationId: 'inv-approval-fallback',
        message: 'Run command outside workspace',
        scope: 'terminal',
      },
    });
  });

  it('resolves the same frozen tool call after mobile approval', async () => {
    const remote = host();
    remote.resolveToolApproval.mockResolvedValue({
      invocationId: 'inv-resumed',
      toolId: tool.id,
      status: 'completed',
      content: 'approved result',
    });
    const client = new RemoteToolGatewayClient(remote as never);
    await client.listTools();

    const approvalError = new ToolApprovalRequiredError({
      invocationId: 'inv-original',
      callId: request.callId,
      name: request.name,
      arguments: request.arguments,
      message: 'Approval required',
    });

    await expect(
      client.resolveApproval(
        approvalError.approval,
        'approved',
      ),
    ).resolves.toEqual({
      status: 'completed',
      result: { content: 'approved result' },
    });
    expect(remote.resolveToolApproval).toHaveBeenCalledWith({
      invocationId: 'inv-original',
      decision: 'approved',
      toolId: tool.id,
      args: { query: 'mira' },
      signal: undefined,
    });
  });

  it('projects an uncertain approval dispatch as a ToolGatewayError', async () => {
    const remote = host();
    remote.resolveToolApproval.mockRejectedValue(
      new RemoteHostError(
        'TOOL_APPROVAL_UNCERTAIN',
        'Mira Host may have accepted the approval',
      ),
    );
    const client = new RemoteToolGatewayClient(remote as never);
    await client.listTools();

    await expect(
      client.resolveApproval(
        {
          invocationId: 'inv-uncertain',
          callId: request.callId,
          name: request.name,
          arguments: request.arguments,
          message: 'Approval required',
        },
        'approved',
      ),
    ).rejects.toMatchObject({
      name: 'ToolGatewayError',
      code: 'TOOL_APPROVAL_UNCERTAIN',
    });
  });

  it('cancels the real remote invocation after tool:start is consumed', async () => {
    const remote = host();
    let release: (() => void) | null = null;
    let markStartConsumed!: () => void;
    const startConsumed = new Promise<void>(resolve => {
      markStartConsumed = resolve;
    });
    const abort = jest.fn(() => release?.());
    remote.openToolInvocation.mockResolvedValue({
      abort,
      events: (async function* () {
        yield {
          type: 'tool:start' as const,
          invocationId: 'inv-running',
          toolId: tool.id,
        };
        markStartConsumed();
        await new Promise<void>(resolve => {
          release = resolve;
        });
      })(),
    });
    const client = new RemoteToolGatewayClient(remote as never);
    const controller = new AbortController();

    const promise = client.callTool(request, { signal: controller.signal });
    await startConsumed;
    controller.abort();

    await expect(promise).rejects.toMatchObject({
      code: 'TOOL_CANCELLED',
    });
    expect(abort).toHaveBeenCalled();
    expect(remote.cancelToolInvocation).toHaveBeenCalledWith('inv-running');
  });

  it('keeps cancellation pending until a delayed tool:start reveals the invocation id', async () => {
    const remote = host();
    let markSessionOpened: (() => void) | null = null;
    const sessionOpened = new Promise<void>(resolve => {
      markSessionOpened = resolve;
    });
    let releaseStart!: () => void;
    const startGate = new Promise<void>(resolve => {
      releaseStart = resolve;
    });
    let rejectAfterStart!: (error: Error) => void;
    const afterStart = new Promise<void>((_resolve, reject) => {
      rejectAfterStart = reject;
    });
    const abort = jest.fn(() => rejectAfterStart(new Error('aborted')));
    remote.openToolInvocation.mockImplementation(async () => {
      markSessionOpened?.();
      return {
        abort,
        events: (async function* () {
          await startGate;
          yield {
            type: 'tool:start' as const,
            invocationId: 'inv-delayed',
            toolId: tool.id,
          };
          await afterStart;
        })(),
      };
    });
    const client = new RemoteToolGatewayClient(remote as never);
    const controller = new AbortController();

    const promise = client.callTool(request, { signal: controller.signal });
    await sessionOpened;
    controller.abort();
    expect(abort).not.toHaveBeenCalled();
    expect(remote.cancelToolInvocation).not.toHaveBeenCalled();

    releaseStart();

    await expect(promise).rejects.toMatchObject({
      code: 'TOOL_CANCELLED',
    });
    expect(remote.cancelToolInvocation).toHaveBeenCalledWith('inv-delayed');
    expect(abort).toHaveBeenCalled();
  });

  it('uses bounded SSE disconnect fallback when tool:start never arrives', async () => {
    jest.useFakeTimers();
    try {
      const remote = host();
      let markSessionOpened: (() => void) | null = null;
      const sessionOpened = new Promise<void>(resolve => {
        markSessionOpened = resolve;
      });
      let rejectEvents: ((error: unknown) => void) | null = null;
      const eventFailure = new Promise<never>((_resolve, reject) => {
        rejectEvents = reject;
      });
      const abort = jest.fn(() => {
        rejectEvents?.(new Error('aborted'));
      });
      remote.openToolInvocation.mockImplementation(async () => {
        markSessionOpened?.();
        return {
          abort,
          events: {
            [Symbol.asyncIterator]() {
              return {
                next: () => eventFailure,
              };
            },
          },
        };
      });
      const client = new RemoteToolGatewayClient(remote as never);
      const controller = new AbortController();

      const promise = client.callTool(request, { signal: controller.signal });
      const cancelled = expect(promise).rejects.toMatchObject({
        code: 'TOOL_CANCELLED',
      });
      await sessionOpened;
      controller.abort();
      expect(abort).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(750);

      await cancelled;
      expect(abort).toHaveBeenCalledTimes(1);
      expect(remote.cancelToolInvocation).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the previous alias map when a refresh contains duplicate aliases', async () => {
    const remote = host();
    const client = new RemoteToolGatewayClient(remote as never);
    await client.listTools();

    remote.listRemoteTools.mockResolvedValueOnce([
      tool,
      { ...tool, id: 'other-tool' },
    ]);

    await expect(client.listTools()).rejects.toMatchObject({
      code: 'TOOL_ALIAS_CONFLICT',
    });

    remote.openToolInvocation.mockResolvedValue({
      abort: jest.fn(),
      events: (async function* () {
        yield {
          type: 'tool:complete' as const,
          invocation: {
            invocationId: 'inv-old-map',
            toolId: tool.id,
            status: 'completed' as const,
            content: 'still mapped',
          },
        };
      })(),
    });

    await expect(client.callTool(request)).resolves.toEqual({
      content: 'still mapped',
    });
    expect(remote.openToolInvocation).toHaveBeenCalledWith({
      toolId: tool.id,
      args: { query: 'mira' },
    });
  });

  it('rejects non-object arguments before any remote invocation', async () => {
    const remote = host();
    const client = new RemoteToolGatewayClient(remote as never);
    await client.listTools();

    await expect(
      client.callTool({ ...request, arguments: '[]' }),
    ).rejects.toMatchObject({
      code: 'TOOL_ARGUMENTS_INVALID',
    });
    expect(remote.openToolInvocation).not.toHaveBeenCalled();
  });
});
