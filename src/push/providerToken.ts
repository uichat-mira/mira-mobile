import {
  NativeEventEmitter,
  NativeModules,
  Platform,
  type EmitterSubscription,
} from 'react-native';

export type PushProviderPlatform = 'android' | 'ios';

export interface PushProviderRegistration {
  platform: PushProviderPlatform;
  /**
   * Provider targeting identifier. Android uses the current Firebase Installation
   * ID (FID); iOS uses the APNs device token. The Broker contract retains the
   * historical providerToken field name while FCM migrates from tokens to FIDs.
   */
  token: string;
}

interface MiraNotificationsPushModule {
  getPushProviderToken(): Promise<unknown>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const EVENT_NAME = 'pushProviderTokenChanged';

const requireNativeModule = (): MiraNotificationsPushModule => {
  const module = NativeModules.MiraNotifications as
    | MiraNotificationsPushModule
    | undefined;
  if (
    !module ||
    typeof module.getPushProviderToken !== 'function' ||
    typeof module.addListener !== 'function' ||
    typeof module.removeListeners !== 'function'
  ) {
    throw new Error('Mira Push provider native bridge is unavailable');
  }
  return module;
};

export const parsePushProviderRegistration = (
  value: unknown,
): PushProviderRegistration => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Push provider registration is invalid');
  }
  const record = value as Record<string, unknown>;
  if (
    (record.platform !== 'android' && record.platform !== 'ios') ||
    typeof record.token !== 'string' ||
    !record.token.trim()
  ) {
    throw new Error('Push provider registration is incomplete');
  }
  return {
    platform: record.platform,
    token: record.token.trim(),
  };
};

export async function getPushProviderRegistration(): Promise<PushProviderRegistration> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('Push provider registration is only available on iOS and Android');
  }
  const registration = parsePushProviderRegistration(
    await requireNativeModule().getPushProviderToken(),
  );
  if (registration.platform !== Platform.OS) {
    throw new Error('Push provider registration platform mismatch');
  }
  return registration;
}

export function subscribePushProviderRegistration(
  listener: (registration: PushProviderRegistration) => void,
): EmitterSubscription {
  const module = requireNativeModule();
  const emitter = new NativeEventEmitter(
    module as unknown as typeof NativeModules.MiraNotifications,
  );
  return emitter.addListener(EVENT_NAME, value => {
    const registration = parsePushProviderRegistration(value);
    if (registration.platform === Platform.OS) {
      listener(registration);
    }
  });
}
