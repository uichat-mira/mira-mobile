import {
  CloudAuthApi,
  CloudAuthRequestError,
  type CloudDesktopHost,
  type CloudDesktopHostAvailability,
  type CloudRelayApiLike,
} from './cloudAuthApi';
import { resolveCloudRelayBaseUrl, officialCloudRelayEndpoint } from './cloudRelayConfig';
import {
  cloudSessionStore,
  type CloudSessionStore,
  type StoredCloudSession,
} from './cloudSessionStore';
import {
  closeCloudRelayConnections,
  type CloudRelayTicketProvider,
  type CloudRelayTransportTarget,
} from '../api/cloudRelay';
import { RemoteHostError } from '../api/remoteHttp';

export interface CloudRelayTarget extends CloudRelayTransportTarget {
  hostId: string;
}

export interface CloudRelayAccess {
  /** Account that owns the Cloud Session and Host grant for this access. */
  accountId: string;
  target: CloudRelayTarget;
  tickets: CloudRelayTicketProvider;
}

/**
 * User-facing projection of a server-owned Host directory entry. Relay rooms and
 * tickets stay inside CloudRelayEntry; the Local Agent may only see identities
 * and presence that Cloud Auth actually returned.
 */
export interface CloudRelayHostCandidate {
  hostId: string;
  deviceId: string;
  name: string | null;
  availability: CloudDesktopHostAvailability;
  clientVersion: string | null;
  lastAdvertisedAt: string;
}

export interface CloudRelayHostDirectory {
  accountId: string;
  hosts: CloudRelayHostCandidate[];
}

interface CloudRelaySessionContext {
  accountId: string;
  sessionToken: string;
  room: string;
}

interface CloudRelayEntryOptions {
  sessionStore?: CloudSessionStore;
  api?: CloudRelayApiLike;
  relayEndpoint?: string | null;
  now?: () => Date;
}

const failure = (
  code: string,
  message: string,
  cause?: unknown,
): RemoteHostError => new RemoteHostError(code, message, undefined, cause);

const discoveryFailure = (error: unknown): RemoteHostError => {
  if (error instanceof CloudAuthRequestError) {
    if (error.kind === 'rejected') {
      return error.code === 'SERVICE_CREDENTIAL_RELAY_NOT_AUTHORIZED'
        ? failure(
            'CLOUD_RELAY_TICKET_DENIED',
            'Mira Cloud denied this Cloud Relay connection',
            error,
          )
        : failure(
            'CLOUD_RELAY_SESSION_REJECTED',
            'Mira Cloud sign-in is no longer valid',
            error,
          );
    }
    if (error.kind === 'not_found') {
      return failure(
        'CLOUD_RELAY_HOST_NOT_FOUND',
        'Mira Cloud could not find an account-owned Desktop Host',
        error,
      );
    }
    if (error.kind === 'invalid_response') {
      return failure(
        'CLOUD_RELAY_INVALID_RESPONSE',
        'Mira Cloud returned an invalid Cloud Relay response',
        error,
      );
    }
  }
  return failure(
    'CLOUD_RELAY_AUTH_UNAVAILABLE',
    'Mira Cloud is unavailable for Cloud Relay discovery',
    error,
  );
};

const ticketFailure = (error: unknown): RemoteHostError => {
  if (error instanceof CloudAuthRequestError) {
    if (error.code === 'CLOUD_RELAY_TICKET_INVALID') {
      return failure(
        'CLOUD_RELAY_TICKET_INVALID',
        'Mira Cloud returned an invalid Client Relay ticket',
        error,
      );
    }
    if (error.kind === 'rejected') {
      if (error.code === 'SERVICE_CREDENTIAL_REAUTH_REQUIRED') {
        return failure(
          'CLOUD_RELAY_SESSION_REJECTED',
          'Mira Cloud sign-in is no longer valid',
          error,
        );
      }
      return failure(
        'CLOUD_RELAY_TICKET_DENIED',
        'Mira Cloud denied a Client transport ticket for this Host',
        error,
      );
    }
    if (error.kind === 'invalid_response') {
      return failure(
        'CLOUD_RELAY_TICKET_INVALID',
        'Mira Cloud returned an invalid Client Relay ticket',
        error,
      );
    }
  }
  return failure(
    'CLOUD_RELAY_AUTH_UNAVAILABLE',
    'Mira Cloud is unavailable for Client Relay ticket issuance',
    error,
  );
};

/**
 * Multiple same-account Hosts are all permitted by Cloud Auth. Choosing the
 * most recently advertised available Host keeps discovery deterministic without
 * asking the user to understand Cloud rooms.
 */
export const selectCloudRelayHost = (
  hosts: CloudDesktopHost[],
): CloudDesktopHost | null =>
  hosts
    .filter(host => host.availability === 'available')
    .sort((left, right) => {
      const advertised =
        Date.parse(right.lastAdvertisedAt) - Date.parse(left.lastAdvertisedAt);
      if (advertised !== 0) return advertised;
      return left.id.localeCompare(right.id);
    })[0] ?? null;

class ApiCloudRelayTicketSource implements CloudRelayTicketProvider {
  constructor(
    private readonly api: CloudRelayApiLike,
    private readonly context: CloudRelaySessionContext,
    private readonly isCurrent: () => boolean,
  ) {}

  async acquireClientTicket(room: string): Promise<string> {
    if (!this.isCurrent()) {
      throw failure('CLOUD_RELAY_SESSION_REJECTED', 'Cloud Relay session is no longer active');
    }
    if (room !== this.context.room) {
      throw failure(
        'CLOUD_RELAY_TICKET_INVALID',
        'Client Relay ticket request does not match the discovered Host room',
      );
    }

    let ticket;
    try {
      ticket = await this.api.issueRelayClientTicket(
        this.context.sessionToken,
        room,
      );
    } catch (error) {
      throw ticketFailure(error);
    }

    if (!this.isCurrent()) {
      throw failure('CLOUD_RELAY_SESSION_REJECTED', 'Cloud Relay session changed during ticket issuance');
    }
    if (ticket.claims.accountId !== this.context.accountId) {
      throw failure(
        'CLOUD_RELAY_TICKET_INVALID',
        'Client Relay ticket belongs to a different Mira Cloud account',
      );
    }
    return ticket.token;
  }
}

/**
 * Mobile consumer for the official Cloud Relay entry. It only discovers an
 * account-owned Host and obtains transport tickets; Host business authority is
 * still decided by the separately owned Cloud Host grant contract.
 */
export class CloudRelayEntry {
  private readonly store: CloudSessionStore;
  private readonly api: CloudRelayApiLike;
  private readonly relayEndpoint: string | null;
  private readonly now: () => Date;
  private generation = 0;
  private pendingDiscovery: Promise<CloudRelayAccess> | null = null;
  private sessionKey: string | null = null;
  private accessesByHost = new Map<string, { key: string; access: CloudRelayAccess }>();
  private validAccesses = new WeakSet<CloudRelayAccess>();

  constructor(options: CloudRelayEntryOptions = {}) {
    this.store = options.sessionStore ?? cloudSessionStore;
    this.api = options.api ?? new CloudAuthApi();
    this.relayEndpoint = options.relayEndpoint === undefined
      ? officialCloudRelayEndpoint() : options.relayEndpoint;
    this.now = options.now ?? (() => new Date());
  }

  reset() {
    this.generation += 1;
    this.pendingDiscovery = null;
    this.sessionKey = null;
    this.accessesByHost.clear();
    this.validAccesses = new WeakSet();
    closeCloudRelayConnections();
  }

  /**
   * Every Host access in the current Cloud Session stays independently valid so
   * a Local Agent probing candidates cannot invalidate an open Cloud Chat on
   * another Host. Logout, account switch and reset revoke all of them at once.
   */
  assertCurrentAccess(access: CloudRelayAccess): void {
    if (!this.validAccesses.has(access)) {
      throw failure('CLOUD_RELAY_SESSION_REJECTED', 'Cloud Relay session is no longer active');
    }
  }

  /** Cloud Remote Chat keeps its existing deterministic most-recent Host. */
  discover(): Promise<CloudRelayAccess> {
    if (this.pendingDiscovery) return this.pendingDiscovery;
    const pending = this.discoverMostRecent();
    this.pendingDiscovery = pending;
    const release = () => {
      if (this.pendingDiscovery === pending) this.pendingDiscovery = null;
    };
    void pending.then(release, release);
    return pending;
  }

  /**
   * Account Host directory projection used by the Mobile Local Agent. Relay
   * rooms and tickets are deliberately omitted from the returned candidates.
   */
  async listHostCandidates(): Promise<CloudRelayHostDirectory> {
    const { stored, generation, sessionKey } = await this.loadSession();
    const hosts = await this.fetchHosts(stored, generation, sessionKey);
    const deviceNames = await this.fetchDeviceNames(stored, generation, sessionKey);
    this.assertSessionCurrent(generation, sessionKey);
    return {
      accountId: stored.account.id,
      hosts: hosts.map(host => ({
        hostId: host.id,
        deviceId: host.deviceId,
        // Cloud Host displayName is usually the generic client name. The
        // device directory carries the user-identifiable machine label.
        name: deviceNames.get(host.deviceId) ?? host.displayName ?? null,
        availability: host.availability,
        clientVersion: host.clientVersion,
        lastAdvertisedAt: host.lastAdvertisedAt,
      })),
    };
  }

  /**
   * Resolve exactly one account-owned Host by its server-owned id. A selected
   * Host never drifts to a different device merely because it is newer.
   */
  async discoverHost(hostId: string): Promise<CloudRelayAccess> {
    const { stored, endpoint, generation, sessionKey } = await this.loadSession();
    const hosts = await this.fetchHosts(stored, generation, sessionKey);
    this.assertSessionCurrent(generation, sessionKey);
    const host = hosts.find(candidate => candidate.id === hostId);
    if (!host) {
      throw failure(
        'CLOUD_RELAY_HOST_NOT_FOUND',
        'The selected Mira Desktop Host is no longer registered for this Cloud account',
      );
    }
    if (host.availability !== 'available') {
      throw failure(
        'CLOUD_RELAY_HOST_OFFLINE',
        'The selected Mira Desktop Host is currently offline',
      );
    }
    return this.createAccess(stored, endpoint, host);
  }

  private async discoverMostRecent(): Promise<CloudRelayAccess> {
    const { stored, endpoint, generation, sessionKey } = await this.loadSession();
    const hosts = await this.fetchHosts(stored, generation, sessionKey);
    this.assertSessionCurrent(generation, sessionKey);
    const host = selectCloudRelayHost(hosts);
    if (!host) {
      throw hosts.length === 0
        ? failure(
            'CLOUD_RELAY_HOST_NOT_FOUND',
            'No Desktop Host is registered for this Mira Cloud account',
          )
        : failure(
            'CLOUD_RELAY_HOST_OFFLINE',
            'The account-owned Mira Desktop Host is currently offline',
          );
    }
    return this.createAccess(stored, endpoint, host);
  }

  private async loadSession(): Promise<{
    stored: StoredCloudSession;
    endpoint: string;
    generation: number;
    sessionKey: string;
  }> {
    const generation = this.generation;
    let stored: StoredCloudSession | null;
    try {
      stored = await this.store.load();
    } catch (error) {
      throw failure(
        'CLOUD_RELAY_SESSION_REQUIRED',
        'Mira Cloud session storage is unavailable',
        error,
      );
    }
    if (generation !== this.generation) {
      throw failure('CLOUD_RELAY_SESSION_REJECTED', 'Cloud Relay session changed during discovery');
    }
    if (!stored) {
      this.reset();
      throw failure(
        'CLOUD_RELAY_SESSION_REQUIRED',
        'Sign in to Mira Cloud before using the official Cloud Relay entry',
      );
    }
    if (Date.parse(stored.expiresAt) <= this.now().getTime()) {
      this.reset();
      throw failure(
        'CLOUD_RELAY_SESSION_REJECTED',
        'Mira Cloud sign-in has expired',
      );
    }

    let endpoint: string;
    try {
      endpoint = resolveCloudRelayBaseUrl(this.relayEndpoint);
    } catch (error) {
      throw failure(
        'CLOUD_RELAY_ENDPOINT_UNAVAILABLE',
        'No approved Mira Cloud Relay endpoint is configured',
        error,
      );
    }

    this.adoptSession(stored, endpoint);
    return {
      stored,
      endpoint,
      generation: this.generation,
      sessionKey: this.sessionKey as string,
    };
  }

  private assertSessionCurrent(
    generation: number,
    sessionKey: string,
  ): void {
    if (
      generation !== this.generation ||
      this.sessionKey !== sessionKey
    ) {
      throw failure('CLOUD_RELAY_SESSION_REJECTED', 'Cloud Relay session changed during discovery');
    }
  }

  private adoptSession(stored: StoredCloudSession, endpoint: string): void {
    const key = JSON.stringify([
      stored.account.id,
      stored.sessionToken,
      endpoint,
    ]);
    if (this.sessionKey === key) return;
    this.sessionKey = key;
    this.accessesByHost.clear();
    this.validAccesses = new WeakSet();
    closeCloudRelayConnections();
  }

  private async fetchHosts(
    stored: StoredCloudSession,
    generation: number,
    sessionKey: string,
  ): Promise<CloudDesktopHost[]> {
    let hosts: CloudDesktopHost[];
    try {
      hosts = await this.api.listHosts(stored.sessionToken);
    } catch (error) {
      throw discoveryFailure(error);
    }
    this.assertSessionCurrent(generation, sessionKey);
    return hosts;
  }

  private async fetchDeviceNames(
    stored: StoredCloudSession,
    generation: number,
    sessionKey: string,
  ): Promise<Map<string, string>> {
    if (!this.api.listDevices) return new Map();
    try {
      const devices = await this.api.listDevices(stored.sessionToken);
      this.assertSessionCurrent(generation, sessionKey);
      return new Map(
        devices
          .filter(device => device.platform === 'desktop' && device.deviceName)
          .map(device => [device.id, device.deviceName as string]),
      );
    } catch (error) {
      if (
        error instanceof RemoteHostError &&
        error.code === 'CLOUD_RELAY_SESSION_REJECTED'
      ) {
        throw error;
      }
      // A missing device-label join must not block real Host discovery.
      return new Map();
    }
  }

  private createAccess(
    stored: StoredCloudSession,
    endpoint: string,
    host: CloudDesktopHost,
  ): CloudRelayAccess {
    const key = JSON.stringify([
      stored.account.id,
      stored.sessionToken,
      host.id,
      host.relayRoom,
      endpoint,
    ]);
    const cached = this.accessesByHost.get(host.id);
    if (cached?.key === key) return cached.access;

    const context: CloudRelaySessionContext = {
      accountId: stored.account.id,
      sessionToken: stored.sessionToken,
      room: host.relayRoom,
    };
    let access: CloudRelayAccess | null = null;
    access = {
      accountId: stored.account.id,
      target: {
        endpoint,
        room: host.relayRoom,
        hostId: host.id,
      },
      // The session token and the resulting ticket stay inside this provider;
      // callers only receive the public transport target.
      tickets: new ApiCloudRelayTicketSource(
        this.api,
        context,
        () => access !== null && this.validAccesses.has(access),
      ),
    };
    this.validAccesses.add(access);
    this.accessesByHost.set(host.id, { key, access });
    return access;
  }
}

/** Shared Mobile Cloud entry; account lifecycle invalidates this exact instance. */
export const cloudRelayEntry = new CloudRelayEntry();
