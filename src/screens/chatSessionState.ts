import type { MiraHostApi } from '../api/miraHost';
import { RemoteHostError } from '../api/remoteHttp';
import { ToolGatewayError } from '../tools/toolGatewayClient';
import { ToolPolicyError } from '../tools/toolPolicy';
import type { RuntimeKind } from '../runtime/conversationRuntime';
import type { Session } from '../types';

type SessionReader = Pick<MiraHostApi, 'getSession'>;

interface LocalSessionTitleReader {
  getSession?(sessionId: string): Promise<Pick<Session, 'title'>>;
}

export const readCanonicalSessionTitle = async (
  client: SessionReader,
  sessionId: string,
): Promise<string | null> => {
  try {
    return (await client.getSession(sessionId)).title;
  } catch {
    return null;
  }
};

export const readLocalSessionTitle = async (
  reader: LocalSessionTitleReader,
  sessionId: string,
): Promise<string | null> => {
  if (!reader.getSession) return null;
  try {
    return (await reader.getSession(sessionId)).title;
  } catch {
    return null;
  }
};

export const getChatHistoryErrorMessage = (error: unknown): string => {
  if (error instanceof RemoteHostError) {
    if (error.status === 401) {
      return '设备认证已失效，请重新连接 Mira Host';
    }
    if (error.status === 403) {
      return '当前设备没有读取聊天记录的权限';
    }
    if (error.status === 404) {
      return '这个会话已不存在或无法访问';
    }
    if (error.code === 'NETWORK_ERROR') {
      return '无法连接 Mira Host，请检查网络后重试';
    }
  }

  return '无法加载聊天记录，请稍后重试';
};

export const getChatSendErrorMessage = (
  error: unknown,
  runtimeKind: RuntimeKind,
): string => {
  if (runtimeKind !== 'local-provider') {
    return error instanceof Error && error.message
      ? error.message
      : '发送失败，请重试';
  }

  if (error instanceof RemoteHostError) {
    if (error.code === 'REMOTE_SCOPE_REQUIRED') {
      return '当前配对设备没有工具权限，请重新配对或升级权限';
    }
    if (error.code === 'REMOTE_TOOL_ROUTE_UNAVAILABLE') {
      return '当前 Mira Host 还没有提供工具能力';
    }
    if (error.code === 'REQUEST_ABORTED') return '本次发送已取消';
    if (error.code === 'PROVIDER_TIMEOUT') return 'Provider 响应超时，请重试';
    if (error.code === 'NETWORK_ERROR') {
      return '无法连接 Provider 或远程工具 Host，请检查网络';
    }
    if (error.code === 'INVALID_PROVIDER_URL') return 'Provider 地址无效，请检查配置';
    if (error.code === 'INSECURE_PROVIDER_URL') return '当前构建只允许 HTTPS Provider 地址';
    if (error.code === 'INVALID_PROVIDER_EVENT') return 'Provider 返回了不兼容的流式响应';
    if (error.status === 401 || error.status === 403) return 'Provider 拒绝了 API Key，请检查配置';
    if (error.status === 404) return 'Provider 地址或模型不可用，请检查配置';
    if (error.status === 429) return 'Provider 请求过于频繁，请稍后重试';
    if (error.status !== undefined && error.status >= 500) return 'Provider 服务暂时不可用，请稍后重试';
  }

  if (error instanceof ToolGatewayError) {
    if (error.code === 'TOOL_CANCELLED') return '本次 Agent 运行已取消';
    if (error.code === 'TOOL_ARGUMENTS_INVALID') return '工具参数无效，本轮已停止';
    if (error.code === 'TOOL_NOT_AVAILABLE') return '这个工具当前不可用';
    if (error.code === 'TOOL_STREAM_INCOMPLETE') return '工具连接中断，可重新发送';
    if (error.code === 'TOOL_APPROVAL_UNCERTAIN') {
      return '工具审批结果暂时无法确认，请刷新状态后再决定是否重试';
    }
    return error.message || '远程工具执行失败，请重试';
  }

  if (error instanceof ToolPolicyError) {
    if (error.message.includes('arguments')) {
      return '工具参数无效，本轮已停止';
    }
    if (error.message.includes('not allowed')) {
      return '模型请求了未授权工具，本轮已停止';
    }
    return '工具调用不符合当前安全策略，本轮已停止';
  }

  if (error instanceof Error) {
    if (error.message === 'Local Provider API key is not configured') {
      return '请先配置当前 Provider 的 API Key';
    }
    if (error.message === 'Local Provider configuration was not found') {
      return '该会话的 Provider 配置已不存在';
    }
  }

  return '本地对话发送失败，请重试';
};
