import type { OpenAiMessage, OpenAiTool } from '../provider/openAiStandardClient';
import type { RuntimeEvent } from './conversationRuntime';
import { PiCoreAgentLoop } from './piAgentLoop';
import type { ToolGatewayClient, ToolManifest } from '../tools/toolGatewayClient';
import type { AgentExecutionStrengthId } from '../settings/agentExecutionStrength';

// These tests execute the real Pi Agent. Only the model stream and the remote
// tool gateway boundary are scripted; budget enforcement, round counting and
// the final tool-less request run in the production loop.

const manifest: ToolManifest = {
  name: 'echo',
  description: 'Echo a value',
  parameters: {
    type: 'object',
    properties: { value: { type: 'string' } },
  },
};

const budgetMessage = (messages: readonly OpenAiMessage[]): string | null =>
  messages.find((message) =>
    message.role === 'system' &&
    typeof message.content === 'string' &&
    message.content.includes('[Trusted execution budget')
  )?.content ?? null;

const budgetValue = (message: string, key: string): number => {
  const match = message.match(new RegExp(`${key}: (\\d+)`));
  if (!match) throw new Error(`Missing ${key} in budget context`);
  return Number(match[1]);
};

const collect = async (stream: AsyncIterable<RuntimeEvent>) => {
  const events: RuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
};

const createGateway = () => {
  const callTool = jest.fn(async (_request: unknown) => ({
    content: 'ok',
  }));
  const listTools = jest.fn(async () => [manifest]);
  const gateway: ToolGatewayClient = { listTools, callTool };
  return { gateway, callTool, listTools };
};

describe('Pi Core execution strengths', () => {
  it.each([
    ['light', 8],
    ['standard', 24],
  ] as const)(
    'enforces the %s limit with a final tool-less summarization round',
    async (strength: AgentExecutionStrengthId, expectedRounds: number) => {
      const { gateway, callTool } = createGateway();
      const remainingByRound: number[] = [];
      const remainingTimeByRound: number[] = [];
      const toolCounts: number[] = [];
      let round = 0;

      const events = await collect(await new PiCoreAgentLoop(gateway).run(
        [{ role: 'user', content: 'work' }],
        async (messages, tools: readonly OpenAiTool[]) => {
          const facts = budgetMessage(messages);
          if (!facts) throw new Error('missing trusted budget context');
          remainingByRound.push(
            budgetValue(facts, 'remaining_tool_rounds'),
          );
          remainingTimeByRound.push(
            budgetValue(facts, 'remaining_time_seconds'),
          );
          toolCounts.push(tools.length);
          round += 1;
          if (tools.length === 0) {
            return (async function* () {
              yield { type: 'text-delta' as const, delta: 'final summary' };
              yield { type: 'finish' as const, reason: 'stop' };
            })();
          }
          return (async function* () {
            yield { type: 'text-delta' as const, delta: `step ${round}` };
            yield {
              type: 'tool-call' as const,
              callId: `call-${round}`,
              name: 'echo',
              arguments: `{"value":"${round}"}`,
            };
            yield { type: 'finish' as const, reason: 'tool_calls' };
          })();
        },
        { strength },
      ));

      expect(callTool).toHaveBeenCalledTimes(expectedRounds);
      expect(round).toBe(expectedRounds + 1);
      // The final request has no tool schema: that is the one summary round.
      expect(toolCounts.at(-1)).toBe(0);
      expect(remainingByRound).toEqual([
        expectedRounds,
        ...Array.from({ length: expectedRounds }, (_, index) =>
          expectedRounds - index - 1),
      ]);
      for (let index = 1; index < remainingTimeByRound.length; index += 1) {
        expect(remainingTimeByRound[index])
          .toBeLessThanOrEqual(remainingTimeByRound[index - 1]);
      }
      expect(events).toContainEqual({
        type: 'text-delta', delta: 'final summary',
      });
      expect(events).toContainEqual({ type: 'finish', reason: 'stop' });
      expect(events.some((event) => event.type === 'error')).toBe(false);
    },
  );

  it('allows deep execution to exceed the old 64-round ceiling', async () => {
    const { gateway, callTool } = createGateway();
    let round = 0;
    const events = await collect(await new PiCoreAgentLoop(gateway).run(
      [{ role: 'user', content: 'long task' }],
      async () => {
        round += 1;
        if (round > 70) {
          return (async function* () {
            yield { type: 'text-delta' as const, delta: 'finished after 70' };
            yield { type: 'finish' as const, reason: 'stop' };
          })();
        }
        return (async function* () {
          yield {
            type: 'tool-call' as const,
            callId: `deep-${round}`,
            name: 'echo',
            arguments: '{"value":"deep"}',
          };
          yield { type: 'finish' as const, reason: 'tool_calls' };
        })();
      },
      { strength: 'deep' },
    ));

    expect(round).toBe(71);
    expect(callTool).toHaveBeenCalledTimes(70);
    expect(events).toContainEqual({
      type: 'text-delta', delta: 'finished after 70',
    });
    expect(events).toContainEqual({ type: 'finish', reason: 'stop' });
  });

  it('counts a round with multiple tools as one tool round', async () => {
    const { gateway, callTool } = createGateway();
    const toolCounts: number[] = [];
    let round = 0;

    await collect(await new PiCoreAgentLoop(gateway).run(
      [{ role: 'user', content: 'batch' }],
      async (_messages, tools: readonly OpenAiTool[]) => {
        round += 1;
        toolCounts.push(tools.length);
        if (tools.length === 0) {
          return (async function* () {
            yield { type: 'text-delta' as const, delta: 'batch summary' };
            yield { type: 'finish' as const, reason: 'stop' };
          })();
        }
        return (async function* () {
          yield {
            type: 'tool-call' as const,
            callId: 'batch-1',
            name: 'echo',
            arguments: '{"value":"1"}',
          };
          yield {
            type: 'tool-call' as const,
            callId: 'batch-2',
            name: 'echo',
            arguments: '{"value":"2"}',
          };
          yield {
            type: 'tool-call' as const,
            callId: 'batch-3',
            name: 'echo',
            arguments: '{"value":"3"}',
          };
          yield { type: 'finish' as const, reason: 'tool_calls' };
        })();
      },
      // One allowed round isolates the same-round tool-counting contract.
      { strength: 'light', maxToolRounds: 1 },
    ));

    expect(callTool).toHaveBeenCalledTimes(3);
    expect(round).toBe(2);
    expect(toolCounts).toEqual([1, 0]);
  });

  it('does not claim completion when the hard deadline expires during a run', async () => {
    const { gateway } = createGateway();
    const events = await collect(await new PiCoreAgentLoop(gateway).run(
      [{ role: 'user', content: 'slow' }],
      async () => (async function* () {
        yield { type: 'text-delta' as const, delta: 'partial' };
        await new Promise<void>(() => undefined);
      })(),
      { strength: 'light', overallTimeoutMs: 20 },
    ));

    expect(events).toContainEqual({
      type: 'run-paused', reason: 'timeout',
    });
    expect(events.some(
      (event) => event.type === 'finish' && event.reason === 'stop',
    )).toBe(false);
  });
});
