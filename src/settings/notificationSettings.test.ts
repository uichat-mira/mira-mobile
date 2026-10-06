import {
  Linking,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';

import {
  getNotificationPermissionStatus,
  openNotificationSettings,
  requestNotificationPermission,
  showTestNotification,
} from './notificationSettings';

jest.mock('react-native', () => ({
  Linking: {
    openSettings: jest.fn(),
    sendIntent: jest.fn(),
  },
  NativeModules: {
    MiraNotifications: {
      getPermissionStatus: jest.fn(),
      requestPermission: jest.fn(),
      showTestNotification: jest.fn(),
    },
  },
  PermissionsAndroid: {
    PERMISSIONS: {
      POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS',
    },
    RESULTS: {
      GRANTED: 'granted',
      DENIED: 'denied',
      NEVER_ASK_AGAIN: 'never_ask_again',
    },
    request: jest.fn(),
  },
  Platform: { OS: 'ios', Version: 18 },
}));

const platformMock = Platform as unknown as { OS: string; Version: number | string };
const sendIntentMock = Linking.sendIntent as jest.Mock;
const openSettingsMock = Linking.openSettings as jest.Mock;
const requestAndroidPermissionMock = PermissionsAndroid.request as jest.Mock;
const nativeModule = NativeModules.MiraNotifications as {
  getPermissionStatus: jest.Mock;
  requestPermission: jest.Mock;
  showTestNotification: jest.Mock;
};

describe('notification settings foundation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    platformMock.OS = 'ios';
    platformMock.Version = 18;
  });

  it('reads the native notification permission status', async () => {
    nativeModule.getPermissionStatus.mockResolvedValueOnce('granted');
    await expect(getNotificationPermissionStatus()).resolves.toBe('granted');
  });

  it('requests Android 13+ runtime permission and then re-reads real native state', async () => {
    platformMock.OS = 'android';
    platformMock.Version = 35;
    requestAndroidPermissionMock.mockResolvedValueOnce('granted');
    nativeModule.getPermissionStatus.mockResolvedValueOnce('granted');

    await expect(requestNotificationPermission()).resolves.toBe('granted');
    expect(requestAndroidPermissionMock).toHaveBeenCalledWith(
      'android.permission.POST_NOTIFICATIONS',
    );
    expect(nativeModule.getPermissionStatus).toHaveBeenCalledTimes(1);
  });

  it('returns denied when Android runtime permission is rejected', async () => {
    platformMock.OS = 'android';
    platformMock.Version = 35;
    requestAndroidPermissionMock.mockResolvedValueOnce('denied');

    await expect(requestNotificationPermission()).resolves.toBe('denied');
    expect(nativeModule.getPermissionStatus).not.toHaveBeenCalled();
  });

  it('uses Android pre-13 notification state without requesting runtime permission', async () => {
    platformMock.OS = 'android';
    platformMock.Version = 30;
    nativeModule.getPermissionStatus.mockResolvedValueOnce('granted');

    await expect(requestNotificationPermission()).resolves.toBe('granted');
    expect(requestAndroidPermissionMock).not.toHaveBeenCalled();
  });

  it('requests iOS notification permission through the native bridge', async () => {
    nativeModule.requestPermission.mockResolvedValueOnce('granted');

    await expect(requestNotificationPermission()).resolves.toBe('granted');
    expect(nativeModule.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('sends a native test notification', async () => {
    nativeModule.showTestNotification.mockResolvedValueOnce(undefined);

    await expect(showTestNotification()).resolves.toBeUndefined();
    expect(nativeModule.showTestNotification).toHaveBeenCalledTimes(1);
  });

  it('opens the app settings page on iOS', async () => {
    await openNotificationSettings();

    expect(openSettingsMock).toHaveBeenCalledTimes(1);
    expect(sendIntentMock).not.toHaveBeenCalled();
  });

  it('opens the Android app notification settings with the Mira package', async () => {
    platformMock.OS = 'android';
    sendIntentMock.mockResolvedValueOnce(undefined);

    await openNotificationSettings();

    expect(sendIntentMock).toHaveBeenCalledWith('android.settings.APP_NOTIFICATION_SETTINGS', [
      { key: 'android.provider.extra.APP_PACKAGE', value: 'io.tomz.mira.mobile' },
    ]);
    expect(openSettingsMock).not.toHaveBeenCalled();
  });

  it('rejects notification settings on unsupported platforms', async () => {
    platformMock.OS = 'windows';

    await expect(openNotificationSettings()).rejects.toThrow(
      'Notification settings are only available on iOS and Android.',
    );
  });
});
