import {
  DESKTOP_HOST_DISCOVERY_TOOL,
  TOOL_DISCLOSURE_TOOL,
  ToolGatewayError,
  type ToolDiscoveryHostCandidate,
  type ToolManifest,
} from './toolGatewayClient';

export type MailStage = 'none' | 'search' | 'body';

// Privileged tool names must not derive their privacy role from Host metadata.
export const requiredMailRole = (name: string): 'mail-search' | 'mail-body' | null =>
  name === 'whoyou_mail_search' ? 'mail-search'
    : name === 'whoyou_mail_message_get' ? 'mail-body' : null;

export const validateMailManifests = (manifests: readonly ToolManifest[]): void => {
  if (manifests.some((manifest) => {
    const required = requiredMailRole(manifest.name);
    return required !== null && manifest.sensitiveResult !== required;
  })) {
    throw new ToolGatewayError(
      'MAIL_TOOL_POLICY_INVALID',
      '狐邮邮件工具的隐私规则缺失，已拒绝执行。',
    );
  }
};

export const allowedMailStageTools = (
  manifests: readonly ToolManifest[],
  stage: MailStage,
): readonly ToolManifest[] =>
  stage === 'none' ? manifests
    : stage === 'search' ? manifests.filter((item) =>
        item.sensitiveResult === 'mail-body' || item.name === TOOL_DISCLOSURE_TOOL)
      : [];

/**
 * Validate the whole tool batch before the first tool executes. Checking one
 * tool at a time would permit a mail search followed by an unsafe tool in the
 * same provider response, leaking untrusted mail into a side effect.
 */
export const validateToolBatch = (
  calls: readonly { name: string }[],
  manifests: readonly ToolManifest[],
  stage: MailStage,
): void => {
  const active = allowedMailStageTools(manifests, stage);
  if (stage === 'body' ||
    (stage !== 'none' && calls.some((call) => !active.some((m) => m.name === call.name)))) {
    throw new ToolGatewayError(
      'MAIL_TOOL_CHAIN_RESTRICTED',
      '邮件数据不能驱动其他工具操作。请另起一轮对话。',
    );
  }
  if (calls.length > 1 && calls.some((call) =>
    call.name === DESKTOP_HOST_DISCOVERY_TOOL || call.name === TOOL_DISCLOSURE_TOOL)) {
    throw new ToolGatewayError(
      'CLOUD_HOST_DISCOVERY_EXCLUSIVE',
      'Tool disclosure and Desktop discovery cannot be batched with other tool operations',
    );
  }
  if (calls.length > 1 && calls.some((call) => requiredMailRole(call.name) !== null)) {
    throw new ToolGatewayError(
      'MAIL_TOOL_CHAIN_RESTRICTED',
      '邮件工具必须单独调用，不能与其他工具组合执行。',
    );
  }
};

const compactLabel = (value: string, limit: number): string => {
  const compact = value.replace(/\s+/gu, ' ').trim();
  return compact.length > limit ? compact.slice(0, limit - 1) + '…' : compact;
};

/** Names and tool hints come solely from the authoritative Host directory. */
export const hostSelectionPrompt = (
  candidates: readonly ToolDiscoveryHostCandidate[],
): string => {
  const lines = [
    '检测到同一 Mira Cloud 账号下有多台可用的 Mira Desktop Host。请回复要使用哪一台：',
    '',
  ];
  candidates.forEach((candidate, index) => {
    const name = candidate.name
      ? compactLabel(candidate.name, 80)
      : '未命名 Desktop';
    const tools = candidate.toolNames
      .slice(0, 4)
      .map((tool) => compactLabel(tool, 48));
    const toolHint = tools.length > 0
      ? `可用工具：${tools.join('、')}${candidate.toolNames.length > tools.length ? ' 等' : ''}`
      : '暂未提供可调用工具';
    lines.push(
      `${index + 1}. ${name}（Host ID：${candidate.hostId.slice(0, 12)}；在线；${toolHint}）`,
    );
  });
  lines.push('', '请直接回复设备名称或 Host ID；确认后我会在下一轮使用该设备的工具。');
  return lines.join('\n');
};
