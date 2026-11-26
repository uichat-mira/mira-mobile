import type { MiraHostApi } from '../api/miraHost';
import { RemoteHostError } from '../api/remoteHttp';
import { ToolGatewayError } from '../tools/toolGatewayClient';
import { ToolPolicyError } from '../tools/toolPolicy';
import type { RuntimeKind } from '../runtime/conversationRuntime';
import type { Session } from '../types';

type SessionReader = Pick<MiraHostApi, 'getSession'>;

type WebErrorCode =
  | 'WEB_ARGUMENTS_INVALID'
  | 'WEB_URL_FORBIDDEN'
  | 'WEB_TIMEOUT'
  | 'WEB_UPSTREAM_FAILED'
  | 'WEB_HTTP_ERROR'
  | 'WEB_RESPONSE_TOO_LARGE'
  | 'WEB_UNSUPPORTED_CONTENT_TYPE'
  | 'WEB_EXTRACT_FAILED'
  | 'WEB_TRANSPORT_UNAVAILABLE'
  | 'WEB_DNS_FAILED'
  | 'WEB_REDIRECT_LIMIT'
  | 'WEB_REDIRECT_FORBIDDEN'
  | 'WEB_BUSY';

const WEB_ERROR_MESSAGES: Record<WebErrorCode, string> = {
  WEB_ARGUMENTS_INVALID: '网页读取参数无效，请提供一个公开 URL',
  WEB_URL_FORBIDDEN: '只能读取公开互联网的 HTTP(S) 网页',
  WEB_TIMEOUT: '网页读取超时，请稍后重试或换一个页面',
  WEB_UPSTREAM_FAILED: '网页暂时无法读取，请稍后重试',
  WEB_HTTP_ERROR: '网页返回了错误状态，请稍后重试或换一个页面',
  WEB_RESPONSE_TOO_LARGE: '网页超过 1 MiB 下载上限，已停止读取',
  WEB_UNSUPPORTED_CONTENT_TYPE: '网页不是可提取的文本内容',
  WEB_EXTRACT_FAILED: '网页内容无法提取',
  WEB_TRANSPORT_UNAVAILABLE: '当前安装不支持本机网页读取',
  WEB_DNS_FAILED: '网页域名无法解析或不是公开地址',
  WEB_REDIRECT_LIMIT: '网页重定向次数过多，已停止读取',
  WEB_REDIRECT_FORBIDDEN: '网页重定向到了不允许的地址',
  WEB_BUSY: '已有网页正在读取，请等待上一次读取结束',
};

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
    if (
      error.code === 'CLOUD_TOOL_GRANT_REQUIRED' ||
      error.code === 'CLOUD_HOST_GRANT_REQUIRED' ||
      error.code === 'RELAY_CLOUD_GRANT_REQUIRED' ||
      error.code === 'CLOUD_TOOL_ROUTE_UNAVAILABLE'
    ) {
      return '所选 Desktop 未授予本机所需的工具权限，本轮已停止。请在桌面端检查 Cloud Host 授权。';
    }
    if (
      error.code === 'CLOUD_RELAY_HOST_OFFLINE' ||
      error.code === 'CLOUD_RELAY_HOST_NOT_FOUND'
    ) {
      return '所选 Mira Desktop 已离线或不再可用，本轮已停止。请确认设备在线后重试。';
    }
    if (error.code === 'CLOUD_TOOL_HOST_CHANGED') {
      return '所选 Desktop Host 在运行中发生变化，本轮已停止。请重新选择设备后再试。';
    }
    if (
      error.code === 'CLOUD_RELAY_SESSION_REJECTED' ||
      error.code === 'CLOUD_RELAY_SESSION_REQUIRED'
    ) {
      return 'Mira Cloud 登录已失效，本轮已停止。请重新登录后再试。';
    }
    if (
      error.code === 'CLOUD_RELAY_TICKET_DENIED' ||
      error.code === 'CLOUD_RELAY_TICKET_REJECTED'
    ) {
      return 'Mira Cloud 拒绝了所选 Desktop 的连接授权，本轮已停止。请检查 Cloud Host 授权。';
    }
    if (error.code === 'REMOTE_TOOL_ROUTE_UNAVAILABLE') {
      return '当前 Mira Host 还没有提供工具能力';
    }
    if (
      error.code === 'RELAY_NO_RESPONSE_STATUS' ||
      error.code === 'RELAY_PROTOCOL_ERROR' ||
      error.code === 'CLOUD_RELAY_INVALID_RESPONSE'
    ) {
      return 'Desktop 工具通道返回了异常协议响应。本机聊天不受影响，请检查 Desktop Relay 连接。';
    }
    if (error.code === 'REMOTE_ENDPOINT_UNAVAILABLE') {
      return '当前没有可用的远程工具通道，Agent 工具暂不可用';
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
    // Any remaining Host-side failure stays user-appropriate and code-free:
    // raw error codes belong in logging/telemetry, not in chat UI copy.
    return '本地对话暂时无法连接所需服务，请稍后重试';
  }

  if (error instanceof ToolGatewayError) {
    if (error.code === 'TOOL_CANCELLED') return '本次 Agent 运行已取消';
    if (error.code === 'TOOL_ARGUMENTS_INVALID') return '工具参数无效，本轮已停止';
    if (error.code === 'TOOL_CHANNEL_UNAVAILABLE') {
      return '工具通道当前不可用，本回合所需的工具未能执行，请稍后重试';
    }
    if (error.code === 'TOOL_NOT_AVAILABLE') return '这个工具当前不可用';
    if (error.code === 'TOOL_STREAM_INCOMPLETE') return '工具连接中断，可重新发送';
    if (error.code === 'TOOL_APPROVAL_UNCERTAIN') {
      return '工具审批结果暂时无法确认，请刷新状态后再决定是否重试';
    }
    if (
      error.code === 'WEB_ARGUMENTS_INVALID' ||
      error.code === 'WEB_URL_FORBIDDEN' ||
      error.code === 'WEB_TIMEOUT' ||
      error.code === 'WEB_UPSTREAM_FAILED' ||
      error.code === 'WEB_HTTP_ERROR' ||
      error.code === 'WEB_RESPONSE_TOO_LARGE' ||
      error.code === 'WEB_UNSUPPORTED_CONTENT_TYPE' ||
      error.code === 'WEB_EXTRACT_FAILED' ||
      error.code === 'WEB_TRANSPORT_UNAVAILABLE' ||
      error.code === 'WEB_DNS_FAILED' ||
      error.code === 'WEB_REDIRECT_LIMIT' ||
      error.code === 'WEB_REDIRECT_FORBIDDEN' ||
      error.code === 'WEB_BUSY'
    ) {
      return error.suggestedAction || WEB_ERROR_MESSAGES[error.code];
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

  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code ===
      'LOCAL_PROVIDER_CONFIG_REVIEW_REQUIRED'
  ) {
    return '这个 Provider 来自旧版非标准配置，请先到 Local Provider 设置修正 Base URL 和协议并保存';
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
