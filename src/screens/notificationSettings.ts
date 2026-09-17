import { Linking, PermissionsAndroid, Platform } from 'react-native';

// Mira 的 Android applicationId（android/app/build.gradle 唯一定义，
// 这里不复制 gradle 变量，系统 intent extra 只接受字面量包名）。
const ANDROID_APP_PACKAGE = 'io.tomz.mira.mobile';

// Android 13 (API 33) 起通知才有运行时授权状态可查；更低版本系统的
// 通知默认可用，客户端读不到"当前是否允许"，不能伪造一个状态出来。
const POST_NOTIFICATIONS_MIN_API = 33;

const APP_NOTIFICATION_SETTINGS_ACTION = 'android.settings.APP_NOTIFICATION_SETTINGS';
const APP_NOTIFICATION_SETTINGS_PACKAGE_EXTRA = 'android.provider.extra.APP_PACKAGE';

export type NotificationSettingsStatus =
  | { kind: 'granted' }
  | { kind: 'denied' }
  | { kind: 'unknown' };

export async function readNotificationStatus(): Promise<NotificationSettingsStatus> {
  if (Platform.OS !== 'android') return { kind: 'unknown' };
  const version = Platform.Version;
  const apiLevel =
    typeof version === 'number' ? version : Number.parseInt(version, 10);
  if (!Number.isFinite(apiLevel) || apiLevel < POST_NOTIFICATIONS_MIN_API) {
    return { kind: 'unknown' };
  }
  try {
    const granted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return granted ? { kind: 'granted' } : { kind: 'denied' };
  } catch {
    return { kind: 'unknown' };
  }
}

export function notificationStatusSubtitle(status: NotificationSettingsStatus): string {
  switch (status.kind) {
    case 'granted':
      return '系统通知已允许';
    case 'denied':
      return '系统通知已关闭';
    default:
      return '在系统设置中管理';
  }
}

export async function openNotificationSettings(): Promise<void> {
  if (Platform.OS === 'ios') {
    await Linking.openSettings();
    return;
  }
  if (Platform.OS !== 'android') {
    throw new Error('Notification settings are only available on iOS and Android.');
  }
  // sendIntent 解析失败（无系统页面可跳，如 API < 26）时直接向上抛，
  // 由调用方弹兜底提示，不做第二层猜测避免"看起来跳转了"。
  await Linking.sendIntent(APP_NOTIFICATION_SETTINGS_ACTION, [
    { key: APP_NOTIFICATION_SETTINGS_PACKAGE_EXTRA, value: ANDROID_APP_PACKAGE },
  ]);
}
