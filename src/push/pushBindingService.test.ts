import type {
  RemotePushBindingAcceptResponse,
  RemotePushBindingDescriptorResponse,
} from '../api/remoteMiraHost';
import {
  MemoryPushInstallationSecureStore,
  PushInstallationIdentityService,
  bytesToBase64Url,
  utf8Bytes,
} from './installationIdentity';
import {
  hostBindingDescriptorSigningValue,
} from './brokerContracts';
import nacl from 'tweetnacl';
import {
  PushBrokerError,
  type PushBindingReceipt,
  type PushRegistrationReceipt,
} from './pushBrokerClient';
import {
  MemoryPushBindingStateStore,
} from './pushBindingState';
import { PushBindingService } from './pushBindingService';

const NOW = new Date('2026-10-07T00:00:00.000Z');
const HOST = nacl.sign.keyPair.fromSeed(
  Uint8Array.from({ length: nacl.sign.seedLength }, (_, index) => index + 11),
);

const createDescriptor = (
  installationId: string,
  sourceScope: string[] = ['thread-a', 'thread-b'],
): RemotePushBindingDescriptorResponse => {
  const unsigned = {
    schemaVersion: 1 as const,
    hostId: 'host-1',
    hostPublicKey: bytesToBase64Url(HOST.publicKey),
    installationId,
    sourceScope,
    bindingNonce: 'binding-1',
    bindingExpiresAt: new Date(NOW.getTime() + 4 * 60 * 1000).toISOString(),
  };
  return {
    brokerBaseUrl: 'https://push.example.test',
    descriptor: {
      ...unsigned,
      hostSignature: bytesToBase64Url(
        nacl.sign.detached(
          utf8Bytes(hostBindingDescriptorSigningValue(unsigned)),
          HOST.secretKey,
        ),
      ),
    },
  };
};

class HostFake {
  descriptor!: RemotePushBindingDescriptorResponse;
  accepted: Array<{
    bindingNonce: string;
    installationId: string;
    deliveryToken: string;
    sourceScope: string[];
  }> = [];
  failAccept = false;

  async createPushBindingDescriptor() {
    return this.descriptor;
  }

  async acceptPushBinding(input: {
    bindingNonce: string;
    installationId: string;
    deliveryToken: string;
    sourceScope: string[];
  }): Promise<RemotePushBindingAcceptResponse> {
    this.accepted.push(input);
    if (this.failAccept) throw new Error('Host handoff failed');
    return {
      installationId: input.installationId,
      sourceScope: [...input.sourceScope],
      status: 'active',
    };
  }
}

class BrokerFake {
  registrations: Array<{ mode: 'register' | 'refresh'; platform: string; token: string }> = [];
  approvals: RemotePushBindingDescriptorResponse['descriptor'][] = [];
  revokedHosts: string[] = [];
  revokeInstallationCount = 0;
  registerAlreadyExists = false;
  revokeError: Error | null = null;

  async registerProviderToken(platform: 'android' | 'ios', token: string): Promise<PushRegistrationReceipt> {
    this.registrations.push({ mode: 'register', platform, token });
    if (this.registerAlreadyExists) {
      throw new PushBrokerError('already_registered', 'already registered', 409);
    }
    return {
      installationId: 'unused',
      status: 'registered',
      registeredAt: NOW.toISOString(),
    };
  }

  async refreshProviderToken(platform: 'android' | 'ios', token: string): Promise<PushRegistrationReceipt> {
    this.registrations.push({ mode: 'refresh', platform, token });
    return {
      installationId: 'unused',
      status: 'refreshed',
      registeredAt: NOW.toISOString(),
    };
  }

  async approveBinding(
    descriptor: RemotePushBindingDescriptorResponse['descriptor'],
  ): Promise<PushBindingReceipt> {
    this.approvals.push(descriptor);
    return {
      installationId: descriptor.installationId,
      hostId: descriptor.hostId,
      status: 'authorized',
      deliveryToken: 'delivery-token-that-is-long-enough-for-host-handoff',
    };
  }

  async revokeBinding(hostId: string) {
    this.revokedHosts.push(hostId);
    if (this.revokeError) throw this.revokeError;
  }

  async revokeInstallation() {
    this.revokeInstallationCount += 1;
    if (this.revokeError) throw this.revokeError;
  }
}

const createHarness = async () => {
  const identity = new PushInstallationIdentityService(
    new MemoryPushInstallationSecureStore(),
    () => NOW,
  );
  const installation = await identity.getOrCreate();
  const host = new HostFake();
  host.descriptor = createDescriptor(installation.installationId);
  const broker = new BrokerFake();
  const state = new MemoryPushBindingStateStore();
  const service = new PushBindingService(
    host,
    identity,
    state,
    async () => ({ platform: 'android', token: 'provider-secret-target' }),
    () => broker,
    () => NOW,
  );
  return { service, identity, installation, host, broker, state };
};

describe('PushBindingService', () => {
  it('registers with Broker, verifies Host descriptor, approves, and hands only delivery capability to Host', async () => {
    const { service, installation, host, broker, state } = await createHarness();

    await service.enableForSourceScope(['thread-b', 'thread-a', 'thread-b']);

    expect(broker.registrations).toEqual([
      {
        mode: 'register',
        platform: 'android',
        token: 'provider-secret-target',
      },
    ]);
    expect(broker.approvals).toHaveLength(1);
    expect(host.accepted).toEqual([
      {
        bindingNonce: 'binding-1',
        installationId: installation.installationId,
        deliveryToken: 'delivery-token-that-is-long-enough-for-host-handoff',
        sourceScope: ['thread-a', 'thread-b'],
      },
    ]);
    expect(JSON.stringify(host.accepted)).not.toContain('provider-secret-target');
    await expect(state.getActiveBinding()).resolves.toMatchObject({
      hostId: 'host-1',
      status: 'active',
      sourceScope: ['thread-a', 'thread-b'],
    });
  });

  it('refreshes the existing installation when Broker reports already_registered', async () => {
    const { service, broker } = await createHarness();
    broker.registerAlreadyExists = true;

    await service.enableForSourceScope(['thread-a', 'thread-b']);

    expect(broker.registrations.map(item => item.mode)).toEqual([
      'register',
      'refresh',
    ]);
  });

  it('validates Broker origin before pinning or exposing the provider identifier', async () => {
    const { service, host, broker, state } = await createHarness();
    host.descriptor = {
      ...host.descriptor,
      brokerBaseUrl: 'http://attacker.example.test',
    };

    await expect(
      service.enableForSourceScope(['thread-a', 'thread-b']),
    ).rejects.toThrow('requires HTTPS');

    expect(broker.registrations).toEqual([]);
    await expect(state.getBrokerTarget()).resolves.toBeNull();
  });

  it('pins the Broker origin for an installation and rejects silent origin drift', async () => {
    const { service, host, broker, installation, state } = await createHarness();

    await service.enableForSourceScope(['thread-a', 'thread-b']);
    await service.revokeCurrentBinding();

    const next = createDescriptor(installation.installationId);
    host.descriptor = {
      ...next,
      brokerBaseUrl: 'https://attacker.example.test',
    };

    await expect(
      service.enableForSourceScope(['thread-a', 'thread-b']),
    ).rejects.toThrow('Push Broker origin changed');
    expect(broker.registrations).toHaveLength(1);
    await expect(state.getBrokerTarget()).resolves.toMatchObject({
      installationId: installation.installationId,
      brokerBaseUrl: 'https://push.example.test',
    });
  });

  it('keeps installation identity and Broker target when reset revoke fails', async () => {
    const { service, identity, installation, broker, state } = await createHarness();
    await service.enableForSourceScope(['thread-a', 'thread-b']);
    broker.revokeError = new Error('Broker unavailable');

    await expect(service.resetInstallation()).rejects.toThrow(
      'Broker unavailable',
    );

    expect((await identity.getOrCreate()).installationId).toBe(
      installation.installationId,
    );
    await expect(state.getBrokerTarget()).resolves.toMatchObject({
      installationId: installation.installationId,
      brokerBaseUrl: 'https://push.example.test',
    });
  });

  it('keeps Broker registration target after binding revoke so installation reset can revoke the old registration', async () => {
    const { service, identity, installation, broker, state } = await createHarness();

    await service.enableForSourceScope(['thread-a', 'thread-b']);
    await service.revokeCurrentBinding();

    await expect(state.getActiveBinding()).resolves.toBeNull();
    await expect(state.getBrokerTarget()).resolves.toMatchObject({
      installationId: installation.installationId,
      brokerBaseUrl: 'https://push.example.test',
    });

    await service.resetInstallation();

    expect(broker.revokeInstallationCount).toBe(1);
    await expect(state.getBrokerTarget()).resolves.toBeNull();
    expect((await identity.getOrCreate()).installationId).not.toBe(
      installation.installationId,
    );
  });

  it('rejects reused Host binding nonce before a second Broker approval', async () => {
    const { service, broker } = await createHarness();

    await service.enableForSourceScope(['thread-a', 'thread-b']);

    await expect(
      service.enableForSourceScope(['thread-a', 'thread-b']),
    ).rejects.toThrow('already been used');
    expect(broker.approvals).toHaveLength(1);
  });

  it('revokes Broker authorization if Host capability handoff fails', async () => {
    const { service, host, broker, state } = await createHarness();
    host.failAccept = true;

    await expect(
      service.enableForSourceScope(['thread-a', 'thread-b']),
    ).rejects.toThrow('Host handoff failed');

    expect(broker.revokedHosts).toEqual(['host-1']);
    await expect(state.getActiveBinding()).resolves.toBeNull();
  });

  it('keeps pending binding state when rollback revoke also fails', async () => {
    const { service, host, broker, state } = await createHarness();
    host.failAccept = true;
    broker.revokeError = new Error('Broker unavailable');

    await expect(
      service.enableForSourceScope(['thread-a', 'thread-b']),
    ).rejects.toThrow('Host handoff failed');

    await expect(state.getActiveBinding()).resolves.toMatchObject({
      hostId: 'host-1',
      status: 'pending-handoff',
    });
  });

  it('refreshes provider registration for the same stored binding without sending it to Host', async () => {
    const { service, host, broker } = await createHarness();
    await service.enableForSourceScope(['thread-a', 'thread-b']);
    host.accepted.length = 0;
    broker.registrations.length = 0;

    await expect(service.refreshProviderRegistrationIfBound()).resolves.toBe(
      'refreshed',
    );

    expect(broker.registrations).toEqual([
      {
        mode: 'refresh',
        platform: 'android',
        token: 'provider-secret-target',
      },
    ]);
    expect(host.accepted).toEqual([]);
  });

  it('revokes a stored Broker binding after paired-device authority disappears', async () => {
    const { service, broker, state } = await createHarness();
    await service.enableForSourceScope(['thread-a', 'thread-b']);

    await expect(service.reconcileWithPairedDevice(false)).resolves.toBe(
      'revoked',
    );

    expect(broker.revokedHosts).toContain('host-1');
    await expect(state.getActiveBinding()).resolves.toBeNull();
  });

  it('keeps the binding for retry when revoke reconciliation cannot reach Broker', async () => {
    const { service, broker, state } = await createHarness();
    await service.enableForSourceScope(['thread-a', 'thread-b']);
    broker.revokeError = new Error('Broker unavailable');

    await expect(service.reconcileWithPairedDevice(false)).resolves.toBe(
      'failed',
    );
    await expect(state.getActiveBinding()).resolves.toMatchObject({
      hostId: 'host-1',
      status: 'active',
    });
    await expect(service.getRuntimeStatus()).resolves.toMatchObject({
      lastRefreshError: 'Broker unavailable',
    });
  });

  it('does not clear local binding when Broker revoke fails', async () => {
    const { service, broker, state } = await createHarness();
    await service.enableForSourceScope(['thread-a', 'thread-b']);
    broker.revokeError = new Error('Broker unavailable');

    await expect(service.revokeCurrentBinding()).rejects.toThrow(
      'Broker unavailable',
    );
    await expect(state.getActiveBinding()).resolves.toMatchObject({
      hostId: 'host-1',
      status: 'active',
    });
  });
});
