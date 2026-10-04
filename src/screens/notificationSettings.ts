import {
  Linking,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';

export type NotificationPermissionStatus =
  | 'granted'
  | 'denied'
  | 'not-determined'
  | 'unavailable';

interface MiraNotificationsNativeModule {
  getPermissionStatus(): Promise<NotificationPermissionStatus>;
  requestPermission(): Promise<NotificationPermissionStatus>;
  showTestNotification(): Promise<void>;
}

const nativeNotifications =
  NativeModules.MiraNotifications as MiraNotificationsNativeModule | undefined;

const requireNativeNotifications = (): MiraNotificationsNativeModule => {
  if (!nativeNotifications) {
    throw new Error('Mira notification native module is unavailable.');
  }
  return nativeNotifications;
};

const ANDROID_APP_PACKAGE = 'io.tomz.mira.mobile';
const APP_NOTIFICATION_SETTINGS_ACTION = 'android.settings.APP_NOTIFICATION_SETTINGS';
const APP_NOTIFICATION_SETTINGS_PACKAGE_EXTRA = 'android.provider.extra.APP_PACKAGE';

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  return requireNativeNotifications().getPermissionStatus();
}

export async function requestNotificationPermission(): Promise<NotificationPermissionStatus> {
  if (Platform.OS === 'android') {
    const version = Number(Platform.Version);
    if (Number.isFinite(version) && version >= 33) {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      if (result !== PermissionsAndroid.RESULTS.GRANTED) return 'denied';
    }
    return requireNativeNotifications().getPermissionStatus();
  }

  if (Platform.OS === 'ios') {
    return requireNativeNotifications().requestPermission();
  }

  return 'unavailable';
}

export async function showTestNotification(): Promise<void> {
  await requireNativeNotifications().showTestNotification();
}

export async function openNotificationSettings(): Promise<void> {
  if (Platform.OS === 'ios') {
    await Linking.openSettings();
    return;
  }
  if (Platform.OS !== 'android') {
    throw new Error('Notification settings are only available on iOS and Android.');
  }
  await Linking.sendIntent(APP_NOTIFICATION_SETTINGS_ACTION, [
    { key: APP_NOTIFICATION_SETTINGS_PACKAGE_EXTRA, value: ANDROID_APP_PACKAGE },
  ]);
}
