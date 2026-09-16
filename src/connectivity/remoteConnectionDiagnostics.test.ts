import { RemoteHostError } from '../api/remoteHttp';
import { classifySessionLoadFailure } from './remoteConnectionDiagnostics';

const online = async () => ({
  connected: true,
  transport: 'wifi' as const,
  validated: true,
  metered: false,
  observedAt: 1,
});

const offline = async () => ({
  connected: false,
  transport: 'none' as const,
  validated: false,
  metered: false,
  observedAt: 1,
});

describe('MOB-035 remote connection diagnostics', () => {
  it('maps missing credentials to unpaired', async () => {
    const result = await classifySessionLoadFailure(
      new RemoteHostError('PAIRING_REQUIRED', 'not paired'),
      { getNetworkState: online },
    );
    expect(result.kind).toBe('unpaired');
    expect(result.primaryAction.kind).toBe('connect_device');
  });

  it('keeps 401 and 403 distinct', async () => {
    const invalid = await classifySessionLoadFailure(
      new RemoteHostError('HTTP_401', 'unauthorized', 401),
      { getNetworkState: online },
    );
    const denied = await classifySessionLoadFailure(
      new RemoteHostError('HTTP_403', 'forbidden', 403),
      { getNetworkState: online },
    );
    expect(invalid.kind).toBe('credential_invalid');
    expect(denied.kind).toBe('permission_denied');
    expect(denied.primaryAction.kind).toBe('connection_settings');
  });

  it('uses OS network truth for mobile_offline only after a transport failure', async () => {
    const transportFailure = await classifySessionLoadFailure(
      new RemoteHostError('NETWORK_ERROR', 'timeout'),
      { getNetworkState: offline },
    );
    const serviceFailure = await classifySessionLoadFailure(
      new RemoteHostError('HTTP_500', 'server error', 500),
      { getNetworkState: offline },
    );
    expect(transportFailure.kind).toBe('mobile_offline');
    expect(serviceFailure.kind).toBe('session_service_error');
  });

  it('maps authoritative Relay host-offline evidence to host_offline', async () => {
    const directCode = await classifySessionLoadFailure(
      new RemoteHostError('RELAY_HOST_OFFLINE', 'host offline'),
      { getNetworkState: online },
    );
    const preservedAttempt = await classifySessionLoadFailure(
      new RemoteHostError('NETWORK_ERROR', 'direct failed', undefined, {
        transportAttempts: [
          {
            transport: 'relay',
            code: 'RELAY_HOST_OFFLINE',
            hostResponded: false,
            authoritativeHostOffline: true,
          },
          {
            transport: 'direct',
            code: 'NETWORK_ERROR',
            hostResponded: false,
            authoritativeHostOffline: false,
          },
        ],
      }),
      { getNetworkState: online },
    );
    expect(directCode.kind).toBe('host_offline');
    expect(preservedAttempt.kind).toBe('host_offline');
  });

  it('does not let earlier Relay offline evidence override a later Host response', async () => {
    const result = await classifySessionLoadFailure(
      new RemoteHostError('HTTP_500', 'server error', 500, {
        transportAttempts: [
          {
            transport: 'relay',
            code: 'RELAY_HOST_OFFLINE',
            hostResponded: false,
            authoritativeHostOffline: true,
          },
          {
            transport: 'direct',
            code: 'HTTP_500',
            status: 500,
            hostResponded: true,
            authoritativeHostOffline: false,
          },
        ],
      }),
      { getNetworkState: online },
    );
    expect(result.kind).toBe('session_service_error');
  });

  it('does not infer Host offline from ordinary transport failure', async () => {
    const result = await classifySessionLoadFailure(
      new RemoteHostError('RELAY_NETWORK_ERROR', 'relay unavailable'),
      { getNetworkState: online },
    );
    expect(result.kind).toBe('host_unreachable');
    expect(result.title).not.toContain('离线');
  });

  it('falls back to host_unreachable when OS network truth is unavailable', async () => {
    const result = await classifySessionLoadFailure(
      new RemoteHostError('NETWORK_ERROR', 'timeout'),
      { getNetworkState: async () => null },
    );
    expect(result.kind).toBe('host_unreachable');
  });

  it('maps malformed and server responses to session_service_error', async () => {
    const malformed = await classifySessionLoadFailure(
      new RemoteHostError('INVALID_RESPONSE', 'bad payload', 200),
      { getNetworkState: online },
    );
    const server = await classifySessionLoadFailure(
      new RemoteHostError('HTTP_503', 'down', 503),
      { getNetworkState: online },
    );
    expect(malformed.kind).toBe('session_service_error');
    expect(server.kind).toBe('session_service_error');
  });
});
