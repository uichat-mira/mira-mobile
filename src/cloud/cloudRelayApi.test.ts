import {
  CloudAuthApi,
  CloudAuthRequestError,
  CLOUD_RELAY_TRANSPORT_AUDIENCE,
  CLOUD_RELAY_TRANSPORT_SCOPE,
  parseCloudDesktopHostList,
  parseIssuedRelayTransportTicket,
  parseRelayTransportTicketClaims,
} from './cloudAuthApi';

const now = Date.parse('2026-10-31T15:00:00.000Z');

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Claims are bounded ASCII identifiers; this keeps the test independent of
// Node Buffer typings that the React Native app does not include.
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

const encodeSegment = (value: unknown) =>
  base64(JSON.stringify(value))
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');

const relayTicket = (
  overrides: Record<string, unknown> = {},
  baseMs: number = Date.now(),
) => {
  const issuedAt = Math.floor(baseMs / 1000);
  const claims = {
    iss: 'mira:cloud-auth',
    sub: 'account-1',
    device_id: 'device-mobile-1',
    aud: CLOUD_RELAY_TRANSPORT_AUDIENCE,
    scope: [CLOUD_RELAY_TRANSPORT_SCOPE],
    relay: { room: 'room_1234567890abcdef', role: 'client' },
    iat: issuedAt,
    nbf: issuedAt,
    exp: issuedAt + 300,
    ...overrides,
  };
  return [
    encodeSegment({ alg: 'EdDSA', typ: 'JWT', kid: 'cloud-auth-2026-10' }),
    encodeSegment(claims),
    'signature',
  ].join('.');
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const host = {
  id: 'host-1',
  deviceId: 'device-desktop-1',
  displayName: 'Mira Desktop',
  clientVersion: '1.0.0',
  availability: 'available',
  relayRoom: 'room_1234567890abcdef',
  registeredAt: '2026-10-31T14:00:00.000Z',
  lastAdvertisedAt: '2026-10-31T14:59:30.000Z',
  leaseExpiresAt: '2026-10-31T15:01:30.000Z',
};

describe('Mira Cloud Host directory and Relay ticket contract', () => {
  it('parses the OPS-018 Host directory and rejects unknown fields/value shapes', () => {
    expect(parseCloudDesktopHostList({ hosts: [host] })).toEqual([host]);
    expect(() =>
      parseCloudDesktopHostList({
        hosts: [{ ...host, availability: 'online' }],
      }),
    ).toThrow(CloudAuthRequestError);
    expect(() =>
      parseCloudDesktopHostList({
        hosts: [{ ...host, relayRoom: '../bad room' }],
      }),
    ).toThrow(CloudAuthRequestError);
  });

  it('binds ticket claims to the requested account, room and client role', () => {
    const token = relayTicket({}, now);
    expect(
      parseRelayTransportTicketClaims(token, host.relayRoom, now),
    ).toMatchObject({
      accountId: 'account-1',
      deviceId: 'device-mobile-1',
      room: host.relayRoom,
      role: 'client',
    });

    expect(() =>
      parseRelayTransportTicketClaims(token, 'room_other1234567890', now),
    ).toThrow(CloudAuthRequestError);
    expect(() =>
      parseRelayTransportTicketClaims(
        relayTicket({ relay: { room: host.relayRoom, role: 'host' } }, now),
        host.relayRoom,
        now,
      ),
    ).toThrow(CloudAuthRequestError);
    expect(() =>
      parseRelayTransportTicketClaims(
        relayTicket({ aud: 'mira:cloud-shiyan' }, now),
        host.relayRoom,
        now,
      ),
    ).toThrow(CloudAuthRequestError);
    expect(() =>
      parseRelayTransportTicketClaims(
        relayTicket({ exp: Math.floor(now / 1000) - 1 }, now),
        host.relayRoom,
        now,
      ),
    ).toThrow(CloudAuthRequestError);
    expect(() =>
      parseRelayTransportTicketClaims('not-a-jwt', host.relayRoom, now),
    ).toThrow(CloudAuthRequestError);
  });

  it('lists account Hosts with the device-bound Cloud Session', async () => {
    const fetchMock = jest.fn(async () => jsonResponse(200, { hosts: [host] }));
    const api = new CloudAuthApi(
      'https://cloud-auth.tomzlab.cn',
      fetchMock as unknown as typeof fetch,
    );

    await expect(api.listHosts('mcs_v1.session-id.secret')).resolves.toEqual([
      host,
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://cloud-auth.tomzlab.cn/v1/hosts');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer mcs_v1.session-id.secret',
    );
  });

  it('requests one Client transport ticket for the server-owned room', async () => {
    const token = relayTicket();
    const expiresAt = new Date((Math.floor(now / 1000) + 300) * 1000).toISOString();
    const fetchMock = jest.fn(async () =>
      jsonResponse(200, {
        token,
        tokenType: 'Bearer',
        audience: CLOUD_RELAY_TRANSPORT_AUDIENCE,
        expiresAt,
      }),
    );
    const api = new CloudAuthApi(
      'https://cloud-auth.tomzlab.cn',
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      api.issueRelayClientTicket('mcs_v1.session-id.secret', host.relayRoom),
    ).resolves.toMatchObject({
      token,
      audience: CLOUD_RELAY_TRANSPORT_AUDIENCE,
      claims: { room: host.relayRoom, role: 'client' },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://cloud-auth.tomzlab.cn/v1/service-credentials',
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      audience: CLOUD_RELAY_TRANSPORT_AUDIENCE,
      relay: { room: host.relayRoom, role: 'client' },
    });
    expect(String(init.body)).not.toContain('account');
    expect(String(init.body)).not.toContain('device');
  });

  it('keeps Relay denial distinct from other Cloud Auth failures', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse(403, {
        error: {
          code: 'SERVICE_CREDENTIAL_RELAY_NOT_AUTHORIZED',
          message: 'denied',
        },
      }),
    );
    const api = new CloudAuthApi(
      'https://cloud-auth.tomzlab.cn',
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      api.issueRelayClientTicket('mcs_v1.session-id.secret', host.relayRoom),
    ).rejects.toMatchObject({
      kind: 'rejected',
      code: 'SERVICE_CREDENTIAL_RELAY_NOT_AUTHORIZED',
    });
  });

  it('rejects a ticket response whose room does not match the request', () => {
    const token = relayTicket(
      { relay: { room: 'room_other1234567890', role: 'client' } },
      now,
    );
    expect(() =>
      parseIssuedRelayTransportTicket(
        {
          token,
          tokenType: 'Bearer',
          audience: CLOUD_RELAY_TRANSPORT_AUDIENCE,
          expiresAt: '2026-10-31T15:05:00.000Z',
        },
        host.relayRoom,
        now,
      ),
    ).toThrow(CloudAuthRequestError);
  });
});
