import { RemoteHostError } from '../api/remoteHttp';
import type { RemoteAgentRun, RemoteMessage } from '../protocol/remoteHostV1';
import {
  DurableHostAgentRuntimeAdapter,
  assertDurableHostRunBelongsToThread,
  durableHostAgentRuntime,
} from '../runtime/durableHostAgentRuntime';

export type AgentRunAction = 'approve' | 'reject' | 'cancel';

export type AgentRunMessage = Pick<RemoteMessage, 'role' | 'metadata'>;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function getStableAgentRunId(
  messages: readonly AgentRunMessage[],
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;

    const metadata = asRecord(message.metadata);
    const agent = asRecord(metadata?.agent);
    const runId = agent?.runId;
    if (typeof runId === 'string' && runId.trim().length > 0) {
      return runId.trim();
    }
    return null;
  }
  return null;
}

export const assertRunBelongsToThread = assertDurableHostRunBelongsToThread;

export function canApplyAgentRunAction(
  run: RemoteAgentRun,
  action: AgentRunAction,
): boolean {
  if (action === 'cancel') {
    return run.status === 'queued' || run.status === 'running';
  }
  return run.status === 'waiting_approval' && Boolean(run.pendingApproval);
}

export function shouldDisplayAgentRun(run: RemoteAgentRun | null): boolean {
  if (!run) return false;
  return (
    run.status === 'queued' ||
    run.status === 'running' ||
    run.status === 'waiting_approval' ||
    run.status === 'waiting_user'
  );
}

export function getAgentRunErrorMessage(error: unknown): string {
  if (error instanceof RemoteHostError) {
    if (error.code === 'AGENT_RUN_THREAD_MISMATCH') {
      return 'Agent 运行与当前会话不匹配，已拒绝显示和操作。';
    }
    if (error.status === 401) {
      return '连接凭据已失效，请重新连接 Mira Desktop。';
    }
    if (error.status === 403) {
      return '当前手机没有这个 Agent 操作所需的权限。';
    }
    if (error.status === 404) {
      return '这个 Agent 运行已不存在，请刷新会话状态。';
    }
    if (error.code === 'NETWORK_ERROR') {
      return '暂时无法连接 Mira Desktop，请检查网络后重试。';
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Agent 状态读取失败，请重试。';
}

export async function loadAgentRunForMessages(
  threadId: string,
  messages: readonly AgentRunMessage[],
  runtime: DurableHostAgentRuntimeAdapter = durableHostAgentRuntime,
): Promise<RemoteAgentRun | null> {
  const runId = getStableAgentRunId(messages);
  if (!runId) return null;
  return runtime.readRun(threadId, runId);
}

export async function applyAgentRunAction(
  threadId: string,
  runId: string,
  action: AgentRunAction,
  runtime: DurableHostAgentRuntimeAdapter = durableHostAgentRuntime,
): Promise<RemoteAgentRun> {
  const current = await runtime.readRun(threadId, runId);
  if (!canApplyAgentRunAction(current, action)) {
    throw new RemoteHostError(
      'AGENT_RUN_ACTION_UNAVAILABLE',
      `Agent Run cannot ${action} while status is ${current.status}`,
    );
  }

  return runtime.resolve(threadId, runId, action);
}
