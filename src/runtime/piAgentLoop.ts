import { Agent } from '@earendil-works/pi-agent-core';
import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  StreamFn,
} from '@earendil-works/pi-agent-core';
import {
  contentText,
  createAssistantMessageEventStream,
  getSystemMessageText,
} from '@earendil-works/pi-ai';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  JsonObject,
  Message,
  Model,
  ToolCall,
  Usage,
} from '@earendil-works/pi-ai';
import type { OpenAiMessage, OpenAiTool } from '../provider/openAiStandardClient';
import type { RuntimeEvent } from './conversationRuntime';
import type {
  AgentModelCall,
  MobileAgentLoopOptions,
} from './mobileAgentLoop';
import {
  ToolApprovalRequiredError,
  ToolGatewayError,
  type ToolApprovalDecision,
  type ToolCallResult,
  type ToolGatewayClient,
  type ToolManifest,
} from '../tools/toolGatewayClient';
import { limitToolResult } from '../tools/toolPolicy';

// Experimental Pi Core Agent Loop for the Local Provider path.
//
// This bridge is intentionally not the default execution path. It lets Mira's
// existing Local Provider executor and Tool Gateway drive pi-agent-core's real
// agent loop without moving credentials, Host authority, approval, or tool
// execution into Pi. Provider calls still go through LocalProviderExecutor and
// tools still go through ToolGatewayClient, so the current permission boundary
// is unchanged.
//
// Deliberate v1 limits (the MobileAgentLoop remains authoritative for these):
// - mailbox-sensitive tools are not exposed until the mail chaining policy is
//   ported as a shared contract;
// - Cloud Desktop host selection is not automated; a discovery result ends the
//   run with an explicit error instead of guessing a Host.

const PI_AGENT_MAX_TOOL_ROUNDS = 8;
const PI_AGENT_TIMEOUT_MS = 5 * 60 * 1000;

const createUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

const PI_MODEL: Model<'mira-local-provider'> = {
  id: 'mira-local-provider',
  name: 'Mira Local Provider',
  api: 'mira-local-provider',
  provider: 'mira',
  baseUrl: '',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 0,
  maxTokens: 0,
};

const abortError = (): Error => {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
};

class PiApprovalRejectedError extends Error {
  constructor() {
    super('Tool approval was rejected');
    this.name = 'PiApprovalRejectedError';
  }
}

class RuntimeEventQueue implements AsyncIterable<RuntimeEvent> {
  private readonly values: RuntimeEvent[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<RuntimeEvent>) => void;
  }> = [];
  private closed = false;

  push(value: RuntimeEvent): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value });
      return;
    }
    this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) {
          return Promise.resolve({ done: false, value });
        }
        if (this.closed) {
          return Promise.resolve({ done: true, value: undefined });
        }
        return new Promise((resolve) => {
          this.waiters.push({ resolve });
        });
      },
      return: () => {
        this.close();
        return Promise.resolve({ done: true, value: undefined });
      },
    };
  }
}

const isDegradableToolChannelError = (error: unknown): boolean =>
  error instanceof ToolGatewayError &&
  error.code === 'TOOL_CHANNEL_UNAVAILABLE';

const toTool = (manifest: ToolManifest): OpenAiTool => ({
  type: 'function',
  function: {
    name: manifest.name,
    ...(manifest.description ? { description: manifest.description } : {}),
    parameters: manifest.parameters,
  },
});

const toAssistantMessage = (
  content: string,
  timestamp: number,
): AssistantMessage => ({
  role: 'assistant',
  content: content ? [{ type: 'text', text: content }] : [],
  api: PI_MODEL.api,
  provider: PI_MODEL.provider,
  model: PI_MODEL.id,
  usage: createUsage(),
  stopReason: 'stop',
  timestamp,
});

const toAgentMessages = (
  messages: readonly OpenAiMessage[],
): AgentMessage[] => {
  const timestamp = Date.now();
  return messages.flatMap<AgentMessage>((message) => {
    if (message.role === 'system') {
      return [{
        role: 'system',
        content: message.content ?? '',
        timestamp,
      }];
    }
    if (message.role === 'tool') {
      return [{
        role: 'toolResult',
        toolCallId: message.tool_call_id ?? '',
        toolName: '',
        content: [{ type: 'text', text: message.content ?? '' }],
        isError: false,
        timestamp,
      }];
    }
    if (message.role === 'assistant') {
      const toolCalls: ToolCall[] = (message.tool_calls ?? []).flatMap((call) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(call.function.arguments || '{}');
        } catch {
          parsed = {};
        }
        return [{
          type: 'toolCall',
          id: call.id,
          name: call.function.name,
          arguments:
            parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              ? (parsed as JsonObject)
              : ({} as JsonObject),
        }];
      });
      return [{
        ...toAssistantMessage(message.content ?? '', timestamp),
        content: [
          ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
          ...toolCalls,
        ],
      }];
    }
    return [{
      role: 'user',
      content: message.content ?? '',
      timestamp,
    }];
  });
};

const assistantText = (content: readonly { type: string; text?: string }[]): string =>
  content.flatMap((block) =>
    block.type === 'text' && typeof block.text === 'string' ? [block.text] : [],
  ).join('');

const toOpenAiMessages = (messages: readonly Message[]): OpenAiMessage[] => {
  const result: OpenAiMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      const text = getSystemMessageText(message);
      if (text) result.push({ role: 'system', content: text });
      continue;
    }
    if (message.role === 'user') {
      result.push({ role: 'user', content: contentText(message.content) });
      continue;
    }
    if (message.role === 'toolResult') {
      result.push({
        role: 'tool',
        content: contentText(message.content),
        tool_call_id: message.toolCallId,
      });
      continue;
    }
    const toolCalls = message.content.flatMap((block) =>
      block.type === 'toolCall'
        ? [{
            id: block.id,
            type: 'function' as const,
            function: {
              name: block.name,
              arguments: JSON.stringify(block.arguments),
            },
          }]
        : [],
    );
    const text = assistantText(message.content);
    result.push({
      role: 'assistant',
      content: text || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
  }
  return result;
};

const nextWithAbort = <T>(
  iterator: AsyncIterator<T>,
  signal?: AbortSignal,
): Promise<IteratorResult<T>> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve({ done: true, value: undefined });
      return;
    }
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      resolve({ done: true, value: undefined });
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    iterator.next().then(
      (result) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });

const toStopReason = (reason: string | null | undefined): {
  stopReason: AssistantMessage['stopReason'];
  doneReason: 'stop' | 'length' | 'toolUse';
} => {
  if (reason === 'tool_calls' || reason === 'toolUse') {
    return { stopReason: 'toolUse', doneReason: 'toolUse' };
  }
  if (reason === 'length') {
    return { stopReason: 'length', doneReason: 'length' };
  }
  return { stopReason: 'stop', doneReason: 'stop' };
};

/**
 * Converts one Mira Local Provider model round into a pi-ai assistant stream.
 * Provider output remains owned by LocalProviderExecutor; this function only
 * translates the wire events into Pi's assistant protocol.
 */
const createPiStreamFn = (
  modelCall: AgentModelCall,
  tools: readonly OpenAiTool[],
): StreamFn =>
  (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    const output: AssistantMessage = {
      role: 'assistant',
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: createUsage(),
      stopReason: 'pending',
      timestamp: Date.now(),
    };
    const signal = options?.signal;

    (async () => {
      let iterator: AsyncIterator<RuntimeEvent> | null = null;
      let finishReason: string | null | undefined;
      try {
        if (signal?.aborted) throw abortError();
        const providerStream = await modelCall(
          toOpenAiMessages(context.messages),
          tools,
        );
        stream.push({ type: 'start', partial: output });
        iterator = providerStream[Symbol.asyncIterator]();
        while (true) {
          const next = await nextWithAbort(iterator, signal);
          if (next.done) break;
          const event = next.value;
          if (event.type === 'text-delta') {
            let block = output.content.find((item) => item.type === 'text');
            if (!block || block.type !== 'text') {
              block = { type: 'text', text: '' };
              output.content.push(block);
              stream.push({
                type: 'text_start',
                contentIndex: output.content.length - 1,
                partial: output,
              });
            }
            block.text += event.delta;
            stream.push({
              type: 'text_delta',
              contentIndex: output.content.indexOf(block),
              delta: event.delta,
              partial: output,
            });
            continue;
          }
          if (event.type === 'tool-call') {
            let parsed: JsonObject = {};
            let argumentsError: string | undefined;
            try {
              const value: unknown = JSON.parse(event.arguments || '{}');
              if (value && typeof value === 'object' && !Array.isArray(value)) {
                parsed = value as JsonObject;
              } else {
                argumentsError = 'Tool arguments must be a JSON object';
              }
            } catch {
              argumentsError = 'Tool arguments are not valid JSON';
            }
            const block: ToolCall = {
              type: 'toolCall',
              id: event.callId,
              name: event.name,
              arguments: parsed,
              ...(argumentsError ? { argumentsError } : {}),
            };
            output.content.push(block);
            const contentIndex = output.content.length - 1;
            stream.push({
              type: 'toolcall_start',
              contentIndex,
              partial: output,
            });
            stream.push({
              type: 'toolcall_delta',
              contentIndex,
              delta: argumentsError ? '' : JSON.stringify(parsed),
              partial: output,
            });
            stream.push({
              type: 'toolcall_end',
              contentIndex,
              toolCall: block,
              partial: output,
            });
            continue;
          }
          if (event.type === 'finish') {
            finishReason = event.reason;
            continue;
          }
          if (event.type === 'error') {
            throw new Error(event.message);
          }
        }

        if (signal?.aborted) throw abortError();
        const { stopReason, doneReason } = toStopReason(finishReason);
        output.stopReason = stopReason;
        // MobileAgentLoop only acts on tool calls when the provider explicitly
        // finished with tool_calls. Do not let a malformed round execute tools
        // because it emitted a tool-call event under a normal stop reason.
        if (doneReason !== 'toolUse') {
          output.content = output.content.filter((block) => block.type !== 'toolCall');
        }
        stream.push({ type: 'done', reason: doneReason, message: output });
        stream.end();
      } catch (error) {
        output.stopReason = signal?.aborted ? 'aborted' : 'error';
        output.errorMessage =
          error instanceof Error ? error.message : String(error);
        stream.push({
          type: 'error',
          reason: output.stopReason,
          error: output,
        });
        stream.end();
      } finally {
        if (iterator) {
          const closing = iterator.return?.(undefined);
          closing?.catch(() => undefined);
        }
      }
    })().catch(() => undefined);

    return stream;
  };

const resultText = (result: unknown): string => {
  if (!result || typeof result !== 'object') return '';
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return content.flatMap((block) => {
    if (!block || typeof block !== 'object') return [];
    const text = (block as { text?: unknown }).text;
    return typeof text === 'string' ? [text] : [];
  }).join('');
};

export class PiCoreAgentLoop {
  constructor(private readonly gateway: ToolGatewayClient) {}

  async run(
    initialMessages: readonly OpenAiMessage[],
    modelCall: AgentModelCall,
    options: MobileAgentLoopOptions = {},
  ): Promise<AsyncIterable<RuntimeEvent>> {
    let manifests: readonly ToolManifest[];
    let notices: RuntimeEvent[] = [];
    try {
      if (this.gateway.discoverTools) {
        const discovery = await this.gateway.discoverTools();
        manifests = discovery.tools;
        notices = discovery.notices.map((notice) => ({
          type: 'notice',
          code: notice.code,
        }));
      } else {
        manifests = await this.gateway.listTools();
      }
    } catch (error) {
      if (
        (options.onToolChannelUnavailable ?? 'fail') !==
          'continue-without-tools' ||
        !isDegradableToolChannelError(error)
      ) {
        throw error;
      }
      manifests = [];
      notices = [{ type: 'notice', code: 'tool-channel-unavailable' }];
    }
    const safeManifests = manifests.filter(
      (manifest) => manifest.sensitiveResult === undefined,
    );
    if (safeManifests.length !== manifests.length) {
      notices = [...notices, { type: 'notice', code: 'toolset-degraded' }];
    }
    const tools = safeManifests.map(toTool);
    const queue = new RuntimeEventQueue();
    const maxToolRounds = options.maxToolRounds ?? PI_AGENT_MAX_TOOL_ROUNDS;
    const maxToolResultBytes = options.maxToolResultBytes;
    const deadline = Date.now() + (options.overallTimeoutMs ?? PI_AGENT_TIMEOUT_MS);
    const shouldPause = options.shouldPause ?? (() => false);
    const externalSignal = options.signal;
    const gateway = this.gateway;
    const requestApproval = options.requestApproval;

    return (async function* () {
      if (externalSignal?.aborted) {
        yield {
          type: 'run-paused',
          reason: shouldPause() ? 'app-suspended' : 'cancelled',
        };
        return;
      }
      if (shouldPause()) {
        yield { type: 'run-paused', reason: 'app-suspended' };
        return;
      }
      if (Date.now() >= deadline) {
        yield { type: 'run-paused', reason: 'timeout' };
        return;
      }

      for (const notice of notices) yield notice;

      let timedOut = false;
      let cancelled = false;
      let approvalRejected = false;
      let fatalError: string | null = null;
      let limitReached = false;
      let toolRounds = 0;
      let lastStopReason: AssistantMessage['stopReason'] | null = null;
      let terminalEmitted = false;
      let agent: Agent | null = null;
      let unsubscribe = () => {};

      const abortRun = () => {
        agent?.abort();
      };
      const onExternalAbort = () => {
        cancelled = true;
        abortRun();
      };
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
      const timeout = setTimeout(() => {
        timedOut = true;
        abortRun();
      }, Math.max(0, deadline - Date.now()));

      const executeTool = async (
        manifest: ToolManifest,
        callId: string,
        params: unknown,
        signal?: AbortSignal,
      ): Promise<AgentToolResult> => {
        const request = {
          callId,
          name: manifest.name,
          arguments: JSON.stringify(params ?? {}),
        };
        let result: ToolCallResult;
        try {
          result = await gateway.callTool(request, { signal });
        } catch (error) {
          if (signal?.aborted) throw error;
          if (
            error instanceof ToolApprovalRequiredError &&
            requestApproval &&
            gateway.resolveApproval
          ) {
            const approval = error.approval;
            queue.push({
              type: 'approval-required',
              invocationId: approval.invocationId,
              callId: approval.callId,
              name: approval.name,
              message: approval.message,
              ...(approval.scope ? { scope: approval.scope } : {}),
            });
            let decision: ToolApprovalDecision;
            try {
              decision = await new Promise<ToolApprovalDecision>((resolve, reject) => {
                if (signal?.aborted) {
                  reject(abortError());
                  return;
                }
                const onAbort = () => reject(abortError());
                signal?.addEventListener('abort', onAbort, { once: true });
                requestApproval(approval).then(
                  (value) => {
                    signal?.removeEventListener('abort', onAbort);
                    resolve(value);
                  },
                  (rejection: unknown) => {
                    signal?.removeEventListener('abort', onAbort);
                    reject(rejection);
                  },
                );
              });
            } catch (approvalError) {
              if (!signal?.aborted) {
                fatalError = approvalError instanceof Error
                  ? approvalError.message
                  : String(approvalError);
              }
              throw approvalError;
            }
            queue.push({
              type: 'approval-resolved',
              invocationId: approval.invocationId,
              callId: approval.callId,
              name: approval.name,
              decision,
            });
            const resolution = await gateway.resolveApproval(
              approval,
              decision,
              { signal },
            );
            if (decision === 'rejected' || resolution.status === 'rejected') {
              approvalRejected = true;
              throw new PiApprovalRejectedError();
            }
            result = resolution.result;
          } else {
            fatalError = error instanceof Error ? error.message : String(error);
            throw error;
          }
        }
        if (signal?.aborted) throw abortError();
        if (result.hostSelectionRequired) {
          // Host selection is a deterministic MobileAgentLoop policy. The
          // experimental Pi path must not bind or guess a Host itself.
          fatalError =
            'Pi Core 实验路径暂不支持自动选择 Desktop Host，请使用现有 Local Agent Loop。';
          throw new ToolGatewayError(
            'PI_AGENT_HOST_SELECTION_UNSUPPORTED',
            fatalError,
          );
        }
        const limited = limitToolResult(result.content, maxToolResultBytes);
        return {
          content: [{ type: 'text', text: limited }],
          details: { truncated: limited !== result.content },
        };
      };

      const agentTools: AgentTool[] = safeManifests.map((manifest) => ({
        name: manifest.name,
        description: manifest.description ?? '',
        parameters: manifest.parameters,
        label: manifest.name,
        executionMode: 'sequential',
        execute: async (callId, params, signal) =>
          executeTool(manifest, callId, params, signal),
      }));

      const streamFn = createPiStreamFn(modelCall, tools);

      const handleEvent = (event: AgentEvent): void => {
        if (event.type === 'message_update') {
          const update: AssistantMessageEvent = event.assistantMessageEvent;
          if (update.type === 'text_delta') {
            queue.push({ type: 'text-delta', delta: update.delta });
          } else if (update.type === 'toolcall_end') {
            queue.push({
              type: 'tool-call',
              callId: update.toolCall.id,
              name: update.toolCall.name,
              arguments: JSON.stringify(update.toolCall.arguments),
            });
          }
          return;
        }
        if (event.type === 'tool_execution_start') {
          queue.push({
            type: 'tool-running',
            callId: event.toolCallId,
            name: event.toolName,
          });
          return;
        }
        if (event.type === 'tool_execution_end') {
          if (approvalRejected || limitReached) return;
          if (event.isError) {
            if (!fatalError) {
              fatalError =
                resultText(event.result) || `Tool failed: ${event.toolName}`;
            }
            return;
          }
          const truncated =
            typeof event.result?.details === 'object' &&
            event.result.details !== null &&
            event.result.details.truncated === true;
          queue.push({
            type: 'tool-result',
            callId: event.toolCallId,
            name: event.toolName,
            content: resultText(event.result),
            ...(truncated ? { truncated: true } : {}),
          });
          return;
        }
        if (event.type === 'message_end' && event.message.role === 'assistant') {
          const message = event.message as AssistantMessage;
          lastStopReason = message.stopReason;
          if (message.stopReason === 'aborted') {
            terminalEmitted = true;
            if (!timedOut) {
              queue.push({
                type: 'run-paused',
                reason: shouldPause() ? 'app-suspended' : 'cancelled',
              });
            }
          } else if (message.stopReason === 'error') {
            terminalEmitted = true;
            fatalError = message.errorMessage ?? 'Pi Agent request failed';
          } else {
            queue.push({
              type: 'finish',
              reason: message.stopReason === 'toolUse'
                ? 'tool_calls'
                : message.stopReason === 'length' ? 'length' : 'stop',
            });
          }
        }
      };

      try {
        agent = new Agent({
          initialState: {
            model: PI_MODEL,
            messages: toAgentMessages(initialMessages),
            tools: agentTools,
          },
          streamFn,
          toolExecution: 'sequential',
          beforeToolCall: async () => {
            if (toolRounds >= maxToolRounds) {
              limitReached = true;
              return {
                block: true,
                terminate: true,
                reason: `Tool round limit reached (${maxToolRounds})`,
              };
            }
            return undefined;
          },
          finishTurn: (turn) => {
            if (approvalRejected || fatalError || timedOut || limitReached) {
              return { action: 'end' };
            }
            if (
              turn.message.role === 'assistant' &&
              turn.message.stopReason === 'toolUse' &&
              turn.toolResults.length > 0
            ) {
              toolRounds += 1;
            }
            return undefined;
          },
        });
        unsubscribe = agent.subscribe((event) => {
          handleEvent(event);
          if (event.type === 'agent_end') {
            queue.close();
          }
        });
        agent.continue()
          .finally(() => {
            queue.close();
          })
          .catch(() => undefined);

        const iterator = queue[Symbol.asyncIterator]();
        while (true) {
          const next = await iterator.next();
          if (next.done) break;
          yield next.value;
        }
      } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', onExternalAbort);
        unsubscribe();
        agent?.abort();
      }

      if (timedOut) {
        yield { type: 'run-paused', reason: 'timeout' };
        return;
      }
      if (cancelled && !terminalEmitted) {
        yield {
          type: 'run-paused',
          reason: shouldPause() ? 'app-suspended' : 'cancelled',
        };
        return;
      }
      if (approvalRejected) {
        yield { type: 'run-paused', reason: 'approval-rejected' };
        return;
      }
      if (limitReached) {
        yield {
          type: 'error',
          message: `Tool round limit reached (${maxToolRounds})`,
        };
        return;
      }
      if (fatalError) {
        // Provider and tool failures reject the stream, matching the existing
        // MobileAgentLoop so a partial answer is not persisted as a completed
        // turn and the UI reports a failed run.
        throw new Error(fatalError);
      }
      if (!terminalEmitted && lastStopReason === 'toolUse') {
        throw new Error('Pi Agent stopped without completing the tool round');
      } else if (!terminalEmitted && lastStopReason === null) {
        throw new Error('Pi Agent run ended without a response');
      }
    })();
  }
}

interface AgentToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details: { truncated: boolean };
}
