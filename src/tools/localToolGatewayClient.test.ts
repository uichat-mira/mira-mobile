import {
  LocalToolGatewayClient,
  type LocalToolDefinition,
} from './localToolGatewayClient';
import { ToolApprovalRequiredError, type ToolManifest } from './toolGatewayClient';

const manifest: ToolManifest = {
  name: 'local_test_echo',
  description: 'Echo arguments',
  parameters: {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
  },
  destructive: false,
  requiresApproval: false,
};

const echoTool: LocalToolDefinition = {
  manifest,
  call: async (args) => ({ content: JSON.stringify(args) }),
};

describe('LocalToolGatewayClient', () => {
  it('lists compiled-in local tools', async () => {
    const gateway = new LocalToolGatewayClient([echoTool]);

    await expect(gateway.listTools()).resolves.toEqual([manifest]);
  });

  it('parses JSON arguments before calling a local tool', async () => {
    const gateway = new LocalToolGatewayClient([echoTool]);

    await expect(
      gateway.callTool({
        callId: 'call-1',
        name: manifest.name,
        arguments: '{"value":"hello"}',
      }),
    ).resolves.toEqual({ content: '{"value":"hello"}' });
  });

  it('rejects unknown local tools', async () => {
    const gateway = new LocalToolGatewayClient([echoTool]);

    await expect(
      gateway.callTool({
        callId: 'call-1',
        name: 'local_missing',
        arguments: '{}',
      }),
    ).rejects.toMatchObject({ code: 'TOOL_NOT_FOUND' });
  });

  it('rejects non-object arguments', async () => {
    const gateway = new LocalToolGatewayClient([echoTool]);

    await expect(
      gateway.callTool({
        callId: 'call-1',
        name: manifest.name,
        arguments: '[]',
      }),
    ).rejects.toMatchObject({ code: 'TOOL_ARGUMENTS_INVALID' });
  });

  it('rejects duplicate tool names at construction time', () => {
    expect(
      () => new LocalToolGatewayClient([echoTool, echoTool]),
    ).toThrow('Duplicate local tool name');
  });
});

describe('Local Tool consent and one-shot lifecycle', () => {
  const privateTool: LocalToolDefinition = {
    manifest: { name: 'private_search', parameters: { type: 'object' }, requiresApproval: true, sensitiveResult: 'mail-search' },
    disclosure: { message: 'Disclose only this result', scope: 'one message' },
    call: jest.fn(async () => ({ content: 'UNTRUSTED_EMAIL_CONTENT fixture' })),
  };

  beforeEach(() => jest.clearAllMocks());

  it('does not fetch or emit mail until user explicitly approves; approval cannot be replayed', async () => {
    const gateway = new LocalToolGatewayClient([privateTool]);
    const request = { callId: 'call-1', name: 'private_search', arguments: '{}' };
    let approval: import('./toolGatewayClient').ToolApprovalRequest | null = null;
    try { await gateway.callTool(request); } catch (error) {
      if (error instanceof ToolApprovalRequiredError) approval = error.approval;
      else throw error;
    }
    expect(approval).not.toBeNull();
    expect(privateTool.call).not.toHaveBeenCalled();
    const authorized = await gateway.resolveApproval(approval!, 'approved');
    expect(authorized).toMatchObject({ status: 'completed', result: { content: 'UNTRUSTED_EMAIL_CONTENT fixture' } });
    expect(privateTool.call).toHaveBeenCalledTimes(1);
    await expect(gateway.resolveApproval(approval!, 'approved')).rejects.toMatchObject({ code: 'TOOL_APPROVAL_STALE' });
  });

  it('rejects without calling tool, and refuses stale cross-invocation approval', async () => {
    const gateway = new LocalToolGatewayClient([privateTool]);
    let one: import('./toolGatewayClient').ToolApprovalRequest | null = null;
    try { await gateway.callTool({ callId: 'one', name: 'private_search', arguments: '{}' }); } catch (error) {
      if (error instanceof ToolApprovalRequiredError) one = error.approval;
      else throw error;
    }
    expect(await gateway.resolveApproval(one!, 'rejected')).toEqual({ status: 'rejected' });
    expect(privateTool.call).not.toHaveBeenCalled();
    try { await gateway.callTool({ callId: 'two', name: 'private_search', arguments: '{}' }); } catch { /* next approval */ }
    await expect(gateway.resolveApproval(one!, 'approved')).rejects.toMatchObject({ code: 'TOOL_APPROVAL_STALE' });
  });
});
