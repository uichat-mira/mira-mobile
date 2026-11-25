import { normalizeHostUrl } from '../protocol/remoteHostV1';
import { RemoteHostError } from './remoteHttp';

class AsyncPushQueue<T> implements AsyncIterableIterator<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private closed = false;
  private failure: unknown = null;

  push(value: T) {
    if (this.closed || this.failure) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value, done: false });
      return;
    }
    this.values.push(value);
  }

  close() {
    if (this.closed || this.failure) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.resolve({ value: undefined, done: true });
    }
  }

  fail(error: unknown) {
    if (this.closed || this.failure) return;
    this.failure = error;
    this.values.length = 0;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.reject(error);
    }
  }

  next(): Promise<IteratorResult<T>> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    const value = this.values.shift();
    if (value !== undefined) {
      return Promise.resolve({ value, done: false });
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true });
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }
}

const parseSseData = (frame: string): string | null => {
  const dataLines = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''));

  if (dataLines.length === 0) {
    return null;
  }
  return dataLines.join('\n');
};

export class SseFrameDecoder<T> {
  private buffer = '';
  private done = false;

  constructor(private readonly parse: (value: unknown) => T) {}

  feed(chunk: string): T[] {
    if (this.done || !chunk) return [];
    this.buffer += chunk;
    const events: T[] = [];

    while (true) {
      const separator = /\r?\n\r?\n/.exec(this.buffer);
      if (!separator || separator.index === undefined) break;

      const frame = this.buffer.slice(0, separator.index);
      this.buffer = this.buffer.slice(separator.index + separator[0].length);
      const parsed = this.parseFrame(frame);
      if (parsed !== null) events.push(parsed);
      if (this.done) {
        this.buffer = '';
        break;
      }
    }

    return events;
  }

  finish(): T[] {
    if (this.done || !this.buffer.trim()) {
      this.buffer = '';
      return [];
    }

    const frame = this.buffer;
    this.buffer = '';
    const parsed = this.parseFrame(frame);
    return parsed === null ? [] : [parsed];
  }

  private parseFrame(frame: string): T | null {
    const data = parseSseData(frame);
    if (data === null || data.length === 0) {
      return null;
    }
    if (data === '[DONE]') {
      this.done = true;
      return null;
    }

    let value: unknown;
    try {
      value = JSON.parse(data) as unknown;
    } catch {
      throw new RemoteHostError(
        'INVALID_SSE_EVENT',
        'Mira Host returned an invalid SSE event',
        undefined,
        data.slice(0, 512),
      );
    }
    return this.parse(value);
  }
}

export interface PostSseRequest<T> {
  hostUrl: string;
  path: string;
  credential: string;
  body: unknown;
  /** Contract-scoped transport headers; never business credentials. */
  headers?: Record<string, string>;
  parse: (value: unknown) => T;
  allowInsecureDevelopment?: boolean;
}

export interface PostSseSession<T> {
  events: AsyncIterable<T>;
  abort: () => void;
}

const extractHttpError = (xhr: XMLHttpRequest) => {
  const fallback = `Mira Host stream failed with HTTP ${xhr.status}`;
  try {
    const value = JSON.parse(xhr.responseText || '{}') as Record<string, unknown>;
    return {
      code:
        typeof value.code === 'string' || typeof value.code === 'number'
          ? String(value.code)
          : `HTTP_${xhr.status}`,
      message:
        typeof value.message === 'string' && value.message.trim()
          ? value.message
          : fallback,
      details: value.errors ?? value,
    };
  } catch {
    return {
      code: `HTTP_${xhr.status}`,
      message: fallback,
      details: xhr.responseText?.slice(0, 512),
    };
  }
};

export const openPostSse = <T>(request: PostSseRequest<T>): PostSseSession<T> => {
  const hostUrl = normalizeHostUrl(request.hostUrl, {
    allowInsecureDevelopment: request.allowInsecureDevelopment === true,
  });
  const path = request.path.startsWith('/') ? request.path : `/${request.path}`;
  const queue = new AsyncPushQueue<T>();
  const decoder = new SseFrameDecoder(request.parse);
  const xhr = new XMLHttpRequest();
  let processedLength = 0;
  let settled = false;

  const fail = (error: unknown) => {
    if (settled) return;
    settled = true;
    queue.fail(error);
  };

  const complete = () => {
    if (settled) return;
    settled = true;
    try {
      decoder.finish().forEach((event) => queue.push(event));
      queue.close();
    } catch (error) {
      fail(error);
    }
  };

  xhr.open('POST', `${hostUrl}${path}`, true);
  xhr.setRequestHeader('Accept', 'text/event-stream');
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', `Bearer ${request.credential}`);
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    xhr.setRequestHeader(key, value);
  }

  xhr.onprogress = () => {
    if (settled) return;
    if (xhr.status !== 0 && (xhr.status < 200 || xhr.status >= 300)) {
      return;
    }

    try {
      const responseText = xhr.responseText ?? '';
      const chunk = responseText.slice(processedLength);
      processedLength = responseText.length;
      const events = decoder.feed(chunk);
      events.forEach(event => queue.push(event));
    } catch (error) {
      xhr.abort();
      fail(error);
    }
  };

  xhr.onload = () => {
    if (settled) return;
    if (xhr.status < 200 || xhr.status >= 300) {
      const error = extractHttpError(xhr);
      fail(new RemoteHostError(error.code, error.message, xhr.status, error.details));
      return;
    }

    try {
      const responseText = xhr.responseText ?? '';
      const chunk = responseText.slice(processedLength);
      processedLength = responseText.length;
      const events = decoder.feed(chunk);
      events.forEach(event => queue.push(event));
      complete();
    } catch (error) {
      fail(error);
    }
  };

  xhr.onerror = () => {
    fail(new RemoteHostError('NETWORK_ERROR', 'Unable to reach Mira Host stream'));
  };

  xhr.ontimeout = () => {
    fail(new RemoteHostError('STREAM_TIMEOUT', 'Mira Host stream timed out'));
  };

  xhr.onabort = () => {
    fail(new RemoteHostError('REQUEST_ABORTED', 'Mira Host stream was cancelled'));
  };

  xhr.send(JSON.stringify(request.body));

  return {
    events: queue,
    abort: () => {
      if (!settled) xhr.abort();
    },
  };
};
