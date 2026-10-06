import {
  NativeModules,
  Platform,
} from 'react-native';

import {
  getPushProviderRegistration,
  parsePushProviderRegistration,
  subscribePushProviderRegistration,
} from './providerToken';

const mockEventAddListener = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: {
    MiraNotifications: {
      getPushProviderToken: jest.fn(),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    },
  },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: mockEventAddListener,
  })),
  Platform: { OS: 'android' },
}));

const nativeModule = NativeModules.MiraNotifications as {
  getPushProviderToken: jest.Mock;
};

describe('Push provider registration bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as unknown as { OS: string }).OS = 'android';
  });

  it('reads the current Android FCM installation id without persisting it in JS', async () => {
    nativeModule.getPushProviderToken.mockResolvedValueOnce({
      platform: 'android',
      token: 'firebase-installation-id',
    });

    await expect(getPushProviderRegistration()).resolves.toEqual({
      platform: 'android',
      token: 'firebase-installation-id',
    });
  });

  it('rejects native platform mismatch', async () => {
    nativeModule.getPushProviderToken.mockResolvedValueOnce({
      platform: 'ios',
      token: 'apns-token',
    });

    await expect(getPushProviderRegistration()).rejects.toThrow(
      'platform mismatch',
    );
  });

  it('forwards provider rotation events for the active platform', () => {
    let captured: ((value: unknown) => void) | null = null;
    const remove = jest.fn();
    mockEventAddListener.mockImplementationOnce(
      (_eventName: string, listener: (value: unknown) => void) => {
        captured = listener;
        return { remove };
      },
    );
    const seen: unknown[] = [];
    const subscription = subscribePushProviderRegistration(value => seen.push(value));

    const emit = captured as unknown as (value: unknown) => void;
    emit({ platform: 'android', token: 'rotated-fid' });
    emit({ platform: 'ios', token: 'wrong-platform' });

    expect(seen).toEqual([{ platform: 'android', token: 'rotated-fid' }]);
    subscription.remove();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed provider registrations', () => {
    expect(() => parsePushProviderRegistration({ platform: 'android' })).toThrow(
      'incomplete',
    );
    expect(() =>
      parsePushProviderRegistration({ platform: 'android', token: '   ' }),
    ).toThrow('incomplete');
  });
});
