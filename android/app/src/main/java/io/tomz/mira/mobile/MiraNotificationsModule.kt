package io.tomz.mira.mobile

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class MiraNotificationsModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = MODULE_NAME

  @ReactMethod
  fun getPermissionStatus(promise: Promise) {
    ensureNotificationChannel(reactApplicationContext)
    promise.resolve(
      if (notificationsEnabled(reactApplicationContext)) "granted" else "denied",
    )
  }

  @ReactMethod
  fun showTestNotification(promise: Promise) {
    val context = reactApplicationContext
    ensureNotificationChannel(context)
    if (!notificationsEnabled(context)) {
      promise.reject(
        "NOTIFICATION_PERMISSION_REQUIRED",
        "Notification permission must be enabled before sending a test notification",
      )
      return
    }

    val launchIntent = context.packageManager
      .getLaunchIntentForPackage(context.packageName)
      ?.apply {
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }
    if (launchIntent == null) {
      promise.reject("NOTIFICATION_LAUNCH_INTENT_MISSING", "Unable to create Mira launch intent")
      return
    }

    val contentIntent = PendingIntent.getActivity(
      context,
      0,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentTitle("Mira 通知测试")
      .setContentText("通知功能已正常启用。")
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setAutoCancel(true)
      .setContentIntent(contentIntent)
      .build()

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(TEST_NOTIFICATION_ID, notification)
    promise.resolve(null)
  }

  companion object {
    private const val MODULE_NAME = "MiraNotifications"
    private const val CHANNEL_ID = "mira_messages"
    private const val CHANNEL_NAME = "Mira 消息"
    private const val CHANNEL_DESCRIPTION = "Mira 的消息与状态提醒"
    private const val TEST_NOTIFICATION_ID = 57057

    fun ensureNotificationChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_ID) != null) return

      val channel = NotificationChannel(
        CHANNEL_ID,
        CHANNEL_NAME,
        NotificationManager.IMPORTANCE_DEFAULT,
      ).apply {
        description = CHANNEL_DESCRIPTION
        enableVibration(true)
        setShowBadge(true)
      }
      manager.createNotificationChannel(channel)
    }

    private fun notificationsEnabled(context: Context): Boolean {
      if (
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
          PackageManager.PERMISSION_GRANTED
      ) {
        return false
      }

      if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
        return false
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = manager.getNotificationChannel(CHANNEL_ID) ?: return false
        if (channel.importance == NotificationManager.IMPORTANCE_NONE) return false
      }
      return true
    }
  }
}
