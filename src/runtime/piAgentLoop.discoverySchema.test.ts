import { FakeXhr, sse } from '../provider/openAiStandardClientTestSupport';
import { OpenAiStandardClient } from '../provider/openAiStandardClient';
import { PiCoreAgentLoop } from './piAgentLoop';
import type { ToolGatewayClient, ToolManifest } from '../tools/toolGatewayClient';

const objectVariant = (operation: string) => ({
  type: 'object',
  additionalProperties: false,
  required: ['operation', 'repository'],
  properties: {
    operation: { type: 'string', enum: [operation] },
    repository: { type: 'string' },
  },
});

const objectOneOf = {
  oneOf: [objectVariant('list'), objectVariant('get')],
};

const manifest = (
  name: string,
  parameters: Record<string, unknown> = {
    type: 'object',
    properties: { query: { type: 'string' } },
  },
): ToolManifest => ({
  name,
  description: name + ' description',
  parameters,
});

test('Pi Core sends object-only root oneOf as an object in actual continuation wire without changing Host schemas', async () => {
  const remote = [
    'github_repository',
    'github_issue',
    'github_pull_request',
    'github_actions',
  ].map(name => manifest(name, objectOneOf));
  const mixedOneOf = {
    oneOf: [objectVariant('get'), { type: 'string' }],
  };
  const mixed = manifest('unsupported_mixed_schema', mixedOneOf);
  const local = manifest('web');
  const discovery: ToolManifest = {
    name: 'mira_desktop_hosts',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  };
  const xhrs = [
    new FakeXhr(sse(
      { choices: [{ delta: { tool_calls: [{
        index: 0,
        id: 'call-desktop-1',
        type: 'function',
        function: { name: 'mira_desktop_hosts', arguments: '{}' },
      }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      '[DONE]',
    )),
    new FakeXhr(sse(
      { choices: [{ delta: { content: 'Desktop discovery complete.' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      '[DONE]',
    )),
  ];
  let requestIndex = 0;
  const client = new OpenAiStandardClient({
    baseUrl: 'https://provider.example.com',
    apiKey: 'test-only',
    protocol: 'openai-chat-completions',
    xhrFactory: () => {
      const xhr = xhrs[requestIndex++];
      if (!xhr) throw new Error('unexpected extra provider request');
      return xhr as unknown as XMLHttpRequest;
    },
  });
  const callTool = jest.fn(async () => ({
    content: 'Desktop connected',
    refreshedTools: [local, ...remote, mixed],
  }));
  const gateway: ToolGatewayClient = {
    discoverTools: async () => ({ tools: [local, discovery], notices: [] }),
    listTools: async () => [local, discovery],
    callTool,
  };
  const events = [];
  for await (const event of await new PiCoreAgentLoop(gateway).run(
    [{ role: 'system', content: 'sys' }, { role: 'user', content: 'Discover Desktop' }],
    async (messages, tools) => client.streamMessages({
      model: 'deepseek-v4.1-flash-od',
      messages: [...messages],
      tools: [...tools],
    }),
  )) {
    events.push(event);
  }

  expect(requestIndex).toBe(2);
  expect(callTool).toHaveBeenCalledTimes(1);
  expect(events.some(event => event.type === 'text-delta' && event.delta.includes('Desktop discovery complete.'))).toBe(true);

  type WireTool = { function: { name: string; parameters: Record<string, unknown> } };
  type WireMessage = {
    role: string;
    tool_call_id?: string;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  };
  const first = JSON.parse(xhrs[0].requestBody ?? '{}') as {
    tools?: WireTool[];
  };
  const second = JSON.parse(xhrs[1].requestBody ?? '{}') as {
    tools?: WireTool[];
    messages?: WireMessage[];
  };
  expect(first.tools?.map(item => item.function.name))
    .toEqual(['web', 'mira_desktop_hosts']);
  expect(second.tools).toHaveLength(6);
  for (const tool of remote) {
    const wireSchema = second.tools?.find(item => item.function.name === tool.name)?.function.parameters;
    expect(wireSchema).toEqual({ ...objectOneOf, type: 'object' });
    expect(wireSchema?.oneOf).toEqual(objectOneOf.oneOf);
    expect(tool.parameters).toBe(objectOneOf);
    expect(tool.parameters).not.toHaveProperty('type');
  }
  // Never rewrite schemas that are not provably object-only: fail visibly upstream.
  expect(second.tools?.find(item => item.function.name === mixed.name)?.function.parameters)
    .toEqual(mixedOneOf);
  expect(second.messages?.map(message => message.role))
    .toEqual(['system', 'user', 'assistant', 'tool']);
  expect(second.messages?.at(-2)?.tool_calls?.[0]).toEqual({
    id: 'call-desktop-1',
    type: 'function',
    function: { name: 'mira_desktop_hosts', arguments: '{}' },
  });
  expect(second.messages?.at(-1)?.tool_call_id).toBe('call-desktop-1');
});
