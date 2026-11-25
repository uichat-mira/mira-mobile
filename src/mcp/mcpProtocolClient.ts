/**
 * Protocol-neutral Streamable HTTP MCP client.
 *
 * It speaks the standard JSON-RPC methods Mobile needs for trusted discovery
 * (`initialize`, paginated `tools/list`, optional `resources/list` /
 * `resources/read`, `tools/call`). Authentication, provider selection and
 * business authority stay outside: callers supply one already-authorized
 * endpoint + short-lived bearer and keep ownership of error mapping.
 */

/** Legacy stateless revision with explicit Who You compatibility evidence. */
export const MCP_PROTOCOL_VERSION = '2025-06-18';

/**
 * Protocol revisions this client can negotiate. The registry contract is
 * independent of MCP; callers filter catalog entries by this exact set instead
 * of guessing from a display name.
 */
export const MCP_SUPPORTED_PROTOCOL_VERSIONS: ReadonlySet<string> = new Set([
  '2026-07-28',
  '2025-11-25',
  '2025-06-18',
]);
const SUPPORTED_PROTOCOL_VERSIONS = MCP_SUPPORTED_PROTOCOL_VERSIONS;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_LIST_PAGES = 8;
const MAX_TOOLS = 512;
const MAX_RESOURCES = 256;
const MAX_TOOL_NAME_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 4_000;
const MAX_SCHEMA_BYTES = 64 * 1024;
const MAX_RESOURCE_URI_LENGTH = 2_048;
const MAX_RESOURCE_TEXT_BYTES = 256 * 1024;

export type McpErrorKind =
  | 'network'
  | 'unauthorized'
  | 'unavailable'
  | 'invalid_response'
  | 'rejected'
  | 'cancelled'
  | 'unsupported';

export class McpProtocolError extends Error {
  constructor(
    readonly kind: McpErrorKind,
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'McpProtocolError';
  }
}

export interface McpServerInfo {
  protocolVersion: string;
  serverName: string | null;
  serverVersion: string | null;
  tools: boolean;
  resources: boolean;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  /** The service's authoritative JSON Schema. Never reconstructed locally. */
  inputSchema: Record<string, unknown>;
}

export interface McpResourceDescriptor {
  uri: string;
  name?: string;
  mimeType?: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text: string;
}

export interface McpProtocolClientOptions {
  endpoint: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Test/recovery override; production keeps the documented default. */
  protocolVersion?: string;
}

interface JsonRpcRequest extends Record<string, unknown> {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

type SecureRequestInit = RequestInit & { redirect: 'error' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const safeCode = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[A-Za-z0-9._-]{1,80}$/u.test(value)
    ? value
    : undefined;

const cancelled = (): McpProtocolError =>
  new McpProtocolError('cancelled', 'MCP request was cancelled', 'MCP_REQUEST_CANCELLED');

const transportFailure = (status: number): McpProtocolError => {
  if (status === 401 || status === 403) {
    return new McpProtocolError(
      'unauthorized',
      'The MCP service rejected the current credential',
      'MCP_UNAUTHORIZED',
      status,
    );
  }
  if (status === 429 || status >= 500) {
    return new McpProtocolError(
      'unavailable',
      'The MCP service is temporarily unavailable',
      'MCP_UNAVAILABLE',
      status,
    );
  }
  return new McpProtocolError(
    'invalid_response',
    'The MCP service rejected the request',
    'MCP_HTTP_REJECTED',
    status,
  );
};

const withDeadline = async <T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  callerSignal?: AbortSignal,
): Promise<T> => {
  if (callerSignal?.aborted) throw cancelled();
  const controller = new AbortController();
  let abortFromCaller: (() => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    if (!callerSignal) return;
    abortFromCaller = () => {
      controller.abort();
      reject(cancelled());
    };
    callerSignal.addEventListener('abort', abortFromCaller, { once: true });
    if (callerSignal.aborted) abortFromCaller();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new McpProtocolError(
        'network',
        'The MCP request timed out',
        'MCP_REQUEST_TIMEOUT',
      ));
    }, timeoutMs);
  });

  const request = Promise.resolve()
    .then(() => {
      if (controller.signal.aborted) throw cancelled();
      return operation(controller.signal);
    })
    .catch((error: unknown) => {
      if (error instanceof McpProtocolError) throw error;
      throw new McpProtocolError(
        'network',
        'Unable to reach the MCP service',
        'MCP_UNREACHABLE',
      );
    });

  try {
    return await Promise.race([request, deadline, cancellation]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abortFromCaller) callerSignal?.removeEventListener('abort', abortFromCaller);
  }
};

/** A redirect target must never receive the service bearer. */
const assertResponseTarget = (
  response: Response,
  expectedUrl: string,
): void => {
  if (!response.url) return;
  try {
    const actual = new URL(response.url);
    const expected = new URL(expectedUrl);
    if (
      actual.origin !== expected.origin ||
      actual.pathname !== expected.pathname
    ) {
      throw new McpProtocolError(
        'invalid_response',
        'The MCP response came from a different endpoint',
        'MCP_RESPONSE_TARGET_CHANGED',
      );
    }
  } catch (error) {
    if (error instanceof McpProtocolError) throw error;
    throw new McpProtocolError(
      'invalid_response',
      'The MCP response target is invalid',
      'MCP_RESPONSE_TARGET_INVALID',
    );
  }
};

const jsonRpcResult = (value: unknown, expectedId: number): unknown => {
  if (!isRecord(value) || value.jsonrpc !== '2.0' || value.id !== expectedId) {
    throw new McpProtocolError(
      'invalid_response',
      'The MCP service returned an unmatched JSON-RPC response',
      'MCP_RESPONSE_INVALID',
    );
  }
  if (value.error !== undefined) {
    const code = isRecord(value.error) ? safeCode(value.error.code) : undefined;
    throw new McpProtocolError(
      'rejected',
      'The MCP service rejected the request',
      code ?? 'MCP_RPC_ERROR',
    );
  }
  if (!('result' in value)) {
    throw new McpProtocolError(
      'invalid_response',
      'The MCP service returned an incomplete response',
      'MCP_RESPONSE_INCOMPLETE',
    );
  }
  return value.result;
};

const parseSse = (text: string, expectedId: number): unknown => {
  for (const event of text.split(/\r?\n\r?\n/u)) {
    const data = event
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart())
      .join('\n');
    if (!data) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      continue;
    }
    if (isRecord(parsed) && parsed.id === expectedId) {
      return jsonRpcResult(parsed, expectedId);
    }
  }
  throw new McpProtocolError(
    'invalid_response',
    'The MCP service did not return a matching result',
    'MCP_RESULT_MISSING',
  );
};

const parseResponse = async (
  response: Response,
  expectedId: number,
): Promise<unknown> => {
  if (!response.ok) throw transportFailure(response.status);
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.toLowerCase().includes('text/event-stream')) {
    return parseSse(text, expectedId);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new McpProtocolError(
      'invalid_response',
      'The MCP response is not valid JSON',
      'MCP_RESPONSE_UNPARSEABLE',
    );
  }
  return jsonRpcResult(parsed, expectedId);
};

const parseTool = (value: unknown): McpToolDescriptor => {
  if (!isRecord(value) || !nonEmpty(value.name) ||
      value.name.length > MAX_TOOL_NAME_LENGTH ||
      !/^[A-Za-z0-9_.:-]+$/u.test(value.name) ||
      (value.description !== undefined && typeof value.description !== 'string') ||
      !isRecord(value.inputSchema)) {
    throw new McpProtocolError(
      'invalid_response',
      'The MCP service returned an invalid tool descriptor',
      'MCP_TOOL_INVALID',
    );
  }
  const schemaBytes = JSON.stringify(value.inputSchema).length;
  if (schemaBytes > MAX_SCHEMA_BYTES) {
    throw new McpProtocolError(
      'invalid_response',
      'The MCP tool schema exceeds the accepted size',
      'MCP_TOOL_SCHEMA_TOO_LARGE',
    );
  }
  return {
    name: value.name,
    ...(value.description !== undefined
      ? { description: value.description.slice(0, MAX_DESCRIPTION_LENGTH) }
      : {}),
    inputSchema: value.inputSchema,
  };
};

const parseResource = (value: unknown): McpResourceDescriptor => {
  if (!isRecord(value) || !nonEmpty(value.uri) ||
      value.uri.length > MAX_RESOURCE_URI_LENGTH ||
      (value.name !== undefined && typeof value.name !== 'string') ||
      (value.mimeType !== undefined && typeof value.mimeType !== 'string')) {
    throw new McpProtocolError(
      'invalid_response',
      'The MCP service returned an invalid resource descriptor',
      'MCP_RESOURCE_INVALID',
    );
  }
  return {
    uri: value.uri,
    ...(value.name !== undefined ? { name: value.name.slice(0, 160) } : {}),
    ...(value.mimeType !== undefined
      ? { mimeType: value.mimeType.slice(0, 160) }
      : {}),
  };
};

/**
 * One stateless MCP session over the caller's already-authorized endpoint.
 * The bearer is only ever placed in the Authorization header.
 */
export class McpProtocolClient {
  private readonly endpoint: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly timeoutMs: number;
  private readonly requestedVersion: string;
  private nextRequestId = 1;
  private negotiatedVersion: string | null = null;

  constructor(options: McpProtocolClientOptions) {
    this.endpoint = options.endpoint;
    this.token = options.token;
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.requestedVersion = options.protocolVersion ?? MCP_PROTOCOL_VERSION;
  }

  private async post(
    payload: Record<string, unknown>,
    expectedId: number | null,
    protocolHeader: string | undefined,
    callerSignal?: AbortSignal,
  ): Promise<unknown | null> {
    const fetchImpl = this.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new McpProtocolError(
        'network',
        'MCP networking is unavailable',
        'MCP_FETCH_UNAVAILABLE',
      );
    }
    return withDeadline(async (signal) => {
      let response: Response;
      try {
        const init: SecureRequestInit = {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${this.token}`,
            ...(protocolHeader ? { 'MCP-Protocol-Version': protocolHeader } : {}),
          },
          body: JSON.stringify(payload),
          redirect: 'error',
          signal,
        };
        response = await fetchImpl(this.endpoint, init);
        assertResponseTarget(response, this.endpoint);
      } catch (error) {
        if (error instanceof McpProtocolError) throw error;
        throw new McpProtocolError(
          'network',
          'Unable to reach the MCP service',
          'MCP_UNREACHABLE',
        );
      }
      if (expectedId === null) {
        if (!response.ok) throw transportFailure(response.status);
        return null;
      }
      return parseResponse(response, expectedId);
    }, this.timeoutMs, callerSignal);
  }

  private async request(
    method: string,
    params: Record<string, unknown> | undefined,
    callerSignal?: AbortSignal,
  ): Promise<unknown> {
    const id = this.nextRequestId++;
    const payload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params ? { params } : {}),
    };
    return this.post(
      payload,
      id,
      this.negotiatedVersion ?? undefined,
      callerSignal,
    );
  }

  private async notify(
    method: string,
    callerSignal?: AbortSignal,
  ): Promise<void> {
    await this.post(
      { jsonrpc: '2.0', method },
      null,
      this.negotiatedVersion ?? undefined,
      callerSignal,
    );
  }

  async initialize(callerSignal?: AbortSignal): Promise<McpServerInfo> {
    const id = this.nextRequestId++;
    const result = await this.post(
      {
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        params: {
          protocolVersion: this.requestedVersion,
          capabilities: { tools: {}, resources: {} },
          clientInfo: { name: 'mira-mobile', version: '1' },
        },
      },
      id,
      undefined,
      callerSignal,
    );
    if (!isRecord(result) || !nonEmpty(result.protocolVersion) ||
        !SUPPORTED_PROTOCOL_VERSIONS.has(result.protocolVersion)) {
      throw new McpProtocolError(
        'unsupported',
        'The MCP service did not negotiate a supported protocol version',
        'MCP_PROTOCOL_UNSUPPORTED',
      );
    }
    const serverInfo = isRecord(result.serverInfo) ? result.serverInfo : null;
    const capabilities = isRecord(result.capabilities) ? result.capabilities : null;
    this.negotiatedVersion = result.protocolVersion;
    await this.notify('notifications/initialized', callerSignal);
    return {
      protocolVersion: result.protocolVersion,
      serverName: serverInfo && nonEmpty(serverInfo.name)
        ? serverInfo.name.slice(0, 160)
        : null,
      serverVersion: serverInfo && nonEmpty(serverInfo.version)
        ? serverInfo.version.slice(0, 160)
        : null,
      tools: Boolean(capabilities && capabilities.tools !== undefined),
      resources: Boolean(capabilities && capabilities.resources !== undefined),
    };
  }

  async listTools(callerSignal?: AbortSignal): Promise<McpToolDescriptor[]> {
    const tools: McpToolDescriptor[] = [];
    const names = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const result = await this.request(
        'tools/list',
        cursor ? { cursor } : undefined,
        callerSignal,
      );
      if (!isRecord(result) || !Array.isArray(result.tools)) {
        throw new McpProtocolError(
          'invalid_response',
          'The MCP service returned an invalid tools list',
          'MCP_TOOLS_INVALID',
        );
      }
      for (const raw of result.tools) {
        const tool = parseTool(raw);
        if (names.has(tool.name)) {
          throw new McpProtocolError(
            'invalid_response',
            'The MCP service returned a duplicate tool name',
            'MCP_TOOL_DUPLICATE',
          );
        }
        names.add(tool.name);
        tools.push(tool);
        if (tools.length > MAX_TOOLS) {
          throw new McpProtocolError(
            'invalid_response',
            'The MCP tool list exceeds the accepted bound',
            'MCP_TOOLS_TOO_MANY',
          );
        }
      }
      const next = result.nextCursor;
      if (next === undefined || next === null) break;
      if (!nonEmpty(next) || next.length > 1_024 || next === cursor) {
        throw new McpProtocolError(
          'invalid_response',
          'The MCP service returned an invalid pagination cursor',
          'MCP_CURSOR_INVALID',
        );
      }
      cursor = next;
      if (page === MAX_LIST_PAGES - 1) {
        throw new McpProtocolError(
          'invalid_response',
          'The MCP tool list did not finish paginating',
          'MCP_TOOLS_PAGINATION_EXCEEDED',
        );
      }
    }
    return tools;
  }

  async listResources(
    callerSignal?: AbortSignal,
  ): Promise<McpResourceDescriptor[]> {
    const resources: McpResourceDescriptor[] = [];
    const uris = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const result = await this.request(
        'resources/list',
        cursor ? { cursor } : undefined,
        callerSignal,
      );
      if (!isRecord(result) || !Array.isArray(result.resources)) {
        throw new McpProtocolError(
          'invalid_response',
          'The MCP service returned an invalid resources list',
          'MCP_RESOURCES_INVALID',
        );
      }
      for (const raw of result.resources) {
        const resource = parseResource(raw);
        if (uris.has(resource.uri)) {
          throw new McpProtocolError(
            'invalid_response',
            'The MCP service returned a duplicate resource URI',
            'MCP_RESOURCE_DUPLICATE',
          );
        }
        uris.add(resource.uri);
        resources.push(resource);
        if (resources.length > MAX_RESOURCES) {
          throw new McpProtocolError(
            'invalid_response',
            'The MCP resource list exceeds the accepted bound',
            'MCP_RESOURCES_TOO_MANY',
          );
        }
      }
      const next = result.nextCursor;
      if (next === undefined || next === null) break;
      if (!nonEmpty(next) || next.length > 1_024 || next === cursor) {
        throw new McpProtocolError(
          'invalid_response',
          'The MCP service returned an invalid pagination cursor',
          'MCP_CURSOR_INVALID',
        );
      }
      cursor = next;
      if (page === MAX_LIST_PAGES - 1) {
        throw new McpProtocolError(
          'invalid_response',
          'The MCP resource list did not finish paginating',
          'MCP_RESOURCES_PAGINATION_EXCEEDED',
        );
      }
    }
    return resources;
  }

  async readResource(
    uri: string,
    callerSignal?: AbortSignal,
  ): Promise<McpResourceContent[]> {
    if (!nonEmpty(uri) || uri.length > MAX_RESOURCE_URI_LENGTH) {
      throw new McpProtocolError(
        'rejected',
        'MCP resource URI is invalid',
        'MCP_RESOURCE_URI_INVALID',
      );
    }
    const result = await this.request(
      'resources/read',
      { uri },
      callerSignal,
    );
    if (!isRecord(result) || !Array.isArray(result.contents) ||
        result.contents.length === 0 || result.contents.length > 32) {
      throw new McpProtocolError(
        'invalid_response',
        'The MCP service returned invalid resource contents',
        'MCP_RESOURCE_CONTENT_INVALID',
      );
    }
    return result.contents.map((value): McpResourceContent => {
      if (!isRecord(value) || !nonEmpty(value.uri) ||
          typeof value.text !== 'string' ||
          value.text.length > MAX_RESOURCE_TEXT_BYTES ||
          (value.mimeType !== undefined && typeof value.mimeType !== 'string')) {
        throw new McpProtocolError(
          'invalid_response',
          'The MCP service returned invalid resource contents',
          'MCP_RESOURCE_CONTENT_INVALID',
        );
      }
      return {
        uri: value.uri,
        ...(value.mimeType !== undefined
          ? { mimeType: value.mimeType.slice(0, 160) }
          : {}),
        text: value.text,
      };
    });
  }

  /** Raw JSON-RPC result. Callers own business validation of the tool payload. */
  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    callerSignal?: AbortSignal,
  ): Promise<unknown> {
    if (!nonEmpty(name) || name.length > MAX_TOOL_NAME_LENGTH) {
      throw new McpProtocolError(
        'rejected',
        'MCP tool name is invalid',
        'MCP_TOOL_NAME_INVALID',
      );
    }
    return this.request(
      'tools/call',
      { name, arguments: args },
      callerSignal,
    );
  }
}
