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
import com.google.firebase.messaging.RemoteMessage
import java.lang.ref.WeakReference
import java.net.HttpURLConnection
import java.net.URL

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
  fun postPushBrokerJson(url: String, body: String, promise: Promise) {
    Thread {
      var connection: HttpURLConnection? = null
      try {
        val target = URL(url)
        val local =
          target.host == "localhost" ||
            target.host == "127.0.0.1" ||
            target.host == "::1"
        if (
          target.protocol != "https" &&
          !(BuildConfig.DEBUG && target.protocol == "http" && local)
        ) {
          promise.reject(
            "PUSH_BROKER_URL_REJECTED",
            "Push Broker requires HTTPS outside local development",
          )
          return@Thread
        }

        connection = target.openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = false
        connection.requestMethod = "POST"
        connection.connectTimeout = 10_000
        connection.readTimeout = 10_000
        connection.doOutput = true
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("Content-Type", "application/json")
        connection.outputStream.use { output ->
          output.write(body.toByteArray(Charsets.UTF_8))
        }

        val status = connection.responseCode
        val stream =
          if (status >= 400) connection.errorStream else connection.inputStream
        val responseBody =
          stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
        promise.resolve(
          Arguments.createMap().apply {
            putInt("status", status)
            putString("body", responseBody)
          },
        )
      } catch (error: Exception) {
        promise.reject(
          "PUSH_BROKER_NETWORK_ERROR",
          "Unable to reach Push Broker",
          error,
        )
      } finally {
        connection?.disconnect()
      }
    }.start()
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

private object MiraRemotePushPresentationDedupe {
  private const val PREFS_NAME = "mira.remote.push.presentation.v1"
  private const val KEY_CANONICAL_IDS = "canonical_message_ids"
  private const val MAX_CANONICAL_IDS = 128

  @Synchronized
  fun recordIfNew(context: Context, canonicalMessageId: String): Boolean {
    val preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val ids = preferences
      .getString(KEY_CANONICAL_IDS, "")
      .orEmpty()
      .lineSequence()
      .filter { it.isNotBlank() }
      .toList()

    val dedupe = appendCanonicalMessageId(
      existing = ids,
      canonicalMessageId = canonicalMessageId,
      limit = MAX_CANONICAL_IDS,
    )
    if (!dedupe.isNew) return false

    preferences
      .edit()
      .putString(KEY_CANONICAL_IDS, dedupe.ids.joinToString("\n"))
      .apply()
    return true
  }
}

class MiraFirebaseMessagingService : FirebaseMessagingService() {
  override fun onRegistered(installationId: String) {
    MiraNotificationsModule.publishAndroidProviderIdentifier(installationId)
  }

  override fun onMessageReceived(message: RemoteMessage) {
    super.onMessageReceived(message)
    val envelope = MiraRemotePushContract.parse(message.data) ?: return
    MiraRemotePushPresentationDedupe.recordIfNew(this, envelope.canonicalMessageId)

    // Broker v1 sends a normal FCM notification + data envelope. Android shows
    // that notification itself in background/killed states; those deliveries
    // bypass onMessageReceived, so this foreground receipt record is never
    // consulted to suppress an OS-owned background notification. Foreground
    // messages arrive here and deliberately produce no system notification:
    // MOB-056B owns the foreground reminder.
  }
}
