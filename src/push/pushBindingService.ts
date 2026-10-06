import type {
  RemotePushBindingAcceptResponse,
  RemotePushBindingDescriptorResponse,
} from '../api/remoteMiraHost';
import { remoteMiraHostClient } from '../api/remoteMiraHost';
import {
  normalizePushSourceScope,
  type PushProviderPlatform,
} from './brokerContracts';
import { validatePushBindingDescriptor } from './hostBindingValidation';
import {
  pushInstallationIdentity,
  type PushInstallationIdentityService,
} from './installationIdentity';
import {
  getPushProviderRegistration,
  type PushProviderRegistration,
} from './providerToken';
import {
  PushBrokerClient,
  PushBrokerError,
  type PushBindingReceipt,
  type PushRegistrationReceipt,
} from './pushBrokerClient';
import {
  pushBindingStateStore,
  type PushBindingStateStore,
  type StoredPushBinding,
} from './pushBindingState';

interface HostPushClient {
  createPushBindingDescriptor(input: {
    installationId: string;
    sourceScope: string[];
  }): Promise<RemotePushBindingDescriptorResponse>;
  acceptPushBinding(input: {
    bindingNonce: string;
    installationId: string;
    deliveryToken: string;
    sourceScope: string[];
  }): Promise<RemotePushBindingAcceptResponse>;
}

interface BrokerClient {
  registerProviderToken(
    platform: PushProviderPlatform,
    providerToken: string,
  ): Promise<PushRegistrationReceipt>;
  refreshProviderToken(
    platform: PushProviderPlatform,
    providerToken: string,
  ): Promise<PushRegistrationReceipt>;
  approveBinding(
    descriptor: RemotePushBindingDescriptorResponse['descriptor'],
  ): Promise<PushBindingReceipt>;
  revokeBinding(hostId: string): Promise<void>;
  revokeInstallation(): Promise<void>;
}

type BrokerFactory = (baseUrl: string) => BrokerClient;

export interface PushBindingRuntimeStatus {
  binding: StoredPushBinding | null;
  lastRefreshError: string | null;
}

const sameScope = (left: string[], right: string[]) => {
  const a = normalizePushSourceScope(left);
  const b = normalizePushSourceScope(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

export class PushBindingService {
  private lastRefreshError: string | null = null;

  constructor(
    private readonly host: HostPushClient = remoteMiraHostClient,
    private readonly identity: PushInstallationIdentityService =
      pushInstallationIdentity,
    private readonly state: PushBindingStateStore = pushBindingStateStore,
    private readonly readProviderRegistration: () => Promise<PushProviderRegistration> =
      getPushProviderRegistration,
    private readonly createBroker: BrokerFactory = baseUrl =>
      new PushBrokerClient(
        baseUrl,
        pushInstallationIdentity,
        fetch,
        __DEV__,
      ),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getRuntimeStatus(): Promise<PushBindingRuntimeStatus> {
    return {
      binding: await this.state.getActiveBinding(),
      lastRefreshError: this.lastRefreshError,
    };
  }

  async enableForSourceScope(sourceScope: string[]): Promise<StoredPushBinding> {
    const requestedScope = normalizePushSourceScope(sourceScope);
    if (requestedScope.length === 0) {
      throw new Error('At least one Remote conversation is required for Push binding');
    }

    const installation = await this.identity.getOrCreate();
    const rawDescriptor = await this.host.createPushBindingDescriptor({
      installationId: installation.installationId,
      sourceScope: requestedScope,
    });
    const validated = validatePushBindingDescriptor(rawDescriptor, {
      installationId: installation.installationId,
      requestedSourceScope: requestedScope,
      now: this.now().getTime(),
    });
    await this.state.claimBindingNonce(validated.descriptor.bindingNonce);

    const provider = await this.readProviderRegistration();
    const broker = this.createBroker(validated.brokerBaseUrl);
    await this.registerOrRefresh(broker, provider);

    const authorization = await broker.approveBinding(validated.descriptor);
    if (
      authorization.installationId !== installation.installationId ||
      authorization.hostId !== validated.descriptor.hostId
    ) {
      throw new Error('Push Broker authorized a different Host or installation');
    }

    const pendingBinding: StoredPushBinding = {
      installationId: installation.installationId,
      hostId: validated.descriptor.hostId,
      brokerBaseUrl: validated.brokerBaseUrl,
      sourceScope: validated.descriptor.sourceScope,
      bindingNonce: validated.descriptor.bindingNonce,
      status: 'pending-handoff',
      updatedAt: this.now().toISOString(),
    };
    await this.state.saveBinding(pendingBinding);

    try {
      const accepted = await this.host.acceptPushBinding({
        bindingNonce: validated.descriptor.bindingNonce,
        installationId: installation.installationId,
        deliveryToken: authorization.deliveryToken,
        sourceScope: validated.descriptor.sourceScope,
      });
      if (
        accepted.installationId !== installation.installationId ||
        accepted.status !== 'active' ||
        !sameScope(accepted.sourceScope, validated.descriptor.sourceScope)
      ) {
        throw new Error('Mira Host accepted a mismatched Push binding');
      }
    } catch (error) {
      try {
        await broker.revokeBinding(validated.descriptor.hostId);
        await this.state.clearBinding();
      } catch {
        // Keep pending-handoff state so a later disconnect/retry still knows
        // which Broker authorization must be revoked.
      }
      throw error;
    }

    const activeBinding: StoredPushBinding = {
      ...pendingBinding,
      status: 'active',
      updatedAt: this.now().toISOString(),
    };
    await this.state.saveBinding(activeBinding);
    this.lastRefreshError = null;
    return activeBinding;
  }

  async refreshProviderRegistrationIfBound(
    providerRegistration?: PushProviderRegistration,
  ): Promise<'unbound' | 'refreshed' | 'failed'> {
    try {
      const binding = await this.state.getActiveBinding();
      if (!binding) {
        this.lastRefreshError = null;
        return 'unbound';
      }

      const provider =
        providerRegistration ?? (await this.readProviderRegistration());
      const broker = this.createBroker(binding.brokerBaseUrl);
      await broker.refreshProviderToken(provider.platform, provider.token);
      this.lastRefreshError = null;
      return 'refreshed';
    } catch (error) {
      this.lastRefreshError =
        error instanceof Error ? error.message : 'Push provider refresh failed';
      return 'failed';
    }
  }

  async revokeCurrentBinding(): Promise<boolean> {
    const binding = await this.state.getActiveBinding();
    if (!binding) return false;

    const broker = this.createBroker(binding.brokerBaseUrl);
    try {
      await broker.revokeBinding(binding.hostId);
    } catch (error) {
      if (
        !(
          error instanceof PushBrokerError &&
          ['binding_not_found', 'not_registered', 'installation_revoked'].includes(
            error.code,
          )
        )
      ) {
        throw error;
      }
    }
    await this.state.clearBinding();
    this.lastRefreshError = null;
    return true;
  }

  async resetInstallation(): Promise<void> {
    const binding = await this.state.getActiveBinding();
    if (binding) {
      const broker = this.createBroker(binding.brokerBaseUrl);
      await broker.revokeInstallation();
    } else {
      await this.identity.reset();
    }
    await this.state.clearAll();
    this.lastRefreshError = null;
  }

  private async registerOrRefresh(
    broker: BrokerClient,
    provider: PushProviderRegistration,
  ) {
    try {
      await broker.registerProviderToken(provider.platform, provider.token);
    } catch (error) {
      if (
        error instanceof PushBrokerError &&
        error.code === 'already_registered'
      ) {
        await broker.refreshProviderToken(provider.platform, provider.token);
        return;
      }
      throw error;
    }
  }
}

export const pushBindingService = new PushBindingService();
