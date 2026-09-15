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

      val contentUri = FileProvider.getUriForFile(
        reactApplicationContext,
        "${reactApplicationContext.packageName}.mira.share",
        sourceFile,
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
      // target here. Success means the system chooser was launched.
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

  companion object {
    private const val MODULE_NAME = "MiraImageShare"
    private const val DEFAULT_SHARE_TITLE = "分享 Mira 对话"
  }
}
