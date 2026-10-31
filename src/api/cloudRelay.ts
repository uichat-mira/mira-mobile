import type { PostSseRequest, PostSseSession } from './postSse';
import { RemoteHostError, type RemoteJsonRequest } from './remoteHttp';
import {
  RelayConnection,
  type RelayAdmission,
  type RelayTransportTarget,
} from './remoteRelay';

/**
 * A Cloud Relay connection is addressed by the room Cloud Auth returned for the
 * discovered Host. It carries no Legacy pairing token and no business
 * credential.
 */
export interface CloudRelayTransportTarget {
  endpoint: string;
  room: string;
}

/**
 * Issues one short-lived Client transport ticket per new WebSocket. The source
 * must never cache a ticket across socket establishments.
 */
export interface CloudRelayTicketProvider {
  acquireClientTicket(room: string): Promise<string>;
}

const CLOUD_ADMISSION_ERROR_CODES: Record<string, string> = {
  CLOUD_TICKET_REJECTED: 'CLOUD_RELAY_TICKET_REJECTED',
  CLOUD_TICKET_REQUIRED: 'CLOUD_RELAY_TICKET_REJECTED',
  CLOUD_INVALID_HELLO: 'CLOUD_RELAY_TICKET_REJECTED',
  CLOUD_LEGACY_PROVISION_FORBIDDEN: 'CLOUD_RELAY_TICKET_REJECTED',
  CLOUD_AUTH_UNAVAILABLE: 'CLOUD_RELAY_AUTH_UNAVAILABLE',
  CLOUD_HELLO_PENDING: 'CLOUD_RELAY_HELLO_PENDING',
};

const cloudAdmission = (
  tickets: CloudRelayTicketProvider,
): RelayAdmission => ({
  createHello: async target => ({
    role: 'client',
    relayId: target.relayId,
    token: await tickets.acquireClientTicket(target.relayId),
  }),
  mapAdmissionErrorCode: code =>
    CLOUD_ADMISSION_ERROR_CODES[code] ?? `RELAY_${code}`,
});

const connections = new Map<string, RelayConnection>();

// Deliberately keyed only by public transport identity. A Client ticket is
// short-lived and must never become part of a connection cache key.
const connectionFor = (
  target: CloudRelayTransportTarget,
  tickets: CloudRelayTicketProvider,
) => {
  const key = `${target.endpoint}\n${target.room}`;
  let connection = connections.get(key);
  if (!connection) {
    const relayTarget: RelayTransportTarget = {
      endpoint: target.endpoint,
      relayId: target.room,
    };
    connection = new RelayConnection(
      relayTarget,
      cloudAdmission(tickets),
      () => {
        connections.delete(key);
      },
    );
    connections.set(key, connection);
  }
  return connection;
};

export const requestCloudRelayJson = <T>(
  target: CloudRelayTransportTarget,
  tickets: CloudRelayTicketProvider,
  request: RemoteJsonRequest<T>,
) => connectionFor(target, tickets).requestJson(request);

export const openCloudRelayPostSse = <T>(
  target: CloudRelayTransportTarget,
  tickets: CloudRelayTicketProvider,
  request: PostSseRequest<T>,
): PostSseSession<T> =>
  connectionFor(target, tickets).openSse(request);

export const closeCloudRelayConnections = () => {
  for (const connection of connections.values()) connection.close();
  connections.clear();
};

export const isCloudRelayTicketError = (error: unknown) =>
  error instanceof RemoteHostError && error.code.startsWith('CLOUD_RELAY_');

export const isCloudRelayTransportError = (error: unknown) =>
  error instanceof RemoteHostError && error.code.startsWith('RELAY_');

export const isCloudRelayHostOfflineError = (error: unknown) =>
  error instanceof RemoteHostError &&
  (error.code === 'CLOUD_RELAY_HOST_OFFLINE' ||
    error.code === 'RELAY_HOST_OFFLINE');
