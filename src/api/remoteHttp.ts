import {
  normalizeHostUrl,
  unwrapApiEnvelope,
} from '../protocol/remoteHostV1';

export class RemoteHostError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'RemoteHostError';
  }
}

export interface RemoteJsonRequest<T> {
  hostUrl: string;
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  credential?: string;
  body?: unknown;
  signal?: AbortSignal;
  /**
   * Transport-level headers for a contract-scoped context (for example the
   * official Cloud MCP thread header). Authentication is still owned by
   * `credential`; callers must not use this to attach business credentials.
   */
  headers?: Record<string, string>;
  parse: (value: unknown) => T;
  allowInsecureDevelopment?: boolean;
  /**
   * raw 模式：跳过 `{success,data}` 信封校验，直接把响应体交给 parse。
   * 用于桌面端格式不完全可控的接口（如 /login），由调用方自行宽容解析。
   */
  raw?: boolean;
}

const readResponseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RemoteHostError(
      'INVALID_JSON',
      'Mira Host returned invalid JSON',
      response.status,
      text.slice(0, 512),
    );
  }
};

const extractEnvelopeError = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (record.success !== false) {
    return null;
  }

  return {
    code:
      typeof record.code === 'string' || typeof record.code === 'number'
        ? String(record.code)
        : 'HOST_REQUEST_FAILED',
    message:
      typeof record.message === 'string' && record.message.trim()
        ? record.message
        : 'Mira Host request failed',
    details: record.errors,
  };
};

export const requestRemoteJson = async <T>(
  request: RemoteJsonRequest<T>,
): Promise<T> => {
  const hostUrl = normalizeHostUrl(request.hostUrl, {
    allowInsecureDevelopment: request.allowInsecureDevelopment === true,
  });
  const path = request.path.startsWith('/') ? request.path : `/${request.path}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (request.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (request.credential) {
    headers.Authorization = `Bearer ${request.credential}`;
  }
  if (request.headers) {
    Object.assign(headers, request.headers);
  }

  let response: Response;
  try {
    response = await fetch(`${hostUrl}${path}`, {
      method: request.method ?? 'GET',
      headers,
      ...(request.body === undefined
        ? {}
        : { body: JSON.stringify(request.body) }),
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal?.aborted) {
      throw new RemoteHostError('REQUEST_ABORTED', 'Mira Host request was cancelled');
    }
    throw new RemoteHostError(
      'NETWORK_ERROR',
      error instanceof Error ? error.message : 'Unable to reach Mira Host',
      undefined,
      error,
    );
  }

  const payload = await readResponseBody(response);
  if (!response.ok) {
    const envelopeError = extractEnvelopeError(payload);
    throw new RemoteHostError(
      envelopeError?.code ?? `HTTP_${response.status}`,
      envelopeError?.message ?? `Mira Host request failed with HTTP ${response.status}`,
      response.status,
      envelopeError?.details ?? payload,
    );
  }

  try {
    if (request.raw === true) {
      return request.parse(payload);
    }
    return unwrapApiEnvelope(payload, request.parse);
  } catch (error) {
    const value = error as Error & { code?: string | number; details?: unknown };
    throw new RemoteHostError(
      value.code === undefined ? 'INVALID_RESPONSE' : String(value.code),
      value.message,
      response.status,
      value.details,
    );
  }
};
