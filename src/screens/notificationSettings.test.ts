import { Linking, PermissionsAndroid, Platform } from 'react-native';

import {
  notificationStatusSubtitle,
  openNotificationSettings,
  readNotificationStatus,
} from './notificationSettings';

jest.mock('react-native', () => ({
  Linking: {
    openSettings: jest.fn(),
    sendIntent: jest.fn(),
  },
  PermissionsAndroid: {
    PERMISSIONS: { POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS' },
    check: jest.fn(),
  },
  Platform: { OS: 'ios', Version: '18.6' },
}));

const platformMock = Platform as unknown as { OS: string; Version: number | string };
const checkMock = PermissionsAndroid.check as jest.Mock;
const sendIntentMock = Linking.sendIntent as jest.Mock;
const openSettingsMock = Linking.openSettings as jest.Mock;

describe('readNotificationStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    platformMock.OS = 'ios';
    platformMock.Version = '18.6';
  });

  it('reports unknown on iOS because no cross-platform status source is wired', async () => {
    await expect(readNotificationStatus()).resolves.toEqual({ kind: 'unknown' });
    expect(checkMock).not.toHaveBeenCalled();
  });

  it('reports granted when Android 13+ grants POST_NOTIFICATIONS', async () => {
    platformMock.OS = 'android';
    platformMock.Version = 34;
    checkMock.mockResolvedValueOnce(true);

    await expect(readNotificationStatus()).resolves.toEqual({ kind: 'granted' });
    expect(checkMock).toHaveBeenCalledWith('android.permission.POST_NOTIFICATIONS');
  });

  it('reports denied when Android 13+ denies POST_NOTIFICATIONS', async () => {
    platformMock.OS = 'android';
    platformMock.Version = 33;
    checkMock.mockResolvedValueOnce(false);

    await expect(readNotificationStatus()).resolves.toEqual({ kind: 'denied' });
  });

  it('reports unknown below Android 13 because notifications need no runtime grant there', async () => {
    platformMock.OS = 'android';
    platformMock.Version = 32;

    await expect(readNotificationStatus()).resolves.toEqual({ kind: 'unknown' });
    expect(checkMock).not.toHaveBeenCalled();
  });

  it('falls back to unknown when the native check fails', async () => {
    platformMock.OS = 'android';
    platformMock.Version = 34;
    checkMock.mockRejectedValueOnce(new Error('boom'));

    await expect(readNotificationStatus()).resolves.toEqual({ kind: 'unknown' });
  });
});

describe('notificationStatusSubtitle', () => {
  it('maps known statuses to user-readable subtitles', () => {
    expect(notificationStatusSubtitle({ kind: 'granted' })).toBe('系统通知已允许');
    expect(notificationStatusSubtitle({ kind: 'denied' })).toBe('系统通知已关闭');
  });

  it('uses a neutral hint when the status is unknown', () => {
    expect(notificationStatusSubtitle({ kind: 'unknown' })).toBe('在系统设置中管理');
  });
});

describe('openNotificationSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    platformMock.OS = 'ios';
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

  it('propagates sendIntent failures so the caller can show the fallback alert', async () => {
    platformMock.OS = 'android';
    sendIntentMock.mockRejectedValueOnce(new Error('no activity'));

    await expect(openNotificationSettings()).rejects.toThrow('no activity');
  });
});
