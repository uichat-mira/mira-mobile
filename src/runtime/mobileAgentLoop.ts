import type { OpenAiCompatibleMessage, OpenAiCompatibleTool } from '../provider/openAiCompatibleClient';
import type { RuntimeEvent } from './conversationRuntime';
import {
  ToolApprovalRequiredError,
  ToolGatewayError,
  type ToolApprovalDecision,
  type ToolApprovalRequest,
  type ToolGatewayClient,
  type ToolManifest,
} from '../tools/toolGatewayClient';
import { limitToolResult, validateToolCall } from '../tools/toolPolicy';

export interface MobileAgentLoopOptions {
  maxToolRounds?: number;
  overallTimeoutMs?: number;
  maxToolResultBytes?: number;
  shouldPause?: () => boolean;
  signal?: AbortSignal;
  requestApproval?: (
    approval: ToolApprovalRequest,
  ) => Promise<ToolApprovalDecision>;
}

export type AgentModelCall = (
  messages: readonly OpenAiCompatibleMessage[],
  tools: readonly OpenAiCompatibleTool[],
) => Promise<AsyncIterable<RuntimeEvent>>;

const DEFAULT_MAX_TOOL_ROUNDS = 8;
const DEFAULT_OVERALL_TIMEOUT_MS = 5 * 60 * 1000;

const toOpenAiTool = (manifest: ToolManifest): OpenAiCompatibleTool => ({
  type: 'function',
  function: {
    name: manifest.name,
    ...(manifest.description ? { description: manifest.description } : {}),
    parameters: manifest.parameters,
  },
});

export class MobileAgentLoop {
  constructor(private readonly gateway: ToolGatewayClient) {}

  async run(
    initialMessages: readonly OpenAiCompatibleMessage[],
    modelCall: AgentModelCall,
    options: MobileAgentLoopOptions = {},
  ): Promise<AsyncIterable<RuntimeEvent>> {
    const manifests = await this.gateway.listTools();
    const tools = manifests.map(toOpenAiTool);
    const maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    const maxToolResultBytes = options.maxToolResultBytes;
    const deadline = Date.now() + (options.overallTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS);
    const signal = options.signal;
    const gateway = this.gateway;
    const shouldPause = options.shouldPause ?? (() => false);

    return (async function* () {
      const messages = [...initialMessages];
      let rounds = 0;
      while (true) {
        if (shouldPause()) {
          yield { type: 'run-paused' as const, reason: 'app-suspended' as const };
          return;
        }
        if (signal?.aborted) {
          yield { type: 'run-paused' as const, reason: 'cancelled' as const };
          return;
        }
        if (Date.now() >= deadline) {
          yield { type: 'run-paused' as const, reason: 'timeout' as const };
          return;
        }

        let stream: AsyncIterable<RuntimeEvent>;
        try {
          stream = await modelCall(messages, tools);
        } catch (error) {
          if (shouldPause()) {
            yield { type: 'run-paused' as const, reason: 'app-suspended' as const };
            return;
          }
          throw error;
        }
        const pendingCalls: Array<{ callId: string; name: string; arguments: string }> = [];
        let assistantText = '';
        let finishReason: string | null = null;
        for await (const event of stream) {
          if (event.type === 'text-delta') assistantText += event.delta;
          if (event.type === 'tool-call') pendingCalls.push(event);
          if (event.type === 'finish') finishReason = event.reason;
          yield event;
        }

        if (pendingCalls.length === 0 || finishReason !== 'tool_calls') return;
        if (rounds >= maxToolRounds) {
          yield { type: 'error' as const, message: `Tool round limit reached (${maxToolRounds})` };
          return;
        }
        rounds += 1;
        messages.push({
          role: 'assistant',
          content: assistantText || null,
          tool_calls: pendingCalls.map((call) => ({
            id: call.callId,
            type: 'function' as const,
            function: { name: call.name, arguments: call.arguments },
          })),
        });

        for (const call of pendingCalls) {
          if (shouldPause()) {
            yield {
              type: 'run-paused' as const,
              reason: 'app-suspended' as const,
            };
            return;
          }
          if (signal?.aborted) {
            yield {
              type: 'run-paused' as const,
              reason: 'cancelled' as const,
            };
            return;
          }
          validateToolCall(manifests, call);
          yield {
            type: 'tool-running' as const,
            callId: call.callId,
            name: call.name,
          };

          let result;
          try {
            result = await gateway.callTool(call, { signal });
          } catch (error) {
            if (shouldPause()) {
              yield {
                type: 'run-paused' as const,
                reason: 'app-suspended' as const,
              };
              return;
            }
            if (signal?.aborted) {
              yield {
                type: 'run-paused' as const,
                reason: 'cancelled' as const,
              };
              return;
            }
            if (
              error instanceof ToolApprovalRequiredError &&
              options.requestApproval &&
              gateway.resolveApproval
            ) {
              const approval = error.approval;
              yield {
                type: 'approval-required' as const,
                invocationId: approval.invocationId,
                callId: approval.callId,
                name: approval.name,
                message: approval.message,
                ...(approval.scope ? { scope: approval.scope } : {}),
              };

              let decision: ToolApprovalDecision;
              let approvalTimeout: ReturnType<typeof setTimeout> | null = null;
              try {
                const remainingMs = deadline - Date.now();
                if (remainingMs <= 0) {
                  yield {
                    type: 'run-paused' as const,
                    reason: 'timeout' as const,
                  };
                  return;
                }
                const timeoutPromise = new Promise<ToolApprovalDecision>(
                  (_resolve, reject) => {
                    approvalTimeout = setTimeout(
                      () => reject(new Error('MOBILE_AGENT_APPROVAL_TIMEOUT')),
                      remainingMs,
                    );
                  },
                );
                decision = await Promise.race([
                  options.requestApproval(approval),
                  timeoutPromise,
                ]);
              } catch (approvalWaitError) {
                if (shouldPause()) {
                  yield {
                    type: 'run-paused' as const,
                    reason: 'app-suspended' as const,
                  };
                  return;
                }
                if (signal?.aborted) {
                  yield {
                    type: 'run-paused' as const,
                    reason: 'cancelled' as const,
                  };
                  return;
                }
                if (
                  approvalWaitError instanceof Error &&
                  approvalWaitError.message === 'MOBILE_AGENT_APPROVAL_TIMEOUT'
                ) {
                  yield {
                    type: 'run-paused' as const,
                    reason: 'timeout' as const,
                  };
                  return;
                }
                throw approvalWaitError;
              } finally {
                if (approvalTimeout) clearTimeout(approvalTimeout);
              }

              let resolution;
              const approvalController = new AbortController();
              let approvalResolveTimedOut = false;
              let approvalResolveTimeout: ReturnType<typeof setTimeout> | null =
                null;
              const abortApprovalFromRun = () => approvalController.abort();
              if (shouldPause()) {
                yield {
                  type: 'run-paused' as const,
                  reason: 'app-suspended' as const,
                };
                return;
              }
              if (signal?.aborted) {
                yield {
                  type: 'run-paused' as const,
                  reason: 'cancelled' as const,
                };
                return;
              }
              signal?.addEventListener('abort', abortApprovalFromRun, {
                once: true,
              });
              try {
                const remainingMs = deadline - Date.now();
                if (remainingMs <= 0) {
                  yield {
                    type: 'run-paused' as const,
                    reason: 'timeout' as const,
                  };
                  return;
                }
                approvalResolveTimeout = setTimeout(() => {
                  approvalResolveTimedOut = true;
                  approvalController.abort();
                }, remainingMs);

                resolution = await gateway.resolveApproval(
                  approval,
                  decision,
                  { signal: approvalController.signal },
                );
              } catch (approvalError) {
                if (
                  approvalError instanceof ToolGatewayError &&
                  approvalError.code === 'TOOL_APPROVAL_UNCERTAIN'
                ) {
                  throw approvalError;
                }
                if (shouldPause()) {
                  yield {
                    type: 'run-paused' as const,
                    reason: 'app-suspended' as const,
                  };
                  return;
                }
                if (signal?.aborted) {
                  yield {
                    type: 'run-paused' as const,
                    reason: 'cancelled' as const,
                  };
                  return;
                }
                if (
                  approvalResolveTimedOut ||
                  Date.now() >= deadline
                ) {
                  yield {
                    type: 'run-paused' as const,
                    reason: 'timeout' as const,
                  };
                  return;
                }
                throw approvalError;
              } finally {
                if (approvalResolveTimeout) {
                  clearTimeout(approvalResolveTimeout);
                }
                signal?.removeEventListener(
                  'abort',
                  abortApprovalFromRun,
                );
              }
              yield {
                type: 'approval-resolved' as const,
                invocationId: approval.invocationId,
                callId: approval.callId,
                name: approval.name,
                decision,
              };

              if (
                decision === 'rejected' ||
                resolution.status === 'rejected'
              ) {
                yield {
                  type: 'run-paused' as const,
                  reason: 'approval-rejected' as const,
                };
                return;
              }
              result = resolution.result;
            } else {
              throw error;
            }
          }
          const content = limitToolResult(
            result.content,
            maxToolResultBytes,
          );
          const truncated = content !== result.content;
          messages.push({ role: 'tool', content, tool_call_id: call.callId });
          yield {
            type: 'tool-result' as const,
            callId: call.callId,
            name: call.name,
            content,
            ...(truncated ? { truncated: true } : {}),
          };
        }
      }
    })();
  }
}
