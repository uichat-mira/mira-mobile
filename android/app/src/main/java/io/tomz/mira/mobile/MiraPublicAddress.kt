package io.tomz.mira.mobile

import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Global-unicast-only address policy for the Mobile web tool. Hostname
 * connections resolve through this classifier, so every address actually used
 * by OkHttp has to be public; literal addresses are checked before connecting.
 */
internal object MiraPublicAddress {

  fun isPublic(address: InetAddress): Boolean {
    val bytes = address.address
    return when (address) {
      is Inet4Address -> isPublicIpv4(bytes)
      is Inet6Address -> isPublicIpv6(bytes)
      else -> false
    }
  }

  fun isPublicIpv4(bytes: ByteArray): Boolean {
    if (bytes.size != 4) return false
    val a = bytes[0].toInt() and 0xff
    val b = bytes[1].toInt() and 0xff
    val c = bytes[2].toInt() and 0xff
    if (a == 0 || a == 10 || a == 127) return false
    if (a == 100 && b in 64..127) return false
    if (a == 169 && b == 254) return false
    if (a == 172 && b in 16..31) return false
    if (a == 192 && b == 0 && (c == 0 || c == 2)) return false
    if (a == 192 && b == 88 && c == 99) return false
    if (a == 192 && b == 168) return false
    if (a == 198 && (b == 18 || b == 19)) return false
    if (a == 198 && b == 51 && c == 100) return false
    if (a == 203 && b == 0 && c == 113) return false
    return a < 224
  }

  fun isPublicIpv6(bytes: ByteArray): Boolean {
    if (bytes.size != 16) return false
    val first = bytes[0].toInt() and 0xff
    val second = bytes[1].toInt() and 0xff
    if ((first and 0xe0) != 0x20) return false
    if (first == 0x20 && second == 0x01) {
      val third = (bytes[2].toInt() and 0xff shl 8) or (bytes[3].toInt() and 0xff)
      if (third <= 0x01ff) return false
      if (third == 0x0db8) return false
      if (third == 0x0002) return false
      if (third == 0x0020) return false
    }
    if (first == 0x20 && second == 0x02) return false
    if (first == 0x3f && second == 0xff &&
      (bytes[2].toInt() and 0xf0) == 0
    ) {
      return false
    }
    return true
  }

  /** Null means "not an address literal", so DNS still has to classify it. */
  fun literal(hostname: String): InetAddress? {
    val host = hostname.removePrefix("[").removeSuffix("]")
    val ipv4 = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$").matches(host)
    if (ipv4) {
      val octets = host.split('.').map { it.toInt() }
      if (octets.any { it > 255 }) {
        throw MiraWebFetchException("WEB_URL_FORBIDDEN", "The URL hostname is invalid.")
      }
      return InetAddress.getByAddress(octets.map { it.toByte() }.toByteArray())
    }
    if (host.contains(':')) {
      // Java parses colon strings as numeric IPv6 and does not fall back to DNS.
      return InetAddress.getByName(host)
    }
    return null
  }

  fun isLocalHostname(hostname: String): Boolean {
    val host = hostname.lowercase().removeSuffix(".")
    if (host == "localhost") return true
    return listOf(
      ".localhost", ".local", ".localdomain", ".internal",
      ".intranet", ".lan", ".home", ".corp",
    ).any { host.endsWith(it) }
  }

  fun isUnqualifiedHostname(hostname: String): Boolean {
    val bare = hostname.lowercase().removeSuffix(".")
    return !bare.contains('.') && !bare.contains(':')
  }

  /**
   * Shared preflight used before OkHttp resolves or connects. Validation uses
   * OkHttp's own URL parser so the checked host is the host actually requested.
   */
  fun validateHttpUrl(value: String): HttpUrl {
    val httpUrl = value.toHttpUrlOrNull()
      ?: throw MiraWebFetchException("WEB_URL_FORBIDDEN", "The URL is not valid.")
    if (httpUrl.scheme != "http" && httpUrl.scheme != "https") {
      throw MiraWebFetchException("WEB_URL_FORBIDDEN", "Only public HTTP(S) URLs are supported.")
    }
    if (httpUrl.username.isNotEmpty() || httpUrl.password.isNotEmpty()) {
      throw MiraWebFetchException("WEB_URL_FORBIDDEN", "URL credentials are not allowed.")
    }
    val host = httpUrl.host.removePrefix("[").removeSuffix("]")
    if (host.isBlank() || host.length > 253) {
      throw MiraWebFetchException("WEB_URL_FORBIDDEN", "The URL hostname is invalid.")
    }
    val literal = try {
      literal(host)
    } catch (error: Exception) {
      throw MiraWebFetchException("WEB_URL_FORBIDDEN", "The URL hostname is invalid.")
    }
    if (literal != null) {
      if (!isPublic(literal)) {
        throw MiraWebFetchException(
          "WEB_URL_FORBIDDEN",
          "The address is not on the public internet.",
        )
      }
    } else {
      if (isLocalHostname(host)) {
        throw MiraWebFetchException("WEB_URL_FORBIDDEN", "Local hostnames are not allowed.")
      }
      if (isUnqualifiedHostname(host)) {
        throw MiraWebFetchException(
          "WEB_URL_FORBIDDEN",
          "Only fully-qualified public hostnames are allowed.",
        )
      }
    }
    return httpUrl
  }
}

internal class MiraWebFetchException(
  val code: String,
  message: String,
) : Exception(message)
