package io.tomz.mira.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MiraRemotePushContractTest {
  private fun validPayload() = mapOf(
    "schemaVersion" to "1",
    "eventType" to "assistant-message",
    "installationId" to "installation-1",
    "eventId" to "event-1",
    "sourceId" to "thread:alpha",
    "canonicalMessageId" to "message-1",
    "eligibilityEvent" to "final_transition_first_seen",
  )

  @Test
  fun parsesFrozenAssistantMessageIdentity() {
    val parsed = MiraRemotePushContract.parse(validPayload())

    assertEquals("event-1", parsed?.eventId)
    assertEquals("thread:alpha", parsed?.sourceId)
    assertEquals("message-1", parsed?.canonicalMessageId)
  }

  @Test
  fun rejectsWrongSchemaEventOrEligibility() {
    assertNull(
      MiraRemotePushContract.parse(validPayload() + ("schemaVersion" to "2")),
    )
    assertNull(
      MiraRemotePushContract.parse(validPayload() + ("eventType" to "run-completed")),
    )
    assertNull(
      MiraRemotePushContract.parse(validPayload() + ("eligibilityEvent" to "refresh")),
    )
  }

  @Test
  fun rejectsMissingOrMalformedCanonicalIdentity() {
    assertNull(MiraRemotePushContract.parse(validPayload() - "canonicalMessageId"))
    assertNull(
      MiraRemotePushContract.parse(
        validPayload() + ("canonicalMessageId" to "message\nspoof"),
      ),
    )
    assertNull(
      MiraRemotePushContract.parse(validPayload() + ("sourceId" to "   ")),
    )
  }

  @Test
  fun canonicalDedupeKeepsOneIdentityAndBoundsStorage() {
    val duplicate = appendCanonicalMessageId(
      existing = listOf("message-1", "message-2"),
      canonicalMessageId = "message-2",
      limit = 2,
    )
    assertFalse(duplicate.isNew)
    assertEquals(listOf("message-1", "message-2"), duplicate.ids)

    val appended = appendCanonicalMessageId(
      existing = listOf("message-1", "message-2"),
      canonicalMessageId = "message-3",
      limit = 2,
    )
    assertTrue(appended.isNew)
    assertEquals(listOf("message-2", "message-3"), appended.ids)
  }
}
