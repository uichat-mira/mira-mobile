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
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.installations.FirebaseInstallations
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import java.lang.ref.WeakReference

class MiraNotificationsModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private var listenerCount = 0

  init {
    activeReactContext = WeakReference(reactContext)
  }

  override fun getName(): String = MODULE_NAME

  @ReactMethod
  fun getPermissionStatus(promise: Promise) {
    ensureNotificationChannel(reactApplicationContext)
    promise.resolve(
      if (notificationsEnabled(reactApplicationContext)) "granted" else "denied",
    )
  }

  @ReactMethod
  fun getPushProviderToken(promise: Promise) {
    try {
      ensureFirebaseApp(reactApplicationContext)
    } catch (error: Exception) {
      promise.reject(
        "PUSH_PROVIDER_NOT_CONFIGURED",
        "Firebase Cloud Messaging is not configured in this build",
        error,
      )
      return
    }

    FirebaseMessaging.getInstance().register().addOnCompleteListener { registerTask ->
      if (!registerTask.isSuccessful) {
        promise.reject(
          "PUSH_PROVIDER_REGISTRATION_FAILED",
          "Unable to register this Mira installation with Firebase Cloud Messaging",
          registerTask.exception,
        )
        return@addOnCompleteListener
      }

      FirebaseInstallations.getInstance().id.addOnCompleteListener { idTask ->
        val installationId = if (idTask.isSuccessful) idTask.result else null
        if (installationId.isNullOrBlank()) {
          promise.reject(
            "PUSH_PROVIDER_REGISTRATION_FAILED",
            "Firebase did not return an installation identifier",
            idTask.exception,
          )
          return@addOnCompleteListener
        }
        promise.resolve(providerPayload("android", installationId))
      }
    }
  }

  @ReactMethod
  fun requestPermission(promise: Promise) {
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

  @ReactMethod
  fun addListener(eventName: String) {
    if (eventName == PUSH_PROVIDER_TOKEN_CHANGED_EVENT) {
      listenerCount += 1
      activeListenerCount += 1
    }
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    if (count <= 0) return
    val removed = minOf(count, listenerCount)
    listenerCount -= removed
    activeListenerCount = maxOf(0, activeListenerCount - removed)
  }

  companion object {
    private const val MODULE_NAME = "MiraNotifications"
    private const val CHANNEL_ID = "mira_messages"
    private const val CHANNEL_NAME = "Mira 消息"
    private const val CHANNEL_DESCRIPTION = "Mira 的消息与状态提醒"
    private const val TEST_NOTIFICATION_ID = 57057
    private const val PUSH_PROVIDER_TOKEN_CHANGED_EVENT = "pushProviderTokenChanged"

    @Volatile
    private var activeReactContext: WeakReference<ReactApplicationContext>? = null

    @Volatile
    private var activeListenerCount = 0

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

    fun publishAndroidProviderIdentifier(installationId: String) {
      val context = activeReactContext?.get() ?: return
      if (activeListenerCount <= 0 || !context.hasActiveReactInstance()) return
      context
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(
          PUSH_PROVIDER_TOKEN_CHANGED_EVENT,
          providerPayload("android", installationId),
        )
    }

    private fun providerPayload(platform: String, token: String) =
      Arguments.createMap().apply {
        putString("platform", platform)
        putString("token", token)
      }

    private fun ensureFirebaseApp(context: Context): FirebaseApp {
      try {
        return FirebaseApp.getInstance()
      } catch (_: IllegalStateException) {
      }

      val applicationId = BuildConfig.MIRA_FIREBASE_APP_ID.trim()
      val apiKey = BuildConfig.MIRA_FIREBASE_API_KEY.trim()
      val projectId = BuildConfig.MIRA_FIREBASE_PROJECT_ID.trim()
      val senderId = BuildConfig.MIRA_FIREBASE_SENDER_ID.trim()
      if (
        applicationId.isEmpty() ||
        apiKey.isEmpty() ||
        projectId.isEmpty() ||
        senderId.isEmpty()
      ) {
        throw IllegalStateException("Firebase configuration is incomplete")
      }

      val options = FirebaseOptions.Builder()
        .setApplicationId(applicationId)
        .setApiKey(apiKey)
        .setProjectId(projectId)
        .setGcmSenderId(senderId)
        .build()
      return FirebaseApp.initializeApp(context, options)
        ?: throw IllegalStateException("Firebase initialization failed")
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

class MiraFirebaseMessagingService : FirebaseMessagingService() {
  override fun onRegistered(installationId: String) {
    MiraNotificationsModule.publishAndroidProviderIdentifier(installationId)
  }
}
