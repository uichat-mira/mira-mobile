package io.tomz.mira.mobile

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import okhttp3.Call
import okhttp3.ConnectionPool
import okhttp3.CookieJar
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.ByteArrayOutputStream
import java.io.InterruptedIOException
import java.net.InetAddress
import java.net.Proxy
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.nio.charset.Charset
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException

/**
 * Bounded, public-only HTTP GET transport for the `web` tool. It exists because
 * React Native fetch cannot enforce a DNS/redirect address policy, stop a
 * decoded response at a byte budget while reading, or cancel the actual call.
 */
class MiraWebFetcherModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private class RequestControl {
    @Volatile var cancelled = false
    @Volatile var call: Call? = null
  }

  private val executor = Executors.newCachedThreadPool()
  private val concurrency = Semaphore(1)
  private val controls = ConcurrentHashMap<String, RequestControl>()
  private val baseClient: OkHttpClient = OkHttpClient.Builder()
    .followRedirects(false)
    .followSslRedirects(false)
    .retryOnConnectionFailure(false)
    .cookieJar(CookieJar.NO_COOKIES)
    .proxy(Proxy.NO_PROXY)
    .connectionPool(ConnectionPool())
    .build()

  override fun getName(): String = MODULE_NAME

  @ReactMethod
  fun fetch(options: ReadableMap, promise: Promise) {
    val requestId = options.optionalString("requestId")
    val url = options.optionalString("url")
    val maxBytes = options.optionalInt("maxBytes")
    val timeoutMs = options.optionalInt("timeoutMs")
    if (requestId == null || url == null || maxBytes == null || timeoutMs == null ||
      maxBytes <= 0 || maxBytes > HARD_MAX_BYTES ||
      timeoutMs <= 0 || timeoutMs > HARD_MAX_TIMEOUT_MS
    ) {
      promise.reject("WEB_ARGUMENTS_INVALID", "Invalid web fetch options.")
      return
    }
    if (!concurrency.tryAcquire()) {
      promise.reject("WEB_BUSY", "Another web page request is still running.")
      return
    }

    val control = RequestControl()
    controls[requestId] = control
    executor.execute {
      try {
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs.toLong())
        val result = fetchBounded(control, url, maxBytes, deadline)
        promise.resolve(result)
      } catch (error: MiraWebFetchException) {
        promise.reject(error.code, error.message ?: error.code)
      } catch (error: UnknownHostException) {
        promise.reject("WEB_DNS_FAILED", "The hostname did not resolve to a public address.")
      } catch (error: SocketTimeoutException) {
        promise.reject("WEB_TIMEOUT", "The web page did not finish within the timeout.")
      } catch (error: InterruptedIOException) {
        if (control.cancelled) {
          promise.reject("WEB_CANCELLED", "Web page read was cancelled.")
        } else {
          promise.reject("WEB_TIMEOUT", "The web page did not finish within the timeout.")
        }
      } catch (error: SSLException) {
        promise.reject("WEB_UPSTREAM_FAILED", "The page TLS connection failed.")
      } catch (error: Exception) {
        if (control.cancelled) {
          promise.reject("WEB_CANCELLED", "Web page read was cancelled.")
        } else {
          promise.reject("WEB_UPSTREAM_FAILED", "Unable to read the web page.")
        }
      } finally {
        controls.remove(requestId)
        baseClient.connectionPool.evictAll()
        concurrency.release()
      }
    }
  }

  @ReactMethod
  fun cancel(requestId: String) {
    controls[requestId]?.let { control ->
      control.cancelled = true
      control.call?.cancel()
    }
  }

  override fun invalidate() {
    controls.values.forEach { control ->
      control.cancelled = true
      control.call?.cancel()
    }
    controls.clear()
    executor.shutdownNow()
    super.invalidate()
  }

  private fun fetchBounded(
    control: RequestControl,
    url: String,
    maxBytes: Int,
    deadline: Long,
  ): WritableMap {
    var current = MiraPublicAddress.validateHttpUrl(url)
    var redirects = 0
    while (true) {
      if (control.cancelled) {
        throw MiraWebFetchException("WEB_CANCELLED", "Web page read was cancelled.")
      }
      val remainingMs = TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime())
      if (remainingMs <= 0) {
        throw MiraWebFetchException("WEB_TIMEOUT", "The web page did not finish within the timeout.")
      }
      val client = baseClient.newBuilder()
        .dns(PublicOnlyDns)
        .connectTimeout(minOf(remainingMs, CONNECT_TIMEOUT_MS.toLong()), TimeUnit.MILLISECONDS)
        .readTimeout(remainingMs, TimeUnit.MILLISECONDS)
        .writeTimeout(remainingMs, TimeUnit.MILLISECONDS)
        .callTimeout(remainingMs, TimeUnit.MILLISECONDS)
        .build()
      val request = Request.Builder()
        .url(current)
        .get()
        .header("Accept", ACCEPT)
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.7")
        .header("User-Agent", USER_AGENT)
        .header("Cache-Control", "no-cache")
        .build()
      val call = client.newCall(request)
      control.call = call
      call.execute().use { response ->
        val status = response.code
        if (status in REDIRECT_STATUSES) {
          val location = response.header("Location")
            ?: throw MiraWebFetchException(
              "WEB_UPSTREAM_FAILED",
              "The page returned a redirect without a target.",
            )
          response.close()
          if (redirects >= MAX_REDIRECTS) {
            throw MiraWebFetchException(
              "WEB_REDIRECT_LIMIT",
              "The page redirected too many times.",
            )
          }
          val next = current.resolve(location)
            ?: throw MiraWebFetchException(
              "WEB_REDIRECT_FORBIDDEN",
              "The redirect target is not a valid public HTTP(S) URL.",
            )
          current = try {
            MiraPublicAddress.validateHttpUrl(next.toString())
          } catch (error: MiraWebFetchException) {
            throw MiraWebFetchException(
              "WEB_REDIRECT_FORBIDDEN",
              "The page redirected to a non-public or unsupported address.",
            )
          }
          redirects += 1
          return@use
        }

        val contentTypeHeader = response.header("Content-Type") ?: ""
        val mime = contentTypeHeader.substringBefore(';').trim().lowercase()
        val normalizedMime = if (mime.isEmpty()) "text/plain" else mime
        if (normalizedMime !in SUPPORTED_CONTENT_TYPES) {
          throw MiraWebFetchException(
            "WEB_UNSUPPORTED_CONTENT_TYPE",
            "The page content type is not readable text: $normalizedMime",
          )
        }
        if (control.cancelled) {
          throw MiraWebFetchException("WEB_CANCELLED", "Web page read was cancelled.")
        }
        val declaredLength = response.header("Content-Length")?.toLongOrNull()
        if (declaredLength != null && declaredLength > maxBytes) {
          throw MiraWebFetchException(
            "WEB_RESPONSE_TOO_LARGE",
            "The page exceeds the download limit.",
          )
        }

        val bytes = readBounded(response, control, maxBytes)
        val charset = charsetOf(contentTypeHeader)
        val body = try {
          String(bytes, charset)
        } catch (error: Exception) {
          throw MiraWebFetchException("WEB_UPSTREAM_FAILED", "The page text could not be decoded.")
        }
        return Arguments.createMap().apply {
          putInt("status", status)
          putString("finalUrl", current.toString())
          putString("contentType", contentTypeHeader.ifEmpty { normalizedMime })
          putString("body", body)
          putBoolean("truncated", false)
          putInt("redirectCount", redirects)
        }
      }
    }
  }

  private fun readBounded(response: Response, control: RequestControl, maxBytes: Int): ByteArray {
    val source = response.body?.source()
      ?: return ByteArray(0)
    val output = ByteArrayOutputStream(minOf(maxBytes, 64 * 1024))
    val buffer = ByteArray(16 * 1024)
    var total = 0
    while (true) {
      if (control.cancelled || Thread.currentThread().isInterrupted) {
        throw MiraWebFetchException("WEB_CANCELLED", "Web page read was cancelled.")
      }
      val read = source.read(buffer)
      if (read == -1) break
      if (total + read > maxBytes) {
        throw MiraWebFetchException(
          "WEB_RESPONSE_TOO_LARGE",
          "The page exceeds the download limit.",
        )
      }
      output.write(buffer, 0, read)
      total += read
    }
    return output.toByteArray()
  }

  private fun charsetOf(contentType: String): Charset {
    val marker = Regex("charset\\s*=\\s*\"?([^;\"\\s]+)", RegexOption.IGNORE_CASE)
      .find(contentType)?.groupValues?.getOrNull(1) ?: return Charsets.UTF_8
    return try {
      Charset.forName(marker)
    } catch (error: Exception) {
      Charsets.UTF_8
    }
  }

  private fun ReadableMap.optionalString(key: String): String? =
    if (hasKey(key) && !isNull(key)) getString(key) else null

  private fun ReadableMap.optionalInt(key: String): Int? =
    if (hasKey(key) && !isNull(key)) getInt(key) else null

  private object PublicOnlyDns : Dns {
    override fun lookup(hostname: String): List<InetAddress> {
      val addresses = InetAddress.getAllByName(hostname)
      if (addresses.isEmpty() || addresses.any { !MiraPublicAddress.isPublic(it) }) {
        throw UnknownHostException("Non-public address blocked")
      }
      return addresses.toList()
    }
  }

  companion object {
    private const val MODULE_NAME = "MiraWebFetcher"
    private const val HARD_MAX_BYTES = 4 * 1024 * 1024
    private const val HARD_MAX_TIMEOUT_MS = 60_000
    private const val CONNECT_TIMEOUT_MS = 10_000
    private const val MAX_REDIRECTS = 5
    private const val USER_AGENT = "MiraMobile/0.4 web-tool"
    private const val ACCEPT =
      "text/html,application/xhtml+xml,text/plain,application/json,text/markdown," +
        "application/xml,text/xml,text/csv;q=0.9,*/*;q=0.1"
    private val REDIRECT_STATUSES = setOf(301, 302, 303, 307, 308)
    private val SUPPORTED_CONTENT_TYPES = setOf(
      "text/html",
      "application/xhtml+xml",
      "text/plain",
      "text/markdown",
      "application/json",
      "application/xml",
      "text/xml",
      "application/ld+json",
      "text/csv",
      "application/rss+xml",
      "application/atom+xml",
    )
  }
}
