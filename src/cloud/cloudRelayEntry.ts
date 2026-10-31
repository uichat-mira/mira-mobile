import {
  CloudAuthApi,
  CloudAuthRequestError,
  type CloudDesktopHost,
  type CloudRelayApiLike,
} from './cloudAuthApi';
import { resolveCloudRelayBaseUrl } from './cloudRelayConfig';
import {
  cloudSessionStore,
  type CloudSessionStore,
} from './cloudSessionStore';
import type {
  CloudRelayTicketProvider,
  CloudRelayTransportTarget,
} from '../api/cloudRelay';
import { RemoteHostError } from '../api/remoteHttp';

export interface CloudRelayTarget extends CloudRelayTransportTarget {
  hostId: string;
}

export interface CloudRelayAccess {
  target: CloudRelayTarget;
  tickets: CloudRelayTicketProvider;
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
  ) {}

  async acquireClientTicket(room: string): Promise<string> {
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
  private lastAccess: { key: string; access: CloudRelayAccess } | null = null;

  constructor(options: CloudRelayEntryOptions = {}) {
    this.store = options.sessionStore ?? cloudSessionStore;
    this.api = options.api ?? new CloudAuthApi();
    this.relayEndpoint = options.relayEndpoint ?? null;
    this.now = options.now ?? (() => new Date());
  }

  async discover(): Promise<CloudRelayAccess> {
    let stored;
    try {
      stored = await this.store.load();
    } catch (error) {
      throw failure(
        'CLOUD_RELAY_SESSION_REQUIRED',
        'Mira Cloud session storage is unavailable',
        error,
      );
    }
    if (!stored) {
      throw failure(
        'CLOUD_RELAY_SESSION_REQUIRED',
        'Sign in to Mira Cloud before using the official Cloud Relay entry',
      );
    }
    if (Date.parse(stored.expiresAt) <= this.now().getTime()) {
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

    let hosts: CloudDesktopHost[];
    try {
      hosts = await this.api.listHosts(stored.sessionToken);
    } catch (error) {
      throw discoveryFailure(error);
    }

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

    const key = JSON.stringify([stored.account.id, stored.sessionToken,
      host.id, host.relayRoom, endpoint]);
    if (this.lastAccess?.key === key) return this.lastAccess.access;
    const context: CloudRelaySessionContext = {
      accountId: stored.account.id,
      sessionToken: stored.sessionToken,
      room: host.relayRoom,
    };
    const access: CloudRelayAccess = {
      target: {
        endpoint,
        room: host.relayRoom,
        hostId: host.id,
      },
      // The session token and the resulting ticket stay inside this provider;
      // callers only receive the public transport target.
      tickets: new ApiCloudRelayTicketSource(this.api, context),
    };
    this.lastAccess = { key, access };
    return access;
  }
}
