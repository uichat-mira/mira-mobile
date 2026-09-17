import { Linking, Platform } from 'react-native';

// Mira 的 Android applicationId（android/app/build.gradle 唯一定义，
// 这里不复制 gradle 变量，系统 intent extra 只接受字面量包名）。
const ANDROID_APP_PACKAGE = 'io.tomz.mira.mobile';

const APP_NOTIFICATION_SETTINGS_ACTION = 'android.settings.APP_NOTIFICATION_SETTINGS';
const APP_NOTIFICATION_SETTINGS_PACKAGE_EXTRA = 'android.provider.extra.APP_PACKAGE';

// 有意不展示"当前是否允许通知"状态：iOS 未启用 Notifications 权限子规格；
// Android manifest 未声明 POST_NOTIFICATIONS，PermissionsAndroid.check 恒为
// false，读出来的"已关闭"是伪造状态。启用状态读取前需先补 manifest 声明
// 与 iOS 子规格，见 docs/task-cards/MOB-054-settings-notification-system-entry.md。
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
