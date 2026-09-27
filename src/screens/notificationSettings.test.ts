import { Linking, Platform } from 'react-native';

import { openNotificationSettings } from './notificationSettings';

jest.mock('react-native', () => ({
  Linking: {
    openSettings: jest.fn(),
    sendIntent: jest.fn(),
  },
  Platform: { OS: 'ios' },
}));

const platformMock = Platform as unknown as { OS: string };
const sendIntentMock = Linking.sendIntent as jest.Mock;
const openSettingsMock = Linking.openSettings as jest.Mock;

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

  it('rejects on platforms without a notification settings surface', async () => {
    platformMock.OS = 'windows';

    await expect(openNotificationSettings()).rejects.toThrow(
      'Notification settings are only available on iOS and Android.',
    );
    expect(openSettingsMock).not.toHaveBeenCalled();
    expect(sendIntentMock).not.toHaveBeenCalled();
  });
});
