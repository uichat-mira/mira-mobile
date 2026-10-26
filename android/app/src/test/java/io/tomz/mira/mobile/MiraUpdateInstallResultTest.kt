package io.tomz.mira.mobile

import android.app.NotificationManager
import android.content.pm.PackageInstaller
import org.junit.Assert.assertEquals
import org.junit.Test

class MiraUpdateInstallResultTest {
  @Test
  fun disabledAppOrChannelNotificationsCannotSilentlyStallInstallation() {
    val canShow: (Boolean, Int?) -> Boolean = { enabled, importance ->
      MiraUpdateInstallReceiver.canPresentConfirmationNotification(enabled, importance)
    }
    assertEquals(false, canShow(false, null))
    assertEquals(false, canShow(false, NotificationManager.IMPORTANCE_HIGH))
    assertEquals(false, canShow(true, NotificationManager.IMPORTANCE_NONE))
    assertEquals(true, canShow(true, NotificationManager.IMPORTANCE_HIGH))
    assertEquals(true, canShow(true, null)) // Android pre-O has no channels.
  }

  @Test
  fun classifiesSystemInstallFailuresWithoutClaimingSuccess() {
    val message: (Int) -> String = { status -> MiraUpdateInstallReceiver.installFailureText(status) }
    assertEquals("更新安装已取消", message(PackageInstaller.STATUS_FAILURE_ABORTED))
    assertEquals("系统安全策略阻止安装更新", message(PackageInstaller.STATUS_FAILURE_BLOCKED))
    assertEquals("更新包与已安装应用冲突", message(PackageInstaller.STATUS_FAILURE_CONFLICT))
    assertEquals("更新包与当前设备不兼容", message(PackageInstaller.STATUS_FAILURE_INCOMPATIBLE))
    assertEquals("更新安装包无效", message(PackageInstaller.STATUS_FAILURE_INVALID))
    assertEquals("设备存储空间不足，无法安装更新", message(PackageInstaller.STATUS_FAILURE_STORAGE))
    assertEquals("系统安装更新失败（状态码 123）", message(123))
  }
}
