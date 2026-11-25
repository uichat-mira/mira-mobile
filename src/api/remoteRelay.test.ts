import {
  closeCloudRelayConnections,
  openCloudRelayPostSse,
  requestCloudRelayJson,
} from './cloudRelay';

const relay = {
  endpoint: 'https://relay.tomz.io',
  room: 'relay_1234567890abcdef',
};
const ticket = 'short-lived-cloud-ticket';
const tickets = { acquireClientTicket: async () => ticket };

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

type SocketHandler = ((event?: any) => void) | null;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: SocketHandler = null;
  onmessage: SocketHandler = null;
  onerror: SocketHandler = null;
  onclose: SocketHandler = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(_code?: number, reason?: string) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ reason: reason ?? '' });
  }

  open() {
    this.readyState = 1;
    this.onopen?.({});
  }

  message(frame: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const parseSent = (socket: FakeWebSocket) =>
  socket.sent.map(value => JSON.parse(value) as Record<string, unknown>);

const utf8Bytes = (value: string) => {
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
  return bytes;
};

const base64 = (value: string) => {
  const bytes = utf8Bytes(value);
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const packed = (a << 16) | (b << 8) | c;
    output += BASE64_ALPHABET[(packed >> 18) & 63];
    output += BASE64_ALPHABET[(packed >> 12) & 63];
    output +=
      index + 1 < bytes.length
        ? BASE64_ALPHABET[(packed >> 6) & 63]
        : '=';
    output += index + 2 < bytes.length ? BASE64_ALPHABET[packed & 63] : '=';
  }
  return output;
};

const connect = async (socket: FakeWebSocket) => {
  socket.open();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(parseSent(socket)[0]).toEqual({
    version: 1,
    type: 'hello',
    role: 'client',
    relayId: relay.room,
    token: ticket,
  });
  socket.message({
    version: 1,
    type: 'hello_ack',
    role: 'client',
    relayId: relay.room,
    protocolVersion: 1,
    hostConnected: true,
  });
  await Promise.resolve();
};

beforeEach(() => {
  closeCloudRelayConnections();
  FakeWebSocket.instances = [];
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    writable: true,
    value: FakeWebSocket,
  });
});

afterEach(() => {
  closeCloudRelayConnections();
});

describe('Mira Relay transport', () => {
  it('forwards contract-scoped headers without replacing transport auth', async () => {
    const request = requestCloudRelayJson(relay, tickets, {
      hostUrl: relay.endpoint,
      path: '/mcp',
      method: 'POST',
      credential: '',
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call' },
      headers: { 'X-Mira-Thread-Id': 'local-thread-1' },
      raw: true,
      parse: value => value as { ok: boolean },
    });

    const socket = FakeWebSocket.instances[0];
    await connect(socket);
    const requestFrame = parseSent(socket).find(frame => frame.type === 'request');
    expect(requestFrame).toMatchObject({
      method: 'POST',
      path: '/mcp',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Mira-Thread-Id': 'local-thread-1',
      },
    });
    expect(
      (requestFrame?.headers as Record<string, string>).Authorization,
    ).toBeUndefined();

    const requestId = String(requestFrame?.requestId);
    socket.message({
      version: 1,
      type: 'response',
      requestId,
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    socket.message({
      version: 1,
      type: 'chunk',
      requestId,
      encoding: 'base64',
      data: base64(JSON.stringify({ ok: true })),
    });
    socket.message({ version: 1, type: 'complete', requestId });
    await expect(request).resolves.toEqual({ ok: true });
  });

  it('forwards authenticated JSON and unwraps the Host response', async () => {
    const request = requestCloudRelayJson(relay, tickets, {
      hostUrl: relay.endpoint,
      path: '/remote/v1/manifest',
      credential: 'host-grant-token',
      parse: value => value as { ok: boolean },
    });

    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe(
      'wss://relay.tomz.io/v1/relay/relay_1234567890abcdef/socket',
    );
    await connect(socket);

    const requestFrame = parseSent(socket).find(frame => frame.type === 'request');
    expect(requestFrame).toMatchObject({
      method: 'GET',
      path: '/remote/v1/manifest',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer host-grant-token',
      },
    });
    const requestId = String(requestFrame?.requestId);

    socket.message({
      version: 1,
      type: 'response',
      requestId,
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    socket.message({
      version: 1,
      type: 'chunk',
      requestId,
      encoding: 'base64',
      data: base64(
        JSON.stringify({
          success: true,
          data: { ok: true },
          timestamp: '2026-08-09T00:00:00.000Z',
        }),
      ),
    });
    socket.message({ version: 1, type: 'complete', requestId });

    await expect(request).resolves.toEqual({ ok: true });
  });

  it('decodes Relay chunks as the existing SSE stream contract', async () => {
    const session = openCloudRelayPostSse(relay, tickets, {
      hostUrl: relay.endpoint,
      path: '/proxy/chat/default',
      credential: 'host-grant-token',
      body: { id: 'thread-1', messageId: 'message-1' },
      parse: value => value as { type: string; delta: string },
    });

    const socket = FakeWebSocket.instances[0];
    await connect(socket);
    await Promise.resolve();

    const requestFrame = parseSent(socket).find(frame => frame.type === 'request');
    const requestId = String(requestFrame?.requestId);
    expect(requestFrame).toMatchObject({
      method: 'POST',
      path: '/proxy/chat/default',
    });

    const iterator = session.events[Symbol.asyncIterator]();
    const firstEvent = iterator.next();
    socket.message({
      version: 1,
      type: 'response',
      requestId,
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    socket.message({
      version: 1,
      type: 'chunk',
      requestId,
      encoding: 'base64',
      data: base64('data: {"type":"text-delta","delta":"你好"}\n\n'),
    });
    socket.message({ version: 1, type: 'complete', requestId });

    await expect(firstEvent).resolves.toEqual({
      value: { type: 'text-delta', delta: '你好' },
      done: false,
    });
    await expect(iterator.next()).resolves.toEqual({
      value: undefined,
      done: true,
    });
  });

  it('propagates stream cancellation to Desktop through Relay', async () => {
    const session = openCloudRelayPostSse(relay, tickets, {
      hostUrl: relay.endpoint,
      path: '/proxy/chat/default',
      credential: 'host-grant-token',
      body: { id: 'thread-1', messageId: 'message-1' },
      parse: value => value,
    });

    const socket = FakeWebSocket.instances[0];
    await connect(socket);
    await Promise.resolve();

    const requestFrame = parseSent(socket).find(frame => frame.type === 'request');
    const requestId = String(requestFrame?.requestId);
    const iterator = session.events[Symbol.asyncIterator]();
    const waiting = iterator.next();

    session.abort();

    expect(parseSent(socket)).toContainEqual({
      version: 1,
      type: 'cancel',
      requestId,
    });
    await expect(waiting).rejects.toMatchObject({
      code: 'REQUEST_ABORTED',
    });
  });
});
