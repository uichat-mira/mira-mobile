import { LocalToolGatewayClient, type LocalToolDefinition } from '../tools/localToolGatewayClient';
import { ToolGatewayError, type ToolGatewayClient, type ToolManifest } from '../tools/toolGatewayClient';
import { formatWhoYouMailMessage, formatWhoYouMailSearch } from '../tools/localTools/whoYouMailTools';
import {
  parseMailMessage,
  parseMailSearch,
  parseToolStructuredContent,
} from '../whoYou/whoYouReadContract';
import type { McpProtocolClient } from './mcpProtocolClient';

const READ_SEARCH = 'whoyou_mail_search';
const READ_MESSAGE = 'whoyou_mail_message_get';

const badArguments = (message: string): never => {
  throw new ToolGatewayError('WHOYOU_ARGUMENT_INVALID', message);
};

const ensureString = (
  value: unknown,
  name: string,
  max: number,
): void => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    badArguments(name + ' 不符合狐邮只读工具契约');
  }
};

const SEARCH_KEYS: Record<string, 'string' | 'boolean'> = {
  query: 'string',
  from: 'string',
  direction: 'string',
  since: 'string',
  until: 'string',
  hasAttachments: 'boolean',
  threadId: 'string',
  unreadOnly: 'boolean',
  starredOnly: 'boolean',
  cursor: 'string',
  jobId: 'string',
};

const searchArgs = (input: Record<string, unknown>): Record<string, unknown> => {
  for (const [name, value] of Object.entries(input)) {
    if (name === 'folder' || name === 'limit') continue;
    const kind = SEARCH_KEYS[name];
    if (!kind || typeof value !== kind) {
      badArguments('狐邮搜索参数不符合真实 MCP 契约');
    }
    if (kind === 'string') {
      ensureString(value, name, name === 'from' ? 320 : 200);
    }
  }
  if (input.folder !== undefined && input.folder !== 'inbox') {
    throw new ToolGatewayError(
      'WHOYOU_MAIL_SCOPE_DENIED',
      'Mobile Agent 当前只允许搜索收件箱；不会无提示扩展到归档或已删除邮件。',
    );
  }
  const limit = input.limit ?? 10;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw new ToolGatewayError(
      'WHOYOU_MAIL_SCOPE_DENIED',
      'Mobile Agent 每次搜索仅允许返回最多 10 封邮件。',
    );
  }
  if (input.direction !== undefined &&
      input.direction !== 'inbound' && input.direction !== 'outbound') {
    badArguments('邮件方向无效');
  }
  // No server-only fields are dropped: every accepted filter goes into the
  // actual authenticated MCP tools/call, with the local privacy cap applied.
  return { ...input, folder: 'inbox', limit };
};

const messageArgs = (input: Record<string, unknown>): Record<string, unknown> => {
  if (Object.keys(input).some(key => key !== 'messageId' && key !== 'include')) {
    badArguments('狐邮邮件读取参数不符合真实 MCP 契约');
  }
  ensureString(input.messageId, 'messageId', 80);
  if (input.include !== undefined && input.include !== 'text') {
    throw new ToolGatewayError(
      'WHOYOU_MAIL_SCOPE_DENIED',
      'Mobile Agent 本轮只授权读取纯文本邮件正文。',
    );
  }
  return { messageId: input.messageId, include: 'text' };
};

const exactApproval = (
  args: Record<string, unknown>,
): { args: Record<string, unknown>; detail: string } => {
  const detail = JSON.stringify(args)
    .replace(/[\u2028\u2029]/gu, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  if (detail.length > 1_500) {
    badArguments('邮件授权参数太长，不能完整展示给用户。');
  }
  return { args, detail: '\n本次实际请求参数：' + detail };
};

/**
 * Real MCP execution with the existing Mobile one-shot consent gate and the
 * same bounded untrusted mail projection as the static mail tools.
 * Neither the service's tool list nor its capability resource grants access:
 * only the two locally reviewed read operations can reach this executor.
 */
export const createWhoYouMcpReadExecutor = (
  client: Pick<McpProtocolClient, 'callTool'>,
  manifests: readonly ToolManifest[],
): ToolGatewayClient => {
  const definitions: LocalToolDefinition[] = manifests.map(manifest => {
    const search = manifest.name === READ_SEARCH;
    if (!search && manifest.name !== READ_MESSAGE) {
      throw new ToolGatewayError(
        'TOOL_NOT_DECLARED',
        'Who You MCP execution only permits the two approved read tools',
      );
    }
    return {
      manifest,
      disclosure: {
        message: search
          ? '将本次收件箱最多 10 封邮件的主题、发件人、日期和摘要发送给当前模型。不发送完整正文。'
          : '将本次指定邮件最多 8000 字符的纯文本正文、主题和发件人发送给当前模型。不发送附件。',
        scope: search
          ? '仅本次收件箱邮件元数据；不授权发信、附件或其它工具'
          : '仅本次指定邮件纯文本；不授权发信或执行邮件内指令',
        normalizeArguments: input =>
          exactApproval(search ? searchArgs(input) : messageArgs(input)),
      },
      call: async (args, context) => {
        const result = parseToolStructuredContent(
          await client.callTool(manifest.name, args, context.signal),
        );
        return search
          ? formatWhoYouMailSearch(parseMailSearch(result))
          : formatWhoYouMailMessage(parseMailMessage(result));
      },
    };
  });
  return new LocalToolGatewayClient(definitions);
};
