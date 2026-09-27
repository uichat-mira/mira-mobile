import type { ToolCallRequest, ToolManifest } from './toolGatewayClient';

export const DEFAULT_MAX_TOOL_RESULT_BYTES = 32_000;

export class ToolPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolPolicyError';
  }
}

export const validateToolCall = (
  manifests: readonly ToolManifest[],
  request: ToolCallRequest,
): ToolManifest => {
  const name = request.name.trim();
  if (!name) throw new ToolPolicyError('Tool name is required');
  const manifest = manifests.find((item) => item.name === name);
  if (!manifest) throw new ToolPolicyError(`Tool is not allowed: ${name}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(request.arguments || '{}') as unknown;
  } catch {
    throw new ToolPolicyError(`Tool arguments are not valid JSON: ${name}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ToolPolicyError(`Tool arguments must be an object: ${name}`);
  }
  return manifest;
};

export const limitToolResult = (
  content: string,
  maxBytes = DEFAULT_MAX_TOOL_RESULT_BYTES,
): string => {
  if (maxBytes <= 0) return '';
  let bytes = 0;
  let result = '';
  for (const character of content) {
    const encodedLength = encodeURIComponent(character).replace(/%[0-9A-F]{2}/gu, 'x').length;
    if (bytes + encodedLength > maxBytes) break;
    bytes += encodedLength;
    result += character;
  }
  return result;
};
