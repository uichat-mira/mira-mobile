import {
  CloudAuthRequestError,
  CLOUD_RELAY_TRANSPORT_AUDIENCE,
  type CloudRelayApiLike,
  type IssuedRelayTransportTicket,
} from './cloudAuthApi';
import {
  CloudRelayEntry,
  selectCloudRelayHost,
} from './cloudRelayEntry';
import { MemoryCloudSessionStore } from './cloudSessionStore';

const now = new Date('2026-10-31T15:00:00.000Z');

const host = {
  id: 'host-1',
  deviceId: 'device-desktop-1',
  displayName: 'Mira Desktop',
  clientVersion: '1.0.0',
  availability: 'available' as const,
  relayRoom: 'room_1234567890abcdef',
  registeredAt: '2026-10-31T14:00:00.000Z',
  lastAdvertisedAt: '2026-10-31T14:59:30.000Z',
  leaseExpiresAt: '2026-10-31T15:01:30.000Z',
};

const ticketFor = (
  room: string,
  accountId = 'account-1',
): IssuedRelayTransportTicket => ({
  token: 'client-jwt-ticket',
  tokenType: 'Bearer' as const,
  audience: CLOUD_RELAY_TRANSPORT_AUDIENCE,
  expiresAt: '2026-10-31T15:05:00.000Z',
  claims: {
    accountId,
    deviceId: 'device-mobile-1',
    room,
    role: 'client' as const,
    expiresAt: '2026-10-31T15:05:00.000Z',
  },
});

interface FakeCloudRelayApi extends CloudRelayApiLike {
  listHosts: jest.Mock;
  issueRelayClientTicket: jest.Mock;
}

const api = (overrides: {
  listHosts?: jest.Mock;
  issueRelayClientTicket?: jest.Mock;
} = {}): FakeCloudRelayApi => ({
  listHosts: overrides.listHosts ?? jest.fn(async () => [host]),
  issueRelayClientTicket:
    overrides.issueRelayClientTicket ??
    jest.fn(async (_token: string, room: string) => ticketFor(room)),
});

const storedSession = async () => {
  const store = new MemoryCloudSessionStore();
  await store.save({
    schemaVersion: 1,
    sessionToken: 'mcs_v1.session-id.secret',
    account: { id: 'account-1', username: 'alice' },
    expiresAt: '2026-11-30T00:00:00.000Z',
    savedAt: '2026-10-31T14:00:00.000Z',
  });
  return store;
};

const entry = (
  store: MemoryCloudSessionStore,
  apiLike: FakeCloudRelayApi,
  relayEndpoint: string | null = 'https://cloud-relay.example.test',
) => new CloudRelayEntry({ sessionStore: store, api: apiLike, relayEndpoint, now: () => now });

describe('MOB-080 Cloud Relay discovery and ticket slice', () => {
  it('requires a device-bound Cloud Session before any Host discovery', async () => {
    const store = new MemoryCloudSessionStore();
    const apiLike = api();
    await expect(entry(store, apiLike).discover()).rejects.toMatchObject({
      code: 'CLOUD_RELAY_SESSION_REQUIRED',
    });
    expect(apiLike.listHosts).not.toHaveBeenCalled();
  });

  it('rejects an expired Cloud Session without calling Cloud Auth', async () => {
    const store = new MemoryCloudSessionStore();
    await store.save({
      schemaVersion: 1,
      sessionToken: 'mcs_v1.session-id.secret',
      account: { id: 'account-1', username: 'alice' },
      expiresAt: '2026-10-31T14:00:00.000Z',
      savedAt: '2026-10-31T13:00:00.000Z',
    });
    const apiLike = api();
    await expect(entry(store, apiLike).discover()).rejects.toMatchObject({
      code: 'CLOUD_RELAY_SESSION_REJECTED',
    });
    expect(apiLike.listHosts).not.toHaveBeenCalled();
  });

  it('requires an explicitly approved Cloud Relay endpoint', async () => {
    const apiLike = api();
    await expect(
      entry(await storedSession(), apiLike, null).discover(),
    ).rejects.toMatchObject({ code: 'CLOUD_RELAY_ENDPOINT_UNAVAILABLE' });
    expect(apiLike.listHosts).not.toHaveBeenCalled();
  });

  it('does not use the Legacy production Relay URL implicitly', async () => {
    const apiLike = api();
    await expect(
      entry(await storedSession(), apiLike, 'https://relay.tomz.io').discover(),
    ).resolves.toMatchObject({
      target: { endpoint: 'https://relay.tomz.io' },
    });
    // The endpoint is only usable because the caller supplied it explicitly;
    // the Cloud entry has no default and never rewrites to Legacy transport.
  });

  it('selects the most recently advertised available account Host', () => {
    const older = { ...host, id: 'host-old', lastAdvertisedAt: '2026-10-31T14:50:00.000Z' };
    const newer = { ...host, id: 'host-new', lastAdvertisedAt: '2026-10-31T14:59:50.000Z' };
    expect(selectCloudRelayHost([older, newer])?.id).toBe('host-new');
    expect(
      selectCloudRelayHost([{ ...host, availability: 'offline' }]),
    ).toBeNull();
  });

  it('distinguishes no Host, offline Host and ambiguous Host data', async () => {
    await expect(
      entry(
        await storedSession(),
        api({ listHosts: jest.fn(async () => []) }),
      ).discover(),
    ).rejects.toMatchObject({ code: 'CLOUD_RELAY_HOST_NOT_FOUND' });

    await expect(
      entry(
        await storedSession(),
        api({
          listHosts: jest.fn(async () => [{ ...host, availability: 'offline' }]),
        }),
      ).discover(),
    ).rejects.toMatchObject({ code: 'CLOUD_RELAY_HOST_OFFLINE' });
  });

  it('maps a Relay room denial to Cloud authorization, not transport failure', async () => {
    const apiLike = api({
      issueRelayClientTicket: jest.fn(async () => {
        throw new CloudAuthRequestError(
          'rejected',
          'denied',
          'SERVICE_CREDENTIAL_RELAY_NOT_AUTHORIZED',
        );
      }),
    });
    const relayEntry = entry(await storedSession(), apiLike);
    const access = await relayEntry.discover();
    await expect(
      access.tickets.acquireClientTicket(access.target.room),
    ).rejects.toMatchObject({ code: 'CLOUD_RELAY_TICKET_DENIED' });
  });

  it('rejects a ticket bound to another account or room before opening a socket', async () => {
    const wrongAccountApi = api({
      issueRelayClientTicket: jest.fn(async (_token: string, room: string) =>
        ticketFor(room, 'account-other'),
      ),
    });
    const wrongAccountEntry = entry(await storedSession(), wrongAccountApi);
    const wrongAccountAccess = await wrongAccountEntry.discover();
    await expect(
      wrongAccountAccess.tickets.acquireClientTicket(wrongAccountAccess.target.room),
    ).rejects.toMatchObject({ code: 'CLOUD_RELAY_TICKET_INVALID' });

    const roomApi = api();
    const roomEntry = entry(await storedSession(), roomApi);
    const roomAccess = await roomEntry.discover();
    await expect(
      roomAccess.tickets.acquireClientTicket('room_other1234567890'),
    ).rejects.toMatchObject({ code: 'CLOUD_RELAY_TICKET_INVALID' });
    expect(roomApi.issueRelayClientTicket).not.toHaveBeenCalled();
  });

  it('memoizes per-session Cloud access and resets it after sign-out', async () => {
    const store = await storedSession();
    const relayEntry = entry(store, api());
    const first = await relayEntry.discover();
    const same = await relayEntry.discover();
    expect(same).toBe(first);
    expect(same.tickets).toBe(first.tickets);

    relayEntry.reset();
    const refreshed = await relayEntry.discover();
    expect(refreshed.tickets).not.toBe(first.tickets);

    await store.clear();
    await expect(relayEntry.discover()).rejects.toMatchObject({
      code: 'CLOUD_RELAY_SESSION_REQUIRED',
    });
  });

  it('acquires a new ticket for each socket establishment without caching', async () => {
    const apiLike = api();
    const relayEntry = entry(await storedSession(), apiLike);
    const access = await relayEntry.discover();

    await expect(
      access.tickets.acquireClientTicket(access.target.room),
    ).resolves.toBe('client-jwt-ticket');
    await expect(
      access.tickets.acquireClientTicket(access.target.room),
    ).resolves.toBe('client-jwt-ticket');
    expect(apiLike.issueRelayClientTicket).toHaveBeenCalledTimes(2);
  });
});
