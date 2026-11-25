import {
  LocalToolGatewayClient,
  localToolGatewayClient,
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
  it('registers the local web tool and no dedicated weather tool', async () => {
    const names = (await localToolGatewayClient.listTools()).map(tool => tool.name);
    expect(names).toContain('web');
    expect(names).not.toContain('local_weather_current');
    expect(names).not.toContain('web_fetch');
    expect(names).not.toContain('whoyou_mail_search');
    expect(names).not.toContain('whoyou_mail_message_get');
  });

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

describe('MOB-086 privacy consent arguments cannot spoof the approval UI', () => {
  const search = jest.fn(async () => ({ content: 'safe fixture' }));
  const gateway = new LocalToolGatewayClient([{
    manifest: { name: 'whoyou_mail_search', parameters: { type: 'object' }, sensitiveResult: 'mail-search' },
    disclosure: { message: 'Your model will receive the result.', scope: 'one search' },
    call: search,
  }]);

  beforeEach(() => search.mockClear());

  async function approvalFor(query: string) {
    try {
      await gateway.callTool({
        callId: 'model-call',
        name: 'whoyou_mail_search',
        arguments: JSON.stringify({ query }),
      });
    } catch (error) {
      if (error instanceof ToolApprovalRequiredError) return error.approval;
      throw error;
    }
    throw new Error('Expected explicit approval');
  }

  it('shows the entire actual normalized query even after 120 spaces', async () => {
    const approval = await approvalFor(' '.repeat(120) + 'hidden');
    expect(approval.message).toContain('搜索词："hidden"');
    expect(approval.message).not.toContain(' '.repeat(120));
    expect(search).not.toHaveBeenCalled();
    await gateway.resolveApproval(approval, 'approved');
    expect(search).toHaveBeenCalledWith({ query: 'hidden' }, expect.anything());
  });

  it('escapes line breaks and unicode separators so input cannot forge a recipient line', async () => {
    const approval = await approvalFor('urgent\n接收方：attacker.test\u2028假范围');
    expect(approval.message.split('\n')).toHaveLength(2);
    expect(approval.message).toContain('urgent\\n接收方');
    expect(approval.message).toContain('\\u2028');
    expect(approval.message).not.toContain('\n接收方：attacker.test');
    expect(search).not.toHaveBeenCalled();
  });

  it('rejects arguments too long to display without ever fetching mail', async () => {
    await expect(gateway.callTool({
      callId: 'model-call',
      name: 'whoyou_mail_search',
      arguments: JSON.stringify({ query: 'x'.repeat(201) }),
    })).rejects.toMatchObject({ code: 'WHOYOU_ARGUMENT_INVALID' });
    expect(search).not.toHaveBeenCalled();
  });
});
