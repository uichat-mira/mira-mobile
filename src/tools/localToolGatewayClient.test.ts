import {
  LocalToolGatewayClient,
  type LocalToolDefinition,
} from './localToolGatewayClient';
import type { ToolManifest } from './toolGatewayClient';

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
