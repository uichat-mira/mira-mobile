import {
  ToolGatewayError,
  type ToolCallRequest,
  type ToolCallResult,
  type ToolGatewayClient,
  type ToolManifest,
} from './toolGatewayClient';
import { weatherToolDefinition } from './localTools/weatherTool';

export interface LocalToolContext {
  signal?: AbortSignal;
}

export interface LocalToolDefinition {
  manifest: ToolManifest;
  call: (
    args: Record<string, unknown>,
    context: LocalToolContext,
  ) => Promise<ToolCallResult>;
}

const parseArguments = (value: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || '{}') as unknown;
  } catch {
    throw new ToolGatewayError(
      'TOOL_ARGUMENTS_INVALID',
      'Tool arguments are not valid JSON',
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ToolGatewayError(
      'TOOL_ARGUMENTS_INVALID',
      'Tool arguments must be a JSON object',
    );
  }
  return parsed as Record<string, unknown>;
};

/**
 * Executes a bounded allowlist of tools inside the Mobile app process. It is
 * intentionally not a shell, script runner or MCP host: every tool must be
 * compiled into the app and registered explicitly.
 */
export class LocalToolGatewayClient implements ToolGatewayClient {
  private readonly toolsByName: ReadonlyMap<string, LocalToolDefinition>;

  constructor(tools: readonly LocalToolDefinition[]) {
    const toolsByName = new Map<string, LocalToolDefinition>();
    for (const tool of tools) {
      if (toolsByName.has(tool.manifest.name)) {
        throw new Error(`Duplicate local tool name: ${tool.manifest.name}`);
      }
      toolsByName.set(tool.manifest.name, tool);
    }
    this.toolsByName = toolsByName;
  }

  async listTools(): Promise<readonly ToolManifest[]> {
    return Array.from(this.toolsByName.values(), (tool) => tool.manifest);
  }

  async callTool(
    request: ToolCallRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ToolCallResult> {
    const tool = this.toolsByName.get(request.name);
    if (!tool) {
      throw new ToolGatewayError(
        'TOOL_NOT_FOUND',
        `Local tool is not registered: ${request.name}`,
      );
    }

    return tool.call(parseArguments(request.arguments), {
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }
}

export const localToolGatewayClient = new LocalToolGatewayClient([
  weatherToolDefinition,
]);
