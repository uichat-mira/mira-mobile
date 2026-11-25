/**
 * Protocol-neutral Streamable HTTP MCP client for the 2026-07-28 revision.
 *
 * The revision is stateless: every request carries its protocol version,
 * client identity and client capabilities in `_meta`, and the HTTP binding
 * mirrors the method/name into routing headers. There is no `initialize`
 * handshake, no session and no legacy version negotiation. Authentication,
 * provider selection and business authority stay outside: callers supply one
 * already-authorized endpoint + short-lived bearer and keep ownership of
 * error mapping.
 */

/** The only MCP revision this client speaks. */
export const MCP_PROTOCOL_VERSION = '2026-07-28';

const CLIENT_INFO = { name: 'mira-mobile', version: '1' };
const REQUEST_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const REQUEST_CLIENT_INFO_KEY = 'io.modelcontextprotocol/clientInfo';
const REQUEST_CLIENT_CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';
const RESPONSE_SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_LIST_PAGES = 8;
const MAX_TOOLS = 512;
const MAX_RESOURCES = 256;
const MAX_TOOL_NAME_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 4_000;
const MAX_SCHEMA_BYTES = 64 * 1024;
const MAX_RESOURCE_URI_LENGTH = 2_048;
const MAX_RESOURCE_TEXT_BYTES = 256 * 1024;

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const HEADER_UNSAFE = /[^\t\x20-\x7e]/u;
const BASE64_SENTINEL = /^=\?base64\?[\s\S]*\?=$/u;

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
}

interface JsonRpcRequest extends Record<string, unknown> {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: Record<string, unknown>;
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

/* eslint-disable no-bitwise -- UTF-8 and Base64 encoding require byte-level masks. */
/** UTF-8 bytes without relying on Buffer/TextEncoder in the RN runtime. */
const utf8Bytes = (value: string): number[] => {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
};

const base64 = (bytes: readonly number[]): string => {
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += BASE64_ALPHABET[first >> 2];
    encoded += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    encoded += second === undefined
      ? '='
      : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    encoded += third === undefined ? '=' : BASE64_ALPHABET[third & 0x3f];
  }
  return encoded;
};

/**
 * `Mcp-Name` must be a plain HTTP field value. Non-ASCII, control characters,
 * leading/trailing whitespace and the sentinel pattern itself use the
 * 2026-07-28 Base64 sentinel format.
 */
const mcpNameHeaderValue = (value: string): string => {
  const unsafe =
    value.length === 0 ||
    HEADER_UNSAFE.test(value) ||
    /^[ \t]|[ \t]$/u.test(value) ||
    BASE64_SENTINEL.test(value);
  return unsafe ? `=?base64?${base64(utf8Bytes(value))}?=` : value;
};
/* eslint-enable no-bitwise */

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

const protocolErrorCode = (code: number): string | undefined => {
  switch (code) {
    case -32020:
      return 'MCP_HEADER_MISMATCH';
    case -32021:
      return 'MCP_CLIENT_CAPABILITY_MISSING';
    case -32022:
      return 'MCP_PROTOCOL_UNSUPPORTED';
    case -32601:
      return 'MCP_METHOD_NOT_FOUND';
    case -32602:
      return 'MCP_PARAMS_INVALID';
    case -32603:
      return 'MCP_INTERNAL_ERROR';
    default:
      return undefined;
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
    const error = isRecord(value.error) ? value.error : null;
    // Remote Thread Workspace V1 carries its stable application code in
    // `error.data.code`; JSON-RPC's numeric `error.code` is not actionable.
    const dataCode = error && isRecord(error.data)
      ? safeCode(error.data.code)
      : undefined;
    const numericCode = error && typeof error.code === 'number'
      ? error.code
      : undefined;
    const code = dataCode ??
      (numericCode !== undefined ? protocolErrorCode(numericCode) : undefined) ??
      (error ? safeCode(error.code) : undefined) ??
      'MCP_RPC_ERROR';
    throw new McpProtocolError(
      numericCode === -32022 || numericCode === -32021 ? 'unsupported' : 'rejected',
      'The MCP service rejected the request',
      code,
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

/**
 * 2026-07-28 results are polymorphic. An absent `resultType` is treated as
 * `complete` per the revision's forward-compatibility rule, while unknown
 * types are invalid. This client does not implement MRTR, so
 * `input_required` is surfaced explicitly instead of being mistaken for data.
 */
const completeResult = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new McpProtocolError(
      'invalid_response',
      'The MCP service returned an invalid result',
      'MCP_RESULT_INVALID',
    );
  }
  if (value.resultType === undefined) return value;
  if (value.resultType === 'input_required') {
    throw new McpProtocolError(
      'unsupported',
      'The MCP service requires an unsupported multi-round-trip input exchange',
      'MCP_INPUT_REQUIRED_UNSUPPORTED',
    );
  }
  if (value.resultType !== 'complete') {
    throw new McpProtocolError(
      'invalid_response',
      'The MCP service did not return a complete result',
      'MCP_RESULT_TYPE_INVALID',
    );
  }
  return value;
};

const rpcErrorFromBody = (
  text: string,
  expectedId: number,
): McpProtocolError | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  if (
    !isRecord(parsed) ||
    parsed.jsonrpc !== '2.0' ||
    parsed.id !== expectedId ||
    parsed.error === undefined
  ) {
    return undefined;
  }
  try {
    jsonRpcResult(parsed, expectedId);
  } catch (error) {
    if (error instanceof McpProtocolError) return error;
  }
  return undefined;
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
  const text = await response.text();
  if (!response.ok) {
    // A 2026 server reports version/capability/header failures as a JSON-RPC
    // error body on 400. Preserve that observable code instead of flattening
    // every rejection into the transport status.
    const protocolError = rpcErrorFromBody(text, expectedId);
    if (protocolError) throw protocolError;
    throw transportFailure(response.status);
  }
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

type HeaderBinding = {
  name: string;
  path: string[];
  type: 'string' | 'boolean' | 'integer';
};

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

/** Only annotations on a static properties path are legal. Inspect schema
 * positions, not arbitrary data (examples, defaults or enum values). */
const collectHeaderBindings = (schema: Record<string, unknown>): HeaderBinding[] => {
  const bindings: HeaderBinding[] = [];
  const names = new Set<string>();
  const invalid = () => new McpProtocolError(
    'invalid_response', 'Invalid x-mcp-header annotation', 'MCP_TOOL_HEADER_INVALID',
  );
  const walk = (node: unknown, path: string[] | null, depth: number) => {
    if (!isRecord(node)) return;
    if (depth > 128) throw invalid();
    if (Object.hasOwn(node, 'x-mcp-header')) {
      const name = node['x-mcp-header'];
      const type = node.type;
      if (!path?.length || typeof name !== 'string' || !HEADER_NAME.test(name) ||
          names.has(name.toLowerCase()) ||
          (type !== 'string' && type !== 'boolean' && type !== 'integer')) throw invalid();
      names.add(name.toLowerCase());
      bindings.push({ name, path, type });
    }
    if (isRecord(node.properties)) {
      for (const [key, child] of Object.entries(node.properties)) {
        walk(child, path === null ? null : [...path, key], depth + 1);
      }
    }
    for (const key of ['$defs', 'definitions', 'patternProperties', 'dependentSchemas', 'dependencies']) {
      const value = node[key];
      if (isRecord(value)) {
        for (const child of Object.values(value)) walk(child, null, depth + 1);
      }
    }
    for (const key of ['items', 'prefixItems', 'contains', 'additionalItems', 'additionalProperties',
      'unevaluatedProperties', 'unevaluatedItems', 'propertyNames', 'not', 'if', 'then', 'else',
      'allOf', 'anyOf', 'oneOf', 'contentSchema']) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) walk(child, null, depth + 1);
      } else walk(value, null, depth + 1);
    }
  };
  walk(schema, [], 0);
  return bindings;
};

const mirrorArguments = (bindings: readonly HeaderBinding[], args: Record<string, unknown>) => {
  const headers: Record<string, string> = {};
  for (const binding of bindings) {
    let value: unknown = args;
    for (const key of binding.path) {
      value = isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
    }
    if (value === undefined || value === null) continue;
    if (binding.type === 'integer'
      ? typeof value !== 'number' || !Number.isSafeInteger(value)
      : typeof value !== binding.type) {
      throw new McpProtocolError('rejected', 'Invalid mirrored tool parameter', 'MCP_TOOL_HEADER_VALUE_INVALID');
    }
    headers['Mcp-Param-' + binding.name] = mcpNameHeaderValue(String(value));
  }
  return headers;
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
 * One stateless MCP request target over the caller's already-authorized
 * endpoint. No connection, session or negotiated version is retained.
 */
export class McpProtocolClient {
  private readonly endpoint: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly timeoutMs: number;
  private nextRequestId = 1;
  private headerBindings = new Map<string, HeaderBinding[]>();
  private rejectedTools = new Set<string>();

  constructor(options: McpProtocolClientOptions) {
    this.endpoint = options.endpoint;
    this.token = options.token;
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async post(
    payload: Record<string, unknown>,
    extraHeaders: Record<string, string>,
    expectedId: number,
    callerSignal?: AbortSignal,
  ): Promise<unknown> {
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
            'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
            ...extraHeaders,
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
      return parseResponse(response, expectedId);
    }, this.timeoutMs, callerSignal);
  }

  private async request(
    method: string,
    params: Record<string, unknown> | undefined,
    mcpName?: string,
    callerSignal?: AbortSignal,
    parameterHeaders: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    const id = this.nextRequestId++;
    const payload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params: {
        ...(params ?? {}),
        _meta: {
          [REQUEST_VERSION_KEY]: MCP_PROTOCOL_VERSION,
          [REQUEST_CLIENT_INFO_KEY]: CLIENT_INFO,
          [REQUEST_CLIENT_CAPABILITIES_KEY]: {},
        },
      },
    };
    const result = await this.post(
      payload,
      {
        ...parameterHeaders,
        'Mcp-Method': method,
        ...(mcpName !== undefined
          ? { 'Mcp-Name': mcpNameHeaderValue(mcpName) }
          : {}),
      },
      id,
      callerSignal,
    );
    return completeResult(result);
  }

  /**
   * Optional discovery call. It is the only way to learn the server's
   * capabilities before a feature request; it does not establish a session.
   */
  async discover(callerSignal?: AbortSignal): Promise<McpServerInfo> {
    const result = await this.request('server/discover', undefined, undefined, callerSignal);
    const supported = result.supportedVersions;
    if (
      !Array.isArray(supported) ||
      supported.length === 0 ||
      supported.length > 32 ||
      !supported.every((version) => typeof version === 'string')
    ) {
      throw new McpProtocolError(
        'invalid_response',
        'The MCP service returned an invalid protocol version list',
        'MCP_PROTOCOL_VERSIONS_INVALID',
      );
    }
    if (!supported.includes(MCP_PROTOCOL_VERSION)) {
      throw new McpProtocolError(
        'unsupported',
        `The MCP service does not support protocol ${MCP_PROTOCOL_VERSION}`,
        'MCP_PROTOCOL_UNSUPPORTED',
      );
    }
    if (!isRecord(result.capabilities)) {
      throw new McpProtocolError(
        'invalid_response',
        'The MCP service returned invalid capabilities',
        'MCP_CAPABILITIES_INVALID',
      );
    }
    const meta = isRecord(result._meta) ? result._meta : null;
    const serverInfo = meta && isRecord(meta[RESPONSE_SERVER_INFO_KEY])
      ? meta[RESPONSE_SERVER_INFO_KEY]
      : null;
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverName: serverInfo && nonEmpty(serverInfo.name)
        ? serverInfo.name.slice(0, 160)
        : null,
      serverVersion: serverInfo && nonEmpty(serverInfo.version)
        ? serverInfo.version.slice(0, 160)
        : null,
      tools: result.capabilities.tools !== undefined,
      resources: result.capabilities.resources !== undefined,
    };
  }

  async listTools(callerSignal?: AbortSignal): Promise<McpToolDescriptor[]> {
    const tools: McpToolDescriptor[] = [];
    const names = new Set<string>();
    const bindings = new Map<string, HeaderBinding[]>();
    const rejected = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const result = await this.request(
        'tools/list',
        cursor ? { cursor } : undefined,
        undefined,
        callerSignal,
      );
      if (!Array.isArray(result.tools)) {
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
        if (names.size > MAX_TOOLS) {
          throw new McpProtocolError('invalid_response', 'The MCP tool list exceeds the accepted bound', 'MCP_TOOLS_TOO_MANY');
        }
        try {
          bindings.set(tool.name, collectHeaderBindings(tool.inputSchema));
        } catch (error) {
          if (!(error instanceof McpProtocolError)) throw error;
          rejected.add(tool.name);
          // Keep unrelated tools usable; do not log the annotation or argument values.
          continue;
        }
        tools.push(tool);
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
    this.headerBindings = bindings;
    this.rejectedTools = rejected;
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
        undefined,
        callerSignal,
      );
      if (!Array.isArray(result.resources)) {
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
      uri,
      callerSignal,
    );
    if (!Array.isArray(result.contents) ||
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
    if (this.rejectedTools.has(name)) {
      throw new McpProtocolError('rejected', 'Tool definition was rejected', 'MCP_TOOL_HEADER_INVALID');
    }
    return this.request(
      'tools/call',
      { name, arguments: args },
      name,
      callerSignal,
      mirrorArguments(this.headerBindings.get(name) ?? [], args),
    );
  }
}
