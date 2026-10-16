package io.tomz.mira.mobile

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Downloads a Mira release APK into the app cache and hands it to the system
 * installer.
 *
 * The update manifest already carries the canonical APK URL and its SHA-256, so
 * the download is verified before the installer is ever launched: a partially
 * written or tampered file is deleted instead of being offered for install.
 * `install()` re-checks the digest independently, so it does not trust that
 * `download()` produced the file.
 * Files stay inside `cacheDir/mira-update` and leave through a dedicated
 * FileProvider authority so the install grant cannot expose anything else.
 */
class MiraAppUpdateModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

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

      val contentUri = FileProvider.getUriForFile(
        reactApplicationContext,
        "${reactApplicationContext.packageName}.mira.update",
        file,
      )
      val installIntent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(contentUri, APK_MIME_TYPE)
        clipData = ClipData.newRawUri("Mira update package", contentUri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactApplicationContext.startActivity(installIntent)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("UPDATE_INSTALL_FAILED", error.message ?: "Unable to launch the system installer", error)
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
    private const val UPDATE_DIRECTORY_NAME = "mira-update"
    private const val APK_MIME_TYPE = "application/vnd.android.package-archive"
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
