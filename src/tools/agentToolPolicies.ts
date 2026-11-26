import {
  DESKTOP_HOST_DISCOVERY_TOOL,
  TOOL_DISCLOSURE_TOOL,
  ToolGatewayError,
  type ToolDiscoveryHostCandidate,
  type ToolManifest,
} from './toolGatewayClient';

// Privileged tool names must not derive their privacy role from Host metadata.
export const requiredMailRole = (name: string): 'mail-search' | 'mail-body' | null =>
  name === 'whoyou_mail_search' ? 'mail-search'
    : name === 'whoyou_mail_message_get' ? 'mail-body' : null;

/**
 * Verifies that the existing mail disclosure contract still marks the two
 * privileged readers. This protects the privacy approval, not tool selection:
 * prior results never add, remove or disable an authorized tool.
 */
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

/**
 * Catalog-changing entries replace the run's tool set when they execute. Keep
 * them in their own provider batch so later calls are not validated against a
 * tool set that is about to change. This is a protocol timing constraint, not
 * an inference about user intent, tool results or the data source.
 */
export const validateToolBatch = (
  calls: readonly { name: string }[],
): void => {
  if (calls.length > 1 && calls.some((call) =>
    call.name === DESKTOP_HOST_DISCOVERY_TOOL || call.name === TOOL_DISCLOSURE_TOOL)) {
    throw new ToolGatewayError(
      'CLOUD_HOST_DISCOVERY_EXCLUSIVE',
      'Tool catalog discovery/disclosure cannot be batched with other tool operations',
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
