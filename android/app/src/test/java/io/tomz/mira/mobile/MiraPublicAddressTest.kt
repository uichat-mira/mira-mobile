package io.tomz.mira.mobile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MiraPublicAddressTest {

  private fun ipv4(value: String): ByteArray =
    value.split('.').map { it.toInt().toByte() }.toByteArray()

  @Test
  fun acceptsGlobalIpv4AndRejectsSpecialRanges() {
    assertTrue(MiraPublicAddress.isPublicIpv4(ipv4("8.8.8.8")))
    assertTrue(MiraPublicAddress.isPublicIpv4(ipv4("1.1.1.1")))
    assertFalse(MiraPublicAddress.isPublicIpv4(ipv4("127.0.0.1")))
    assertFalse(MiraPublicAddress.isPublicIpv4(ipv4("10.0.0.1")))
    assertFalse(MiraPublicAddress.isPublicIpv4(ipv4("172.16.0.1")))
    assertFalse(MiraPublicAddress.isPublicIpv4(ipv4("192.168.1.1")))
    assertFalse(MiraPublicAddress.isPublicIpv4(ipv4("169.254.169.254")))
    assertFalse(MiraPublicAddress.isPublicIpv4(ipv4("100.64.0.1")))
    assertFalse(MiraPublicAddress.isPublicIpv4(ipv4("198.18.0.1")))
    assertFalse(MiraPublicAddress.isPublicIpv4(ipv4("203.0.113.9")))
    assertFalse(MiraPublicAddress.isPublicIpv4(ipv4("224.0.0.1")))
    assertFalse(MiraPublicAddress.isPublicIpv4(ipv4("0.0.0.0")))
  }

  @Test
  fun acceptsGlobalIpv6AndRejectsSpecialRanges() {
    assertTrue(MiraPublicAddress.isPublicIpv6(
      byteArrayOf(
        0x26, 0x06, 0x47, 0x00, 0x47, 0x00, 0, 0,
        0, 0, 0, 0, 0, 0, 0x11, 0x11,
      ),
    ))
    assertFalse(MiraPublicAddress.isPublicIpv6(
      byteArrayOf(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1),
    ))
    assertFalse(MiraPublicAddress.isPublicIpv6(
      byteArrayOf(0xfc.toByte(), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1),
    ))
    assertFalse(MiraPublicAddress.isPublicIpv6(
      byteArrayOf(0xfe.toByte(), 0x80.toByte(), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1),
    ))
    assertFalse(MiraPublicAddress.isPublicIpv6(
      byteArrayOf(
        0x20, 0x01, 0x0d, 0xb8.toByte(), 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 1,
      ),
    ))
    assertFalse(MiraPublicAddress.isPublicIpv6(
      byteArrayOf(0x20, 0x02, 0x7f, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1),
    ))
  }

  @Test
  fun rejectsCredentialedAndNonHttpUrls() {
    val failures = mutableListOf<String>()
    listOf(
      "file:///etc/passwd",
      "ftp://example.com/",
      "https://user:pass@example.com/",
      "http://127.0.0.1/",
      "http://999.1.1.1/",
      "http://10.0.0.1/",
      "http://localhost/",
      "http://intranet/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[fd00::1]/",
    ).forEach { value ->
      try {
        MiraPublicAddress.validateHttpUrl(value)
        failures += value
      } catch (_: MiraWebFetchException) {
        // expected
      }
    }
    assertTrue(failures.isEmpty())
  }

  @Test
  fun acceptsPublicHttpUrls() {
    assertNotNull(MiraPublicAddress.validateHttpUrl("https://example.com/a"))
    assertNotNull(MiraPublicAddress.validateHttpUrl("http://8.8.8.8/"))
    assertNull(MiraPublicAddress.literal("example.com"))
  }
}
