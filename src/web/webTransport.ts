import { NativeModules } from 'react-native';
import { checkPublicWebUrl } from './urlPolicy';

export interface WebFetchRequest {
  url: string;
  maxBytes: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface WebFetchResponse {
  status: number;
  finalUrl: string;
  contentType: string;
  body: string;
  truncated: boolean;
  redirectCount: number;
}

export interface WebTransport {
  fetch(request: WebFetchRequest): Promise<WebFetchResponse>;
}

export class WebTransportError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WebTransportError';
  }
}

interface NativeWebFetcher {
  fetch(options: {
    requestId: string;
    url: string;
    maxBytes: number;
    timeoutMs: number;
  }): Promise<unknown>;
  cancel(requestId: string): void;
}

const nativeModule = (): NativeWebFetcher | null => {
  const module = NativeModules.MiraWebFetcher as NativeWebFetcher | undefined;
  return module && typeof module.fetch === 'function' ? module : null;
};

export const isNativeWebTransportAvailable = (): boolean => nativeModule() !== null;

const asResponse = (value: unknown): WebFetchResponse => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WebTransportError('WEB_UPSTREAM_FAILED', 'The web transport returned an invalid response.');
  }
  const record = value as Record<string, unknown>;
  const status = record.status;
  const finalUrl = record.finalUrl;
  const contentType = record.contentType;
  const body = record.body;
  const truncated = record.truncated;
  const redirectCount = record.redirectCount;
  if (
    typeof status !== 'number' || !Number.isInteger(status) ||
    typeof finalUrl !== 'string' || !finalUrl ||
    typeof contentType !== 'string' ||
    typeof body !== 'string' ||
    typeof truncated !== 'boolean' ||
    typeof redirectCount !== 'number'
  ) {
    throw new WebTransportError('WEB_UPSTREAM_FAILED', 'The web transport returned an invalid response.');
  }
  const finalPolicy = checkPublicWebUrl(finalUrl);
  if (!finalPolicy.ok) {
    throw new WebTransportError(
      'WEB_REDIRECT_FORBIDDEN',
      'The final page address is not a public HTTP(S) URL.',
    );
  }
  return {
    status,
    finalUrl: finalPolicy.href,
    contentType,
    body,
    truncated,
    redirectCount,
  };
};

let nextRequestId = 0;

/**
 * Native transport boundary. The platform implementation performs DNS and
 * redirect checks, bounds decoded body bytes while reading and supports
 * cancellation; React Native `fetch` does not expose any of those guarantees.
 */
export const nativeWebTransport: WebTransport = {
  async fetch(request) {
    const module = nativeModule();
    if (!module) {
      throw new WebTransportError(
        'WEB_TRANSPORT_UNAVAILABLE',
        'The native web transport is not available in this build.',
      );
    }
    if (request.signal?.aborted) {
      throw new WebTransportError('WEB_CANCELLED', 'Web page read was cancelled.');
    }
    const initialPolicy = checkPublicWebUrl(request.url);
    if (!initialPolicy.ok) {
      throw new WebTransportError('WEB_URL_FORBIDDEN', 'The address is not a public HTTP(S) URL.');
    }

    const requestId = `web-${Date.now()}-${++nextRequestId}`;
    let settled = false;
    let cancelRequested = false;
    let rejectOnAbort: ((reason: unknown) => void) | null = null;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectOnAbort = reject;
    });
    const cancelFromCaller = () => {
      if (settled) return;
      cancelRequested = true;
      try {
        module.cancel(requestId);
      } catch {
        // The request may already have left the native task map.
      }
      rejectOnAbort?.(new WebTransportError('WEB_CANCELLED', 'Web page read was cancelled.'));
    };
    request.signal?.addEventListener('abort', cancelFromCaller, { once: true });

    try {
      const value = await Promise.race([
        module.fetch({
          requestId,
          url: initialPolicy.href,
          maxBytes: request.maxBytes,
          timeoutMs: request.timeoutMs,
        }),
        aborted,
      ]);
      if (cancelRequested || request.signal?.aborted) {
        throw new WebTransportError('WEB_CANCELLED', 'Web page read was cancelled.');
      }
      return asResponse(value);
    } catch (error) {
      if (cancelRequested || request.signal?.aborted) {
        throw new WebTransportError('WEB_CANCELLED', 'Web page read was cancelled.');
      }
      if (error instanceof WebTransportError) throw error;
      const record = error as { code?: unknown; message?: unknown } | null;
      const code = typeof record?.code === 'string' ? record.code : 'WEB_UPSTREAM_FAILED';
      const message = typeof record?.message === 'string' && record.message
        ? record.message
        : 'Unable to read the web page.';
      throw new WebTransportError(code, message);
    } finally {
      settled = true;
      request.signal?.removeEventListener('abort', cancelFromCaller);
    }
  },
};
