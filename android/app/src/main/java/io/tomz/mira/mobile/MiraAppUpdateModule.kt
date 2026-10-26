package io.tomz.mira.mobile

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import java.io.File
import java.io.IOException
import java.lang.ref.WeakReference
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Downloads a Mira release APK into the app cache and stages verified bytes
 * into an Android PackageInstaller session, with explicit user approval.
 *
 * The update manifest already carries the canonical APK URL and its SHA-256, so
 * the download is verified before the installer is ever launched: a partially
 * written or tampered file is deleted instead of being offered for install.
 * `install()` re-checks the digest independently, so it does not trust that
 * `download()` produced the file.
 * The system installer receives APK bytes through its session, not a
 * FileProvider URI: vendor package installers cannot lose read-URI grants.
 */
class MiraAppUpdateModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  init { activeReactContext = WeakReference(reactContext) }

  override fun getName(): String = MODULE_NAME

  private val downloadLock = Any()
  private var downloadThread: Thread? = null
  private var activeConnection: HttpURLConnection? = null
  private val cancelled = AtomicBoolean(false)

  @ReactMethod
  fun download(url: String, sha256: String, fileName: String, promise: Promise) {
    val expectedDigest = sha256.trim().lowercase()
    if (!url.startsWith("https://")) {
      promise.reject("UPDATE_BAD_ARGUMENT", "Update URL must use HTTPS")
      return
    }
    if (!DIGEST_PATTERN.matches(expectedDigest)) {
      promise.reject("UPDATE_BAD_ARGUMENT", "Update SHA-256 must be 64 hex characters")
      return
    }
    if (!SAFE_FILE_NAME_PATTERN.matches(fileName)) {
      promise.reject("UPDATE_BAD_ARGUMENT", "Update file name is invalid")
      return
    }

    synchronized(downloadLock) {
      if (downloadThread != null) {
        promise.reject("UPDATE_ALREADY_DOWNLOADING", "Another update download is already running")
        return
      }
      cancelled.set(false)
      val target = File(updateDirectory(), fileName)
      val thread = Thread { runDownload(url, expectedDigest, target, promise) }
      downloadThread = thread
      thread.start()
    }
  }

  @ReactMethod
  fun cancelDownload(promise: Promise) {
    cancelled.set(true)
    activeConnection?.let { connection -> runCatching { connection.disconnect() } }
    // Wait for the transfer thread to unwind before resolving. Otherwise a
    // retry issued right after a cancel can reach download() while the previous
    // thread is still registered and be rejected as an already-running download.
    val thread = synchronized(downloadLock) { downloadThread }
    if (thread != null && thread != Thread.currentThread()) {
      runCatching { thread.join(CANCEL_JOIN_TIMEOUT_MS) }
    }
    promise.resolve(null)
  }

  @ReactMethod
  fun canInstallPackages(promise: Promise) {
    try {
      promise.resolve(canRequestPackageInstalls())
    } catch (error: Exception) {
      promise.reject("UPDATE_INSTALL_FAILED", error.message ?: "Unable to read install permission", error)
    }
  }

  @ReactMethod
  fun openInstallPermissionSettings(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      // Per-app install consent does not exist before Android 8, so there is no
      // settings page to open and nothing to grant.
      promise.resolve(null)
      return
    }
    try {
      val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
        data = Uri.parse("package:${reactApplicationContext.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactApplicationContext.startActivity(intent)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("UPDATE_INSTALL_FAILED", error.message ?: "Unable to open install permission settings", error)
    }
  }

  @ReactMethod
  fun install(filePath: String, sha256: String, promise: Promise) {
    val expectedDigest = sha256.trim().lowercase()
    if (!DIGEST_PATTERN.matches(expectedDigest)) {
      promise.reject("UPDATE_BAD_ARGUMENT", "Update SHA-256 must be 64 hex characters")
      return
    }
    // Hashing a release APK reads tens of megabytes, so it must not run on the
    // native modules queue that JS calls are dispatched on.
    Thread { runInstall(filePath, expectedDigest, promise) }.start()
  }

  private fun runInstall(filePath: String, expectedDigest: String, promise: Promise) {
    try {
      if (!canRequestPackageInstalls()) {
        promise.reject("UPDATE_PERMISSION_REQUIRED", "Installing unknown apps is not allowed for Mira")
        return
      }

      val file = File(filePath).canonicalFile
      if (!isInsideUpdateDirectory(file)) {
        promise.reject("UPDATE_FILE_OUTSIDE_CACHE", "Update file must come from the Mira update cache")
        return
      }
      if (!file.exists() || !file.isFile || file.length() <= 0L) {
        promise.reject("UPDATE_FILE_MISSING", "Update file is missing or empty")
        return
      }
      // Independent integrity gate: anything reachable in the update directory
      // must still match the manifest digest before the system installer sees
      // it, so a stale or partial file cannot be offered for install.
      if (sha256Of(file) != expectedDigest) {
        promise.reject("UPDATE_DIGEST_MISMATCH", "Update file failed SHA-256 verification")
        return
      }

      // PackageInstaller consumes staged APK bytes inside the OS. Do not give
      // OEM installers a private FileProvider URI: MIUI confirmed that its
      // package scanner can lose Intent URI read grants (MOB-077 T4).
      val installer = reactApplicationContext.packageManager.packageInstaller
      val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
        setAppPackageName(reactApplicationContext.packageName)
        setSize(file.length())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
        }
      }
      val sessionId = installer.createSession(params)
      var committed = false
      try {
        installer.openSession(sessionId).use { session ->
          session.openWrite("base.apk", 0, file.length()).use { output ->
            file.inputStream().use { input -> input.copyTo(output, DOWNLOAD_BUFFER_BYTES) }
            session.fsync(output)
          }
          // Android 15+ requires a mutable status IntentSender; keep its
          // destination explicit and private to this app.
          val resultIntent = Intent(reactApplicationContext, MiraUpdateInstallReceiver::class.java).apply {
            action = MiraUpdateInstallReceiver.ACTION_INSTALL_RESULT
            putExtra(MiraUpdateInstallReceiver.EXTRA_EXPECTED_SESSION_ID, sessionId)
          }
          val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
          val callback = PendingIntent.getBroadcast(reactApplicationContext, sessionId, resultIntent, flags)
          session.commit(callback.intentSender)
          committed = true
        }
      } finally {
        if (!committed) runCatching { installer.abandonSession(sessionId) }
      }
      promise.resolve(sessionId)
    } catch (error: Exception) {
      promise.reject("UPDATE_INSTALL_FAILED", error.message ?: "Unable to stage the APK with the system installer", error)
    }
  }

  private fun runDownload(
    url: String,
    expectedDigest: String,
    target: File,
    promise: Promise,
  ) {
    var connection: HttpURLConnection? = null
    try {
      val directory = target.parentFile
      if (directory != null && !directory.exists() && !directory.mkdirs()) {
        throw IOException("Unable to create the Mira update cache directory")
      }
      cleanupStaleUpdateFiles(directory)
      if (target.exists() && !target.delete()) {
        throw IOException("Unable to replace the previous update file")
      }

      connection = (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = CONNECT_TIMEOUT_MS
        readTimeout = READ_TIMEOUT_MS
        instanceFollowRedirects = true
      }
      activeConnection = connection

      val status = connection.responseCode
      if (status < 200 || status > 299) {
        promise.reject("UPDATE_DOWNLOAD_HTTP", "Update download failed with HTTP $status")
        return
      }

      val totalBytes = connection.contentLengthLong.takeIf { it > 0L }
      val digest = MessageDigest.getInstance("SHA-256")
      var receivedBytes = 0L
      var emittedBytes = 0L

      connection.inputStream.use { input ->
        target.outputStream().use { output ->
          val buffer = ByteArray(DOWNLOAD_BUFFER_BYTES)
          while (true) {
            if (cancelled.get()) throw DownloadCancelledException()
            val read = input.read(buffer)
            if (read <= 0) break
            output.write(buffer, 0, read)
            digest.update(buffer, 0, read)
            receivedBytes += read
            if (receivedBytes - emittedBytes >= PROGRESS_STEP_BYTES) {
              emittedBytes = receivedBytes
              emitProgress(target, receivedBytes, totalBytes)
            }
          }
          output.flush()
        }
      }

      if (cancelled.get()) throw DownloadCancelledException()
      emitProgress(target, receivedBytes, totalBytes)

      val actualDigest = toHex(digest.digest())
      if (actualDigest != expectedDigest) {
        target.delete()
        promise.reject("UPDATE_DIGEST_MISMATCH", "Downloaded update failed SHA-256 verification")
        return
      }

      promise.resolve(target.absolutePath)
    } catch (error: DownloadCancelledException) {
      target.delete()
      promise.reject("UPDATE_CANCELLED", "Update download was cancelled")
    } catch (error: Exception) {
      target.delete()
      promise.reject("UPDATE_DOWNLOAD_IO", error.message ?: "Update download failed", error)
    } finally {
      activeConnection = null
      runCatching { connection?.disconnect() }
      synchronized(downloadLock) { downloadThread = null }
    }
  }

  /**
   * `target` lets JS attribute a frame to the transfer it asked for, so progress
   * left over from an abandoned native thread cannot be shown for a new run.
   */
  private fun emitProgress(target: File, receivedBytes: Long, totalBytes: Long?) {
    val payload = WritableNativeMap().apply {
      putString("target", target.name)
      putDouble("receivedBytes", receivedBytes.toDouble())
      if (totalBytes == null) {
        putNull("totalBytes")
      } else {
        putDouble("totalBytes", totalBytes.toDouble())
      }
    }
    reactApplicationContext.emitDeviceEvent(PROGRESS_EVENT, payload)
  }

  private fun updateDirectory(): File = File(reactApplicationContext.cacheDir, UPDATE_DIRECTORY_NAME)

  private fun sha256Of(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(DOWNLOAD_BUFFER_BYTES)
      while (true) {
        val read = input.read(buffer)
        if (read <= 0) break
        digest.update(buffer, 0, read)
      }
    }
    return toHex(digest.digest())
  }

  private fun toHex(bytes: ByteArray): String =
    bytes.joinToString("") { byte -> "%02x".format(byte.toInt() and 0xFF) }

  private fun isInsideUpdateDirectory(file: File): Boolean {
    val root = updateDirectory().canonicalFile.path
    return file.path.startsWith("$root${File.separator}")
  }

  private fun cleanupStaleUpdateFiles(directory: File?) {
    val cutoff = System.currentTimeMillis() - UPDATE_FILE_MAX_AGE_MS
    directory?.listFiles()?.forEach { file ->
      if (file.isFile && file.lastModified() < cutoff) {
        file.delete()
      }
    }
  }

  private fun canRequestPackageInstalls(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
      reactApplicationContext.packageManager.canRequestPackageInstalls()

  private class DownloadCancelledException : Exception("Update download was cancelled")

  companion object {
    private const val MODULE_NAME = "MiraAppUpdate"
    private const val PROGRESS_EVENT = "MiraAppUpdateProgress"
    private const val INSTALL_FAILURE_EVENT = "MiraAppUpdateInstallFailure"
    @Volatile private var activeReactContext: WeakReference<ReactApplicationContext>? = null

    fun hasForegroundActivity(): Boolean =
      activeReactContext?.get()?.currentActivity?.hasWindowFocus() == true

    fun publishInstallFailure(sessionId: Int, message: String) {
      val reactContext = activeReactContext?.get() ?: return
      if (!reactContext.hasActiveReactInstance()) return
      reactContext.emitDeviceEvent(INSTALL_FAILURE_EVENT, Arguments.createMap().apply {
        putInt("sessionId", sessionId)
        putString("message", message)
      })
    }
    private const val UPDATE_DIRECTORY_NAME = "mira-update"
    private const val UPDATE_FILE_MAX_AGE_MS = 24L * 60L * 60L * 1000L
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 30_000
    private const val CANCEL_JOIN_TIMEOUT_MS = 5_000L
    private const val DOWNLOAD_BUFFER_BYTES = 64 * 1024
    private const val PROGRESS_STEP_BYTES = 256L * 1024L
    private val DIGEST_PATTERN = Regex("^[a-f0-9]{64}$")
    private val SAFE_FILE_NAME_PATTERN = Regex("^[A-Za-z0-9._-]{1,128}$")
  }
}

/**
 * Explicit, non-exported result receiver for Android PackageInstaller.Session.
 * Never declares success when merely starting an activity. The installer owns
 * the final result, including the user's approval or rejection.
 */
class MiraUpdateInstallReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION_INSTALL_RESULT) return
    val expectedId = intent.getIntExtra(EXTRA_EXPECTED_SESSION_ID, -1)
    val sessionId = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -2)
    if (expectedId < 0 || expectedId != sessionId) return

    val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
    if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
      val confirmation = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
      } else {
        @Suppress("DEPRECATION")
        intent.getParcelableExtra(Intent.EXTRA_INTENT)
      }
      if (confirmation == null) {
        reportFailure(context, sessionId, "系统未提供安装确认界面")
      } else {
        launchOrNotify(context, sessionId, confirmation)
      }
      return
    }

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.cancel(sessionId)
    if (status != PackageInstaller.STATUS_SUCCESS) {
      reportFailure(context, sessionId, installFailureText(status))
    }
  }

  // Android 10+ can disallow launching UI directly from a background
  // BroadcastReceiver. In that case, let a user-tapped notification launch
  // the system's confirmation intent instead of relying on OEM-specific BAL.
  private fun launchOrNotify(context: Context, sessionId: Int, confirmation: Intent) {
    confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (MiraAppUpdateModule.hasForegroundActivity()) {
      try {
        context.startActivity(confirmation)
        return
      } catch (_: Exception) {
        // A foreground OEM may still refuse the launch; offer user gesture.
      }
    }
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      reportFailure(context, sessionId, "请打开 Mira 并允许通知后重新发起安装")
      return
    }
    try {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        manager.createNotificationChannel(
          NotificationChannel("mira_update_install", "Mira 安装确认", NotificationManager.IMPORTANCE_HIGH),
        )
      }
      val action = PendingIntent.getActivity(
        context,
        sessionId,
        confirmation,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      val notification = NotificationCompat.Builder(context, "mira_update_install")
        .setSmallIcon(android.R.drawable.stat_sys_download_done)
        .setContentTitle("继续安装 Mira 更新")
        .setContentText("点击此通知，在系统安装器中确认更新")
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setAutoCancel(true)
        .setContentIntent(action)
        .build()
      manager.notify(sessionId, notification)
    } catch (_: Exception) {
      reportFailure(context, sessionId, "无法启动安装确认，请返回 Mira 重试")
    }
  }

  private fun reportFailure(context: Context, sessionId: Int, message: String) {
    MiraAppUpdateModule.publishInstallFailure(sessionId, message)
    Toast.makeText(context, message, Toast.LENGTH_LONG).show()
  }

  companion object {
    const val ACTION_INSTALL_RESULT = "io.tomz.mira.mobile.APP_UPDATE_INSTALL_RESULT"
    const val EXTRA_EXPECTED_SESSION_ID = "expectedSessionId"

    /** Bounded, credential-free explanations that can be unit tested. */
    internal fun installFailureText(status: Int): String = when (status) {
      PackageInstaller.STATUS_FAILURE_ABORTED -> "更新安装已取消"
      PackageInstaller.STATUS_FAILURE_BLOCKED -> "系统安全策略阻止安装更新"
      PackageInstaller.STATUS_FAILURE_CONFLICT -> "更新包与已安装应用冲突"
      PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "更新包与当前设备不兼容"
      PackageInstaller.STATUS_FAILURE_INVALID -> "更新安装包无效"
      PackageInstaller.STATUS_FAILURE_STORAGE -> "设备存储空间不足，无法安装更新"
      else -> "系统安装更新失败（状态码 ${status}）"
    }
  }
}
