import { SseFrameDecoder, type PostSseRequest, type PostSseSession } from './postSse';
import {
  RemoteHostError,
  type RemoteJsonRequest,
} from './remoteHttp';
import { unwrapApiEnvelope } from '../protocol/remoteHostV1';
import {
  normalizeRelayEndpoint,
  type RemoteRelayEndpoint,
} from '../protocol/remotePairingV1';

const RELAY_PROTOCOL_VERSION = 1;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

interface RelayResponseFrame {
  version: 1;
  type: 'response';
  requestId: string;
  status: number;
  headers: Record<string, string>;
}

interface RelayChunkFrame {
  version: 1;
  type: 'chunk';
  requestId: string;
  encoding: 'base64';
  data: string;
}

interface RelayCompleteFrame {
  version: 1;
  type: 'complete';
  requestId: string;
}

interface RelayErrorFrame {
  version: 1;
  type: 'error';
  requestId?: string;
  code: string;
  message: string;
  retryable: boolean;
}

type RelayInboundFrame =
  | RelayResponseFrame
  | RelayChunkFrame
  | RelayCompleteFrame
  | RelayErrorFrame;

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
    if (this.failure) return Promise.reject(this.failure);
    const value = this.values.shift();
    if (value !== undefined) return Promise.resolve({ value, done: false });
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }
}

const utf8Encode = (value: string): Uint8Array => {
  const bytes: number[] = [];
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0xfffd;
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
  return Uint8Array.from(bytes);
};

class Utf8StreamDecoder {
  private pending: number[] = [];

  feed(chunk: Uint8Array): string {
    const bytes = [...this.pending, ...chunk];
    this.pending = [];
    let output = '';
    let index = 0;

    while (index < bytes.length) {
      const first = bytes[index];
      let length = 1;
      let codePoint = first;
      let minimum = 0;

      if (first <= 0x7f) {
        length = 1;
      } else if ((first & 0xe0) === 0xc0) {
        length = 2;
        codePoint = first & 0x1f;
        minimum = 0x80;
      } else if ((first & 0xf0) === 0xe0) {
        length = 3;
        codePoint = first & 0x0f;
        minimum = 0x800;
      } else if ((first & 0xf8) === 0xf0) {
        length = 4;
        codePoint = first & 0x07;
        minimum = 0x10000;
      } else {
        output += '\ufffd';
        index += 1;
        continue;
      }

      if (index + length > bytes.length) {
        this.pending = bytes.slice(index);
        break;
      }

      let valid = true;
      for (let offset = 1; offset < length; offset += 1) {
        const next = bytes[index + offset];
        if ((next & 0xc0) !== 0x80) {
          valid = false;
          break;
        }
        codePoint = (codePoint << 6) | (next & 0x3f);
      }

      if (
        !valid ||
        (length > 1 && codePoint < minimum) ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        output += '\ufffd';
        index += 1;
        continue;
      }

      output += String.fromCodePoint(codePoint);
      index += length;
    }

    return output;
  }

  finish() {
    const suffix = this.pending.length ? '\ufffd' : '';
    this.pending = [];
    return suffix;
  }
}

const base64Encode = (bytes: Uint8Array) => {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const value = (a << 16) | (b << 8) | c;
    output += BASE64_ALPHABET[(value >> 18) & 63];
    output += BASE64_ALPHABET[(value >> 12) & 63];
    output += index + 1 < bytes.length ? BASE64_ALPHABET[(value >> 6) & 63] : '=';
    output += index + 2 < bytes.length ? BASE64_ALPHABET[value & 63] : '=';
  }
  return output;
};

const base64Decode = (value: string): Uint8Array => {
  const normalized = value.replace(/\s+/g, '');
  if (!normalized || normalized.length % 4 !== 0) {
    throw new RemoteHostError(
      'INVALID_RELAY_CHUNK',
      'Mira Relay returned invalid base64 data',
    );
  }

  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 4) {
    const chars = normalized.slice(index, index + 4);
    const values = [...chars].map(char =>
      char === '=' ? 0 : BASE64_ALPHABET.indexOf(char),
    );
    if (values.some(item => item < 0)) {
      throw new RemoteHostError(
        'INVALID_RELAY_CHUNK',
        'Mira Relay returned invalid base64 data',
      );
    }
    const packed =
      (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3];
    bytes.push((packed >> 16) & 0xff);
    if (chars[2] !== '=') bytes.push((packed >> 8) & 0xff);
    if (chars[3] !== '=') bytes.push(packed & 0xff);
  }
  return Uint8Array.from(bytes);
};

const concatBytes = (chunks: Uint8Array[]) => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
};

const decodeUtf8 = (bytes: Uint8Array) => {
  const decoder = new Utf8StreamDecoder();
  return decoder.feed(bytes) + decoder.finish();
};

const parseJsonText = (text: string, status?: number): unknown => {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RemoteHostError(
      'INVALID_JSON',
      'Mira Host returned invalid JSON through Relay',
      status,
      text.slice(0, 512),
    );
  }
};

const extractEnvelopeError = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.success !== false) return null;
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

const normalizePath = (value: string) =>
  value.startsWith('/') ? value : `/${value}`;

const createHeaders = (input: {
  credential?: string;
  body?: unknown;
  sse?: boolean;
}) => {
  const headers: Record<string, string> = {
    Accept: input.sse ? 'text/event-stream' : 'application/json',
  };
  if (input.body !== undefined) headers['Content-Type'] = 'application/json';
  if (input.credential) headers.Authorization = `Bearer ${input.credential}`;
  return headers;
};

export interface RelayTransportTarget {
  endpoint: string;
  relayId: string;
}

/**
 * Admission is the only part of the Relay transport that differs between the
 * Legacy pairing token and the Cloud transport ticket. The frame engine below
 * must never see a business credential.
 */
export interface RelayAdmission {
  createHello(
    target: RelayTransportTarget,
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
  mapAdmissionErrorCode(code: string): string;
}

export const legacyRelayAdmission = (token: string): RelayAdmission => ({
  createHello: target => ({
    role: 'client',
    relayId: target.relayId,
    token,
  }),
  mapAdmissionErrorCode: code => `RELAY_${code}`,
});

const isPromiseLike = <T>(value: T | Promise<T>): value is Promise<T> =>
  typeof (value as Promise<T> | null)?.then === 'function';

const buildSocketUrl = (relay: RelayTransportTarget) => {
  const baseUrl = normalizeRelayEndpoint(relay.endpoint).replace(
    /^https:/u,
    'wss:',
  );
  return `${baseUrl}/v1/relay/${encodeURIComponent(relay.relayId)}/socket`;
};

const parseInboundFrame = (value: unknown): RelayInboundFrame | null => {
  if (typeof value !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const frame = parsed as Record<string, unknown>;
  if (frame.version !== RELAY_PROTOCOL_VERSION || typeof frame.type !== 'string') {
    return null;
  }

  if (frame.type === 'response') {
    if (
      typeof frame.requestId !== 'string' ||
      typeof frame.status !== 'number' ||
      !frame.headers ||
      typeof frame.headers !== 'object' ||
      Array.isArray(frame.headers)
    ) {
      return null;
    }
    return frame as unknown as RelayResponseFrame;
  }
  if (frame.type === 'chunk') {
    if (
      typeof frame.requestId !== 'string' ||
      frame.encoding !== 'base64' ||
      typeof frame.data !== 'string'
    ) {
      return null;
    }
    return frame as unknown as RelayChunkFrame;
  }
  if (frame.type === 'complete') {
    return typeof frame.requestId === 'string'
      ? (frame as unknown as RelayCompleteFrame)
      : null;
  }
  if (frame.type === 'error') {
    if (
      (frame.requestId !== undefined && typeof frame.requestId !== 'string') ||
      typeof frame.code !== 'string' ||
      typeof frame.message !== 'string' ||
      typeof frame.retryable !== 'boolean'
    ) {
      return null;
    }
    return frame as unknown as RelayErrorFrame;
  }
  return null;
};

type JsonPending<T> = {
  kind: 'json';
  parse: (value: unknown) => T;
  raw: boolean;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  chunks: Uint8Array[];
  status: number | null;
};

type SsePending<T> = {
  kind: 'sse';
  queue: AsyncPushQueue<T>;
  decoder: SseFrameDecoder<T>;
  textDecoder: Utf8StreamDecoder;
  errorChunks: Uint8Array[];
  status: number | null;
  pendingChunks: Uint8Array[];
};

type PendingRequest = JsonPending<unknown> | SsePending<unknown>;

export class RelayConnection {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private resolveConnect: (() => void) | null = null;
  private rejectConnect: ((error: unknown) => void) | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private socketOpenTimer: ReturnType<typeof setTimeout> | null = null;
  private authenticated = false;
  private helloSent = false;
  private readonly pending = new Map<string, PendingRequest>();
  private sequence = 0;

  constructor(
    private readonly relay: RelayTransportTarget,
    private readonly admission: RelayAdmission,
    private readonly onClose?: () => void,
  ) {}

  async requestJson<T>(request: RemoteJsonRequest<T>): Promise<T> {
    await this.ensureConnected();
    if (request.signal?.aborted) {
      throw new RemoteHostError(
        'REQUEST_ABORTED',
        'Mira Host request was cancelled',
      );
    }

    const requestId = this.nextRequestId();
    const signal = request.signal;
    let abortListener: (() => void) | null = null;

    const promise = new Promise<T>((resolve, reject) => {
      const pending: JsonPending<T> = {
        kind: 'json',
        parse: request.parse,
        raw: request.raw === true,
        resolve,
        reject,
        chunks: [],
        status: null,
      };
      this.pending.set(requestId, pending as JsonPending<unknown>);

      abortListener = () => {
        if (!this.pending.has(requestId)) return;
        this.pending.delete(requestId);
        this.send({ version: 1, type: 'cancel', requestId });
        reject(
          new RemoteHostError(
            'REQUEST_ABORTED',
            'Mira Host request was cancelled',
          ),
        );
      };
      signal?.addEventListener('abort', abortListener, { once: true });

      const sent = this.send({
        version: 1,
        type: 'request',
        requestId,
        method: request.method ?? 'GET',
        path: normalizePath(request.path),
        headers: createHeaders({
          credential: request.credential,
          body: request.body,
        }),
        ...(request.body === undefined
          ? {}
          : {
              bodyBase64: base64Encode(
                utf8Encode(JSON.stringify(request.body)),
              ),
            }),
      });
      if (!sent) {
        signal?.removeEventListener('abort', abortListener);
        this.pending.delete(requestId);
        reject(
          new RemoteHostError(
            'RELAY_DISCONNECTED',
            'Mira Relay is not connected',
          ),
        );
      }
    });

    return promise.finally(() => {
      if (abortListener) {
        signal?.removeEventListener('abort', abortListener);
      }
    });
  }

  openSse<T>(request: PostSseRequest<T>): PostSseSession<T> {
    const requestId = this.nextRequestId();
    const queue = new AsyncPushQueue<T>();
    const pending: SsePending<T> = {
      kind: 'sse',
      queue,
      decoder: new SseFrameDecoder(request.parse),
      textDecoder: new Utf8StreamDecoder(),
      errorChunks: [],
      status: null,
      pendingChunks: [],
    };
    let aborted = false;

    void this.ensureConnected()
      .then(() => {
        if (aborted) return;
        this.pending.set(requestId, pending as SsePending<unknown>);
        if (
          !this.send({
            version: 1,
            type: 'request',
            requestId,
            method: 'POST',
            path: normalizePath(request.path),
            headers: createHeaders({
              credential: request.credential,
              body: request.body,
              sse: true,
            }),
            bodyBase64: base64Encode(
              utf8Encode(JSON.stringify(request.body)),
            ),
          })
        ) {
          this.pending.delete(requestId);
          queue.fail(
            new RemoteHostError(
              'RELAY_DISCONNECTED',
              'Mira Relay is not connected',
            ),
          );
        }
      })
      .catch(error => queue.fail(error));

    return {
      events: queue,
      abort: () => {
        if (aborted) return;
        aborted = true;
        if (this.pending.delete(requestId)) {
          this.send({ version: 1, type: 'cancel', requestId });
        }
        queue.fail(
          new RemoteHostError(
            'REQUEST_ABORTED',
            'Mira Host stream was cancelled',
          ),
        );
      },
    };
  }

  close() {
    const closed = new RemoteHostError(
      'RELAY_DISCONNECTED', 'Mira Relay connection closed',
    );
    // Closing an unauthenticated socket must also reject callers awaiting the
    // async Client ticket/hello (the pending request map is not populated yet).
    if (this.connectPromise) this.finishConnectFailure(closed);
    this.failAll(closed);
    const socket = this.socket;
    this.socket = null;
    this.authenticated = false;
    this.helloSent = false;
    this.connectPromise = null;
    this.stopHandshakeTimer();
    try {
      socket?.close(1000, 'Mira Mobile Relay closed');
    } catch {
      // Socket may already be closed.
    }
    this.onClose?.();
  }

  private ensureConnected(): Promise<void> {
    // A WebSocket can be OPEN while a fresh Cloud ticket is still pending or
    // while Relay hello_ack has not arrived. Never send business frames then.
    if (this.connectPromise) return this.connectPromise;
    if (this.socket?.readyState === 1 && this.authenticated) return Promise.resolve();
    if (this.socket) {
      const stale = this.socket;
      this.socket = null;
      this.authenticated = false;
      this.helloSent = false;
      try { stale.close(1008, 'Relay not authenticated'); } catch { /* closed */ }
    }

    const connectPromise = new Promise<void>((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
    });
    this.connectPromise = connectPromise;

    let socket: WebSocket;
    try {
      socket = new WebSocket(buildSocketUrl(this.relay));
    } catch (error) {
      this.finishConnectFailure(
        new RemoteHostError(
          'RELAY_NETWORK_ERROR',
          error instanceof Error ? error.message : 'Unable to open Mira Relay',
          undefined,
          error,
        ),
      );
      return connectPromise;
    }
    this.socket = socket;
    this.authenticated = false;
    this.helloSent = false;
    // Distinct socket-open timeout: DNS/TLS failures must not hang forever.
    this.socketOpenTimer = setTimeout(() => {
      if (this.socket === socket && this.connectPromise) {
        this.failAdmission(socket, new RemoteHostError(
          'RELAY_CONNECT_TIMEOUT', 'Mira Relay connection timed out'));
      }
    }, HANDSHAKE_TIMEOUT_MS);

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.stopSocketOpenTimer();
      // Ticket acquisition has an independent HTTP budget; start hello/ack
      // timeout only after sending hello.
      void this.openAdmission(socket);
    };

    socket.onmessage = event => {
      if (this.socket !== socket) return;
      if (typeof event.data !== 'string') {
        this.failProtocol('Mira Relay returned a non-text frame');
        return;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(event.data) as unknown;
      } catch {
        this.failProtocol('Mira Relay returned invalid JSON');
        return;
      }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        this.failProtocol('Mira Relay returned an invalid frame');
        return;
      }
      const record = raw as Record<string, unknown>;
      if (
        record.type === 'error' &&
        this.connectPromise &&
        typeof record.code === 'string'
      ) {
        this.failAdmission(socket, this.admissionError(
          record.code,
          typeof record.message === 'string'
            ? record.message
            : 'Mira Relay rejected the connection',
        ));
        return;
      }
      if (record.type === 'hello_ack') {
        if (!this.connectPromise || !this.helloSent) {
          this.failProtocol('Mira Relay acknowledged an unsent hello');
          return;
        }
        if (
          record.version !== 1 ||
          record.role !== 'client' ||
          record.relayId !== this.relay.relayId ||
          record.protocolVersion !== 1
        ) {
          this.failProtocol('Mira Relay hello acknowledgement is invalid');
          return;
        }
        this.stopHandshakeTimer();
        this.authenticated = true;
        const resolve = this.resolveConnect;
        this.resolveConnect = null;
        this.rejectConnect = null;
        this.connectPromise = null;
        resolve?.();
        return;
      }

      const frame = parseInboundFrame(event.data);
      if (!frame) {
        this.failProtocol('Mira Relay returned an invalid protocol frame');
        return;
      }
      this.handleFrame(frame);
    };

    socket.onerror = () => {
      if (this.socket !== socket) return;
      this.failAdmission(socket, new RemoteHostError(
        'RELAY_NETWORK_ERROR', 'Unable to reach Mira Relay'));
    };

    socket.onclose = event => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.authenticated = false;
      this.helloSent = false;
      this.stopHandshakeTimer();
      const reason = event.reason || 'Mira Relay connection closed';
      if (this.connectPromise) {
        this.finishConnectFailure(
          new RemoteHostError('RELAY_DISCONNECTED', reason),
        );
      }
      this.failAll(new RemoteHostError('RELAY_DISCONNECTED', reason));
    };

    return connectPromise;
  }

  private openAdmission(socket: WebSocket) {
    let pendingHello: Record<string, unknown> | Promise<Record<string, unknown>>;
    try {
      pendingHello = this.admission.createHello(this.relay);
    } catch (error) {
      this.failAdmission(socket, error);
      return;
    }
    if (isPromiseLike(pendingHello)) {
      void pendingHello.then(
        hello => this.sendAdmissionHello(socket, hello),
        error => this.failAdmission(socket, error),
      );
      return;
    }
    this.sendAdmissionHello(socket, pendingHello);
  }

  private sendAdmissionHello(
    socket: WebSocket,
    hello: Record<string, unknown>,
  ) {
    if (this.socket !== socket || socket.readyState !== 1 ||
        !this.connectPromise) return;
    this.handshakeTimer = setTimeout(() => {
      if (this.socket !== socket || !this.connectPromise) return;
      this.finishConnectFailure(
        new RemoteHostError(
          'RELAY_HANDSHAKE_TIMEOUT', 'Mira Relay handshake timed out',
        ),
      );
      try {
        socket.close(1008, 'Relay handshake timeout');
      } catch {
        // Socket may already be closed.
      }
    }, HANDSHAKE_TIMEOUT_MS);
    if (!this.send({ version: 1, type: 'hello', ...hello })) {
      this.failAdmission(socket, new RemoteHostError(
        'RELAY_DISCONNECTED', 'Mira Relay is not connected'));
      return;
    }
    this.helloSent = true;
  }

  private failAdmission(socket: WebSocket, error: unknown) {
    if (this.socket !== socket) return;
    this.socket = null;
    this.authenticated = false;
    this.helloSent = false;
    if (this.connectPromise) this.finishConnectFailure(error);
    else this.stopHandshakeTimer();
    this.failAll(error);
    try {
      socket.close(1008, 'Relay admission unavailable');
    } catch {
      // Socket may already be closed.
    }
  }

  private admissionError(code: string, message: string) {
    return new RemoteHostError(
      this.admission.mapAdmissionErrorCode(code),
      message,
      undefined,
      { relayCode: code },
    );
  }

  private handleFrame(frame: RelayInboundFrame) {
    if (frame.type === 'error' && !frame.requestId) {
      if (this.connectPromise) {
        this.finishConnectFailure(
          new RemoteHostError(
            `RELAY_${frame.code}`,
            frame.message,
            undefined,
            frame,
          ),
        );
      }
      return;
    }

    const requestId = frame.requestId;
    if (!requestId) return;
    const pending = this.pending.get(requestId);
    if (!pending) return;

    if (frame.type === 'error') {
      this.pending.delete(requestId);
      const error = new RemoteHostError(
        `RELAY_${frame.code}`,
        frame.message,
        undefined,
        { retryable: frame.retryable },
      );
      if (pending.kind === 'json') pending.reject(error);
      else pending.queue.fail(error);
      return;
    }

    if (frame.type === 'response') {
      pending.status = frame.status;
      if (pending.kind === 'sse' && pending.pendingChunks.length > 0) {
        this.flushSseChunks(requestId, pending, pending.pendingChunks);
        pending.pendingChunks.length = 0;
      }
      return;
    }

    if (frame.type === 'chunk') {
      let bytes: Uint8Array;
      try {
        bytes = base64Decode(frame.data);
      } catch (error) {
        this.pending.delete(requestId);
        if (pending.kind === 'json') pending.reject(error);
        else pending.queue.fail(error);
        this.send({ version: 1, type: 'cancel', requestId });
        return;
      }

      if (pending.kind === 'json') {
        pending.chunks.push(bytes);
        return;
      }

      if (pending.status === null) {
        pending.pendingChunks.push(bytes);
        return;
      }

      this.flushSseChunks(requestId, pending, [bytes]);
      return;
    }

    // parseInboundFrame already rejects every unknown frame type, so reaching
    // this point means the frame is the validated `complete` variant.
    this.pending.delete(requestId);
    if (pending.kind === 'json') {
      this.completeJson(pending);
    } else {
      pending.pendingChunks.length = 0;
      this.completeSse(pending);
    }
  }

  private flushSseChunks(
    requestId: string,
    pending: SsePending<unknown>,
    chunks: Uint8Array[],
  ) {
    if (pending.status !== null && (pending.status < 200 || pending.status >= 300)) {
      for (const chunk of chunks) pending.errorChunks.push(chunk);
      return;
    }

    try {
      for (const chunk of chunks) {
        const text = pending.textDecoder.feed(chunk);
        pending.decoder.feed(text).forEach(event => pending.queue.push(event));
      }
    } catch (error) {
      this.pending.delete(requestId);
      pending.queue.fail(error);
      this.send({ version: 1, type: 'cancel', requestId });
    }
  }

  private completeJson(pending: JsonPending<unknown>) {
    try {
      const status = pending.status;
      if (status === null) {
        pending.reject(
          new RemoteHostError(
            'RELAY_NO_RESPONSE_STATUS',
            'Mira Relay completed the request without sending a response status frame',
          ),
        );
        return;
      }
      const text = decodeUtf8(concatBytes(pending.chunks));
      const payload = parseJsonText(text, status);
      if (status < 200 || status >= 300) {
        const envelope = extractEnvelopeError(payload);
        pending.reject(
          new RemoteHostError(
            envelope?.code ?? `HTTP_${status}`,
            envelope?.message ?? `Mira Host request failed with HTTP ${status}`,
            status,
            envelope?.details ?? payload,
          ),
        );
        return;
      }

      try {
        pending.resolve(
          pending.raw
            ? pending.parse(payload)
            : unwrapApiEnvelope(payload, pending.parse),
        );
      } catch (error) {
        const value = error as Error & {
          code?: string | number;
          details?: unknown;
        };
        pending.reject(
          new RemoteHostError(
            value.code === undefined ? 'INVALID_RESPONSE' : String(value.code),
            value.message,
            status,
            value.details,
          ),
        );
      }
    } catch (error) {
      pending.reject(error);
    }
  }

  private completeSse(pending: SsePending<unknown>) {
    const status = pending.status;
    if (status === null) {
      pending.queue.fail(
        new RemoteHostError(
          'RELAY_NO_RESPONSE_STATUS',
          'Mira Relay completed the stream without sending a response status frame',
        ),
      );
      return;
    }
    if (status < 200 || status >= 300) {
      try {
        const payload = parseJsonText(
          decodeUtf8(concatBytes(pending.errorChunks)),
          status,
        );
        const envelope = extractEnvelopeError(payload);
        pending.queue.fail(
          new RemoteHostError(
            envelope?.code ?? `HTTP_${status}`,
            envelope?.message ?? `Mira Host stream failed with HTTP ${status}`,
            status,
            envelope?.details ?? payload,
          ),
        );
      } catch (error) {
        pending.queue.fail(error);
      }
      return;
    }

    try {
      const suffix = pending.textDecoder.finish();
      if (suffix) {
        pending.decoder.feed(suffix).forEach(event => pending.queue.push(event));
      }
      pending.decoder.finish().forEach(event => pending.queue.push(event));
      pending.queue.close();
    } catch (error) {
      pending.queue.fail(error);
    }
  }

  private nextRequestId() {
    this.sequence += 1;
    return `mobile_${Date.now().toString(36)}_${this.sequence.toString(36)}`;
  }

  private send(frame: Record<string, unknown>) {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return false;
    try {
      socket.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  private failProtocol(message: string) {
    const error = new RemoteHostError('RELAY_PROTOCOL_ERROR', message);
    const socket = this.socket;
    if (socket) this.failAdmission(socket, error);
  }

  private finishConnectFailure(error: unknown) {
    this.stopHandshakeTimer();
    const reject = this.rejectConnect;
    this.resolveConnect = null;
    this.rejectConnect = null;
    this.connectPromise = null;
    reject?.(error);
  }

  private stopSocketOpenTimer() {
    if (this.socketOpenTimer) clearTimeout(this.socketOpenTimer);
    this.socketOpenTimer = null;
  }

  private stopHandshakeTimer() {
    this.stopSocketOpenTimer();
    if (!this.handshakeTimer) return;
    clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
  }

  private failAll(error: unknown) {
    for (const pending of this.pending.values()) {
      if (pending.kind === 'json') pending.reject(error);
      else pending.queue.fail(error);
    }
    this.pending.clear();
  }
}

const connections = new Map<string, RelayConnection>();

const connectionFor = (relay: RemoteRelayEndpoint) => {
  const key = `${relay.endpoint}\n${relay.relayId}\n${relay.token}`;
  let connection = connections.get(key);
  if (!connection) {
    connection = new RelayConnection(
      relay,
      legacyRelayAdmission(relay.token),
      () => {
        connections.delete(key);
      },
    );
    connections.set(key, connection);
  }
  return connection;
};

export const requestRelayJson = <T>(
  relay: RemoteRelayEndpoint,
  request: RemoteJsonRequest<T>,
) => connectionFor(relay).requestJson(request);

export const openRelayPostSse = <T>(
  relay: RemoteRelayEndpoint,
  request: PostSseRequest<T>,
) => connectionFor(relay).openSse(request);

export const closeRelayConnections = () => {
  for (const connection of connections.values()) connection.close();
  connections.clear();
};

export const isRelayTransportError = (error: unknown) =>
  error instanceof RemoteHostError && error.code.startsWith('RELAY_');
