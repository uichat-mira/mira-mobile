import {
  closeCloudRelayConnections,
  isCloudRelayHostOfflineError,
  isCloudRelayTicketError,
  requestCloudRelayJson,
} from './cloudRelay';
import { RemoteHostError } from './remoteHttp';

const target = {
  endpoint: 'https://cloud-relay.example.test',
  room: 'room_1234567890abcdef',
};

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

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const base64 = (value: string) => {
  let output = '';
  for (let index = 0; index < value.length; index += 3) {
    const a = value.charCodeAt(index);
    const b =
      index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
    const c =
      index + 2 < value.length ? value.charCodeAt(index + 2) : 0;
    const packed = (a << 16) | (b << 8) | c;
    output += BASE64_ALPHABET[(packed >> 18) & 63];
    output += BASE64_ALPHABET[(packed >> 12) & 63];
    output +=
      index + 1 < value.length ? BASE64_ALPHABET[(packed >> 6) & 63] : '=';
    output += index + 2 < value.length ? BASE64_ALPHABET[packed & 63] : '=';
  }
  return output;
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const connect = async (socket: FakeWebSocket) => {
  socket.open();
  await flush();
  socket.message({
    version: 1,
    type: 'hello_ack',
    role: 'client',
    relayId: target.room,
    protocolVersion: 1,
    hostConnected: true,
  });
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

describe('official Cloud Relay client transport', () => {
  it('uses a Cloud Client ticket hello and never a Legacy device credential', async () => {
    const tickets = jest.fn(async () => 'client-jwt-ticket');
    const request = requestCloudRelayJson(target, { acquireClientTicket: tickets }, {
      hostUrl: target.endpoint,
      path: '/remote/v1/manifest',
      parse: value => value as { ok: boolean },
    });

    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe(
      `wss://cloud-relay.example.test/v1/relay/${target.room}/socket`,
    );
    await connect(socket);
    expect(tickets).toHaveBeenCalledTimes(1);
    expect(tickets).toHaveBeenCalledWith(target.room);
    expect(parseSent(socket)[0]).toEqual({
      version: 1,
      type: 'hello',
      role: 'client',
      relayId: target.room,
      token: 'client-jwt-ticket',
    });
    expect(parseSent(socket)[0]).not.toHaveProperty('clientToken');

    const requestFrame = parseSent(socket).find(frame => frame.type === 'request');
    expect(requestFrame).toMatchObject({
      method: 'GET',
      path: '/remote/v1/manifest',
      headers: { Accept: 'application/json' },
    });
    expect(JSON.stringify(requestFrame)).not.toContain('mira_device_');
    expect(JSON.stringify(requestFrame)).not.toContain('client-jwt-ticket');

    const requestId = String(requestFrame?.requestId);
    socket.message({
      version: 1,
      type: 'response',
      requestId,
      status: 200,
      headers: {},
    });
    socket.message({
      version: 1,
      type: 'chunk',
      requestId,
      encoding: 'base64',
      data: base64(
        JSON.stringify({ success: true, data: { ok: true } }),
      ),
    });
    socket.message({ version: 1, type: 'complete', requestId });

    await expect(request).resolves.toEqual({ ok: true });
  });

  it('holds concurrent business requests until the Client hello_ack is authenticated', async () => {
    let resolveTicket!: (token: string) => void;
    const provider = { acquireClientTicket: () => new Promise<string>(
      resolve => { resolveTicket = resolve; },
    ) };
    const first = requestCloudRelayJson(target, provider, {
      hostUrl: target.endpoint, path: '/remote/v1/manifest',
      parse: value => value,
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    await flush();
    const second = requestCloudRelayJson(target, provider, {
      hostUrl: target.endpoint, path: '/remote/v1/workspaces',
      parse: value => value,
    });
    await flush();
    expect(socket.sent).toHaveLength(0);
    resolveTicket('ticket-issued-after-socket-open');
    await flush();
    expect(parseSent(socket).map(x => x.type)).toEqual(['hello']);
    socket.message({
      version: 1, type: 'hello_ack', role: 'client',
      relayId: target.room, protocolVersion: 1, hostConnected: true,
    });
    await flush();
    const requests = parseSent(socket).filter(x => x.type === 'request');
    expect(requests).toHaveLength(2);
    for (const frame of requests) {
      const requestId = String(frame.requestId);
      socket.message({
        version: 1, type: 'response', requestId, status: 200, headers: {},
      });
      socket.message({
        version: 1, type: 'chunk', requestId, encoding: 'base64',
        data: base64(JSON.stringify({ success: true, data: {} })),
      });
      socket.message({ version: 1, type: 'complete', requestId });
    }
    await expect(first).resolves.toEqual({});
    await expect(second).resolves.toEqual({});
  });

  it('reuses a healthy socket without issuing another ticket', async () => {
    const tickets = jest.fn(async () => 'client-jwt-ticket');
    const provider = { acquireClientTicket: tickets };
    const first = requestCloudRelayJson(target, provider, {
      hostUrl: target.endpoint,
      path: '/remote/v1/manifest',
      parse: value => value,
    });
    const socket = FakeWebSocket.instances[0];
    await connect(socket);
    const firstFrame = parseSent(socket).find(frame => frame.type === 'request');
    const firstId = String(firstFrame?.requestId);
    socket.message({
      version: 1,
      type: 'response',
      requestId: firstId,
      status: 200,
      headers: {},
    });
    socket.message({
      version: 1,
      type: 'chunk',
      requestId: firstId,
      encoding: 'base64',
      data: base64(JSON.stringify({ success: true, data: { ok: true } })),
    });
    socket.message({ version: 1, type: 'complete', requestId: firstId });
    await first;

    const second = requestCloudRelayJson(target, provider, {
      hostUrl: target.endpoint,
      path: '/threads',
      parse: value => value,
    });
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(tickets).toHaveBeenCalledTimes(1);

    const frames = parseSent(socket).filter(frame => frame.type === 'request');
    const secondId = String(frames[1]?.requestId);
    socket.message({
      version: 1,
      type: 'response',
      requestId: secondId,
      status: 200,
      headers: {},
    });
    socket.message({
      version: 1,
      type: 'chunk',
      requestId: secondId,
      encoding: 'base64',
      data: base64(JSON.stringify({ success: true, data: {} })),
    });
    socket.message({ version: 1, type: 'complete', requestId: secondId });
    await second;
  });

  it('replaces an authenticated connection when a new Cloud Session provider targets the same Host', async () => {
    const firstProvider = {
      acquireClientTicket: jest.fn(async () => 'first-session-ticket'),
    };
    const secondProvider = {
      acquireClientTicket: jest.fn(async () => 'second-session-ticket'),
    };
    const first = requestCloudRelayJson(target, firstProvider, {
      hostUrl: target.endpoint,
      path: '/remote/v1/manifest',
      parse: value => value,
    });
    const oldSocket = FakeWebSocket.instances[0];
    await connect(oldSocket);

    const second = requestCloudRelayJson(target, secondProvider, {
      hostUrl: target.endpoint,
      path: '/remote/v1/manifest',
      parse: value => value,
    });
    const newSocket = FakeWebSocket.instances[1];
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(oldSocket.readyState).toBe(3);
    await expect(first).rejects.toMatchObject({ code: 'RELAY_DISCONNECTED' });
    await connect(newSocket);
    expect(secondProvider.acquireClientTicket).toHaveBeenCalledTimes(1);
    expect(parseSent(newSocket)[0]).toMatchObject({
      token: 'second-session-ticket',
    });
    const requestId = String(
      parseSent(newSocket).find(frame => frame.type === 'request')?.requestId,
    );
    newSocket.message({
      version: 1, type: 'response', requestId, status: 200, headers: {},
    });
    newSocket.message({
      version: 1, type: 'chunk', requestId, encoding: 'base64',
      data: base64(JSON.stringify({ success: true, data: {} })),
    });
    newSocket.message({ version: 1, type: 'complete', requestId });
    await second;
  });

  it('does not consume Relay hello timeout while Cloud Auth acquires a ticket', async () => {
    jest.useFakeTimers();
    try {
      let issueTicket!: (token: string) => void;
      const provider = {
        acquireClientTicket: () => new Promise<string>(resolve => {
          issueTicket = resolve;
        }),
      };
      const request = requestCloudRelayJson(target, provider, {
        hostUrl: target.endpoint,
        path: '/remote/v1/manifest',
        parse: value => value,
      });
      const onSettled = jest.fn();
      void request.then(onSettled, onSettled);
      const socket = FakeWebSocket.instances[0];
      socket.open();
      await flush();
      jest.advanceTimersByTime(11_000);
      await flush();
      expect(onSettled).not.toHaveBeenCalled();
      expect(socket.readyState).toBe(1);
      issueTicket('late-but-valid-client-ticket');
      await flush();
      expect(parseSent(socket)[0]).toMatchObject({
        type: 'hello', token: 'late-but-valid-client-ticket',
      });
      socket.message({
        version: 1, type: 'hello_ack', role: 'client',
        relayId: target.room, protocolVersion: 1, hostConnected: true,
      });
      await flush();
      const requestId = String(
        parseSent(socket).find(frame => frame.type === 'request')?.requestId,
      );
      socket.message({
        version: 1, type: 'response', requestId, status: 200, headers: {},
      });
      socket.message({
        version: 1, type: 'chunk', requestId, encoding: 'base64',
        data: base64(JSON.stringify({ success: true, data: {} })),
      });
      socket.message({ version: 1, type: 'complete', requestId });
      await expect(request).resolves.toEqual({});
    } finally {
      jest.useRealTimers();
    }
  });

  it('issues a fresh ticket for every new WebSocket', async () => {
    const tokens = ['ticket-0', 'ticket-1'];
    const tickets = jest.fn(async () => tokens.shift() ?? 'ticket-exhausted');
    const provider = { acquireClientTicket: tickets };
    const first = requestCloudRelayJson(target, provider, {
      hostUrl: target.endpoint,
      path: '/remote/v1/manifest',
      parse: value => value,
    });
    const firstSocket = FakeWebSocket.instances[0];
    await connect(firstSocket);
    firstSocket.close(1006, 'network lost');
    await expect(first).rejects.toMatchObject({ code: 'RELAY_DISCONNECTED' });

    const second = requestCloudRelayJson(target, provider, {
      hostUrl: target.endpoint,
      path: '/remote/v1/manifest',
      parse: value => value,
    });
    const secondSocket = FakeWebSocket.instances[1];
    await connect(secondSocket);
    expect(tickets).toHaveBeenCalledTimes(2);
    expect(parseSent(secondSocket)[0]).toMatchObject({
      token: 'ticket-1',
    });

    const requestFrame = parseSent(secondSocket).find(
      frame => frame.type === 'request',
    );
    const requestId = String(requestFrame?.requestId);
    secondSocket.message({
      version: 1,
      type: 'response',
      requestId,
      status: 200,
      headers: {},
    });
    secondSocket.message({
      version: 1,
      type: 'chunk',
      requestId,
      encoding: 'base64',
      data: base64(JSON.stringify({ success: true, data: {} })),
    });
    secondSocket.message({ version: 1, type: 'complete', requestId });
    await second;
  });

  it('fails before hello when the Client ticket cannot be acquired', async () => {
    const provider = {
      acquireClientTicket: jest.fn(async () => {
        throw new RemoteHostError(
          'CLOUD_RELAY_TICKET_DENIED',
          'ticket denied',
        );
      }),
    };
    const request = requestCloudRelayJson(target, provider, {
      hostUrl: target.endpoint,
      path: '/remote/v1/manifest',
      parse: value => value,
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    await flush();

    await expect(request).rejects.toMatchObject({
      code: 'CLOUD_RELAY_TICKET_DENIED',
    });
    expect(parseSent(socket)).toEqual([]);
    expect(socket.readyState).toBe(3);
    await expect(Promise.resolve(isCloudRelayTicketError(
      new RemoteHostError('CLOUD_RELAY_TICKET_DENIED', 'denied'),
    ))).resolves.toBe(true);
  });

  it('classifies bounded Cloud admission errors separately from transport errors', async () => {
    const provider = { acquireClientTicket: async () => 'client-jwt-ticket' };
    const request = requestCloudRelayJson(target, provider, {
      hostUrl: target.endpoint,
      path: '/remote/v1/manifest',
      parse: value => value,
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    await flush();
    socket.message({
      type: 'error',
      code: 'CLOUD_TICKET_REJECTED',
      message: 'Cloud Relay connection admission denied',
      retryable: false,
    });

    await expect(request).rejects.toMatchObject({
      code: 'CLOUD_RELAY_TICKET_REJECTED',
      details: { relayCode: 'CLOUD_TICKET_REJECTED' },
    });
  });

  it('keeps Relay Host-offline distinct from ticket and transport failures', async () => {
    const provider = { acquireClientTicket: async () => 'client-jwt-ticket' };
    const request = requestCloudRelayJson(target, provider, {
      hostUrl: target.endpoint,
      path: '/remote/v1/manifest',
      parse: value => value,
    });
    const socket = FakeWebSocket.instances[0];
    await connect(socket);
    const requestFrame = parseSent(socket).find(frame => frame.type === 'request');
    const requestId = String(requestFrame?.requestId);
    socket.message({
      version: 1,
      type: 'error',
      requestId,
      code: 'HOST_OFFLINE',
      message: 'Mira Desktop Relay host is offline',
      retryable: true,
    });

    await expect(request).rejects.toMatchObject({
      code: 'RELAY_HOST_OFFLINE',
    });
    expect(
      isCloudRelayHostOfflineError(
        new RemoteHostError('RELAY_HOST_OFFLINE', 'offline'),
      ),
    ).toBe(true);
    expect(
      isCloudRelayTicketError(
        new RemoteHostError('RELAY_HOST_OFFLINE', 'offline'),
      ),
    ).toBe(false);
  });
});
