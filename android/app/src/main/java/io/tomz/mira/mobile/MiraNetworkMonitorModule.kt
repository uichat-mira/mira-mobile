package io.tomz.mira.mobile

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlin.math.max
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.Call
import okhttp3.Callback
import okhttp3.ConnectionPool
import okhttp3.CookieJar
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.cert.CertificateException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException

class MiraNetworkMonitorModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

  private val connectivityManager = reactContext.getSystemService(
    Context.CONNECTIVITY_SERVICE,
  ) as ConnectivityManager

  private var listenerCount = 0
  private var callbackRegistered = false
  private var lastSignature: String? = null

  private val networkCallback = object : ConnectivityManager.NetworkCallback() {
    override fun onAvailable(network: Network) {
      emitCurrentState()
    }

    override fun onLost(network: Network) {
      emitCurrentState()
    }

    override fun onCapabilitiesChanged(
      network: Network,
      networkCapabilities: NetworkCapabilities,
    ) {
      emitCurrentState()
    }
  }

  init {
    reactContext.addLifecycleEventListener(this)
  }

  override fun getName(): String = MODULE_NAME

  @ReactMethod
  fun addListener(eventName: String) {
    listenerCount += 1
    ensureRegistered()
    if (eventName == EVENT_NAME) {
      emitCurrentState(force = true)
    }
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    listenerCount = max(0, listenerCount - count)
    if (listenerCount == 0) {
      unregisterCallback()
    }
  }

  @ReactMethod
  fun getCurrentState(promise: Promise) {
    try {
      promise.resolve(buildCurrentState())
    } catch (error: Exception) {
      promise.reject(
        "NETWORK_STATE_READ_FAILED",
        "Unable to read the current Android network state",
        error,
      )
    }
  }

  /**
   * Dev OAuth failure only: fresh OkHttp HTTPS GET to a fixed /health URL.
   * No OAuth parameters, cookies, credentials, redirects or raw error strings.
   * Reuses React Native's OkHttp configuration without changing its client.
   */
  @ReactMethod
  fun diagnoseCloudAuthTls(promise: Promise) {
    try {
      val client = OkHttpClientProvider.getOkHttpClient().newBuilder()
        .cookieJar(CookieJar.NO_COOKIES)
        .connectionPool(ConnectionPool())
        .followRedirects(false)
        .followSslRedirects(false)
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(3, TimeUnit.SECONDS)
        .callTimeout(4, TimeUnit.SECONDS)
        .build()
      val request = Request.Builder()
        .url("https://cloud-auth.tomzlab.cn/health")
        .get()
        .header("Cache-Control", "no-store")
        .build()
      client.newCall(request).enqueue(object : Callback {
        override fun onFailure(call: Call, error: IOException) {
          promise.resolve(nativeTransportResult("NETWORK", error, null))
        }

        override fun onResponse(call: Call, response: Response) {
          response.use {
            promise.resolve(nativeTransportResult("HTTP", null, it.code))
          }
        }
      })
    } catch (_: Exception) {
      promise.resolve(nativeTransportResult("PROBE_FAILED", null, null))
    }
  }

  private fun nativeTransportResult(
    outcome: String,
    error: Throwable?,
    httpStatus: Int?,
  ): WritableMap = Arguments.createMap().apply {
    putString("outcome", outcome)
    if (httpStatus != null) putInt("httpStatus", httpStatus)
    if (error != null) {
      val chain = generateSequence(error) { it.cause }.take(3).toList()
      putString("exceptionChain", chain.joinToString(">") { it.javaClass.simpleName })
      val symptoms = chain.mapNotNull { it.message?.lowercase() }.joinToString(" ")
      val reason = when {
        chain.any { it is SSLPeerUnverifiedException || it is CertificateException } ||
          symptoms.contains("trust anchor") || symptoms.contains("certification path") ||
          symptoms.contains("certificate verify failed") ||
          symptoms.contains("hostname not verified") -> "CERTIFICATE_REJECTED"
        chain.any { it is UnknownHostException } -> "DNS_FAILURE"
        symptoms.contains("connection reset") || symptoms.contains("reset by peer") -> "CONNECTION_RESET"
        symptoms.contains("network is unreachable") -> "NETWORK_UNREACHABLE"
        symptoms.contains("connection refused") -> "CONNECTION_REFUSED"
        chain.any { it is SocketTimeoutException } || symptoms.contains("timed out") -> "TIMEOUT"
        chain.any { it is SSLHandshakeException } -> "TLS_HANDSHAKE"
        chain.any { it is ConnectException } -> "CONNECT_FAILED"
        symptoms.contains("unexpected end of stream") -> "EARLY_EOF"
        else -> "UNCLASSIFIED"
      }
      putString("reason", reason)
    }
  }

  override fun onHostResume() {
    if (listenerCount > 0) {
      ensureRegistered()
      emitCurrentState(force = true)
    }
  }

  override fun onHostPause() = Unit

  override fun onHostDestroy() {
    unregisterCallback()
    reactContext.removeLifecycleEventListener(this)
  }

  private fun ensureRegistered() {
    if (callbackRegistered) return
    connectivityManager.registerDefaultNetworkCallback(networkCallback)
    callbackRegistered = true
  }

  private fun unregisterCallback() {
    if (!callbackRegistered) return
    try {
      connectivityManager.unregisterNetworkCallback(networkCallback)
    } catch (_: IllegalArgumentException) {
      // Callback may already be detached while the application is shutting down.
    }
    callbackRegistered = false
    lastSignature = null
  }

  private fun emitCurrentState(force: Boolean = false) {
    if (!reactContext.hasActiveReactInstance()) return

    val state = buildCurrentState()
    val signature = listOf(
      state.getBoolean("connected").toString(),
      state.getString("transport") ?: "none",
      state.getBoolean("validated").toString(),
      state.getBoolean("metered").toString(),
    ).joinToString(":")

    if (!force && signature == lastSignature) return
    lastSignature = signature

    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_NAME, state)
  }

  private fun buildCurrentState(): WritableMap {
    val network = connectivityManager.activeNetwork
    val capabilities = network?.let(connectivityManager::getNetworkCapabilities)
    val connected = capabilities?.hasCapability(
      NetworkCapabilities.NET_CAPABILITY_INTERNET,
    ) == true

    val transport = when {
      capabilities == null -> "none"
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
      else -> "other"
    }

    return Arguments.createMap().apply {
      putBoolean("connected", connected)
      putString("transport", transport)
      putBoolean(
        "validated",
        capabilities?.hasCapability(
          NetworkCapabilities.NET_CAPABILITY_VALIDATED,
        ) == true,
      )
      putBoolean("metered", connectivityManager.isActiveNetworkMetered)
      putDouble("observedAt", System.currentTimeMillis().toDouble())
    }
  }

  companion object {
    private const val MODULE_NAME = "MiraNetworkMonitor"
    private const val EVENT_NAME = "MiraNetworkChanged"
  }
}
