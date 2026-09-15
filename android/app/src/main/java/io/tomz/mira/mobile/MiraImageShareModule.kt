package io.tomz.mira.mobile

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.IOException
import java.util.UUID

class MiraImageShareModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = MODULE_NAME

  @ReactMethod
  fun shareImage(fileUri: String, title: String, promise: Promise) {
    try {
      val sourceFile = resolveShareFile(fileUri)
      if (!sourceFile.exists() || !sourceFile.isFile || sourceFile.length() <= 0L) {
        promise.reject("IMAGE_SHARE_FILE_MISSING", "Share image file is missing or empty")
        return
      }
      if (!isInsideAppCache(sourceFile)) {
        promise.reject("IMAGE_SHARE_FILE_OUTSIDE_CACHE", "Share image must come from Mira cache")
        return
      }

      val shareFile = prepareShareFile(sourceFile)
      val contentUri = FileProvider.getUriForFile(
        reactApplicationContext,
        "${reactApplicationContext.packageName}.mira.share",
        shareFile,
      )
      val sendIntent = Intent(Intent.ACTION_SEND).apply {
        type = "image/png"
        putExtra(Intent.EXTRA_STREAM, contentUri)
        clipData = ClipData.newRawUri("Mira conversation share image", contentUri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = Intent.createChooser(
        sendIntent,
        title.ifBlank { DEFAULT_SHARE_TITLE },
      )
      val activity = reactApplicationContext.currentActivity
      if (activity != null) {
        activity.startActivity(chooser)
      } else {
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactApplicationContext.startActivity(chooser)
      }
      // Android does not provide a reliable completion signal for the chosen
      // target here. Keep the copied file available after launching the chooser;
      // stale copies are cleaned on a later share attempt.
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("IMAGE_SHARE_FAILED", "Unable to open Android image share", error)
    }
  }

  private fun resolveShareFile(fileUri: String): File {
    val value = fileUri.trim()
    require(value.isNotEmpty()) { "Share image URI cannot be empty" }
    val uri = Uri.parse(value)
    return when (uri.scheme) {
      null -> File(value)
      "file" -> File(requireNotNull(uri.path) { "Share image file URI has no path" })
      else -> throw IllegalArgumentException("Unsupported share image URI scheme")
    }.canonicalFile
  }

  private fun isInsideAppCache(file: File): Boolean {
    val allowedRoots = listOfNotNull(
      reactApplicationContext.cacheDir,
      reactApplicationContext.externalCacheDir,
    )
    val path = file.canonicalPath
    return allowedRoots.any { root ->
      val rootPath = root.canonicalFile.path
      path.startsWith("$rootPath${File.separator}")
    }
  }

  private fun prepareShareFile(sourceFile: File): File {
    val shareDirectory = File(reactApplicationContext.cacheDir, SHARE_DIRECTORY_NAME)
    if (!shareDirectory.exists() && !shareDirectory.mkdirs()) {
      throw IOException("Unable to create Mira share cache directory")
    }
    cleanupStaleShareFiles(shareDirectory)

    val shareFile = File(
      shareDirectory,
      "conversation-${UUID.randomUUID()}.png",
    )
    sourceFile.copyTo(shareFile, overwrite = false)
    if (!shareFile.exists() || shareFile.length() <= 0L) {
      throw IOException("Unable to prepare Mira share image")
    }
    return shareFile
  }

  private fun cleanupStaleShareFiles(shareDirectory: File) {
    val cutoff = System.currentTimeMillis() - SHARE_FILE_MAX_AGE_MS
    shareDirectory.listFiles()?.forEach { file ->
      if (file.isFile && file.lastModified() < cutoff) {
        file.delete()
      }
    }
  }

  companion object {
    private const val MODULE_NAME = "MiraImageShare"
    private const val DEFAULT_SHARE_TITLE = "分享 Mira 对话"
    private const val SHARE_DIRECTORY_NAME = "mira-share"
    private const val SHARE_FILE_MAX_AGE_MS = 24L * 60L * 60L * 1000L
  }
}
