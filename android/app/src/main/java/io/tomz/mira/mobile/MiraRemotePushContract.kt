package io.tomz.mira.mobile

internal data class MiraRemotePushEnvelope(
  val eventId: String,
  val sourceId: String,
  val canonicalMessageId: String,
)

internal object MiraRemotePushContract {
  private const val SCHEMA_VERSION = "1"
  private const val EVENT_TYPE = "assistant-message"
  private const val ELIGIBILITY_EVENT = "final_transition_first_seen"
  private const val MAX_ID_LENGTH = 512

  private fun validIdentity(value: String?): String? {
    val normalized = value?.trim() ?: return null
    if (normalized.isEmpty() || normalized.length > MAX_ID_LENGTH) return null
    if (normalized.any { it == '\n' || it == '\r' || it == '\u0000' }) return null
    return normalized
  }

  fun parse(data: Map<String, String>): MiraRemotePushEnvelope? {
    if (data["schemaVersion"] != SCHEMA_VERSION) return null
    if (data["eventType"] != EVENT_TYPE) return null
    if (data["eligibilityEvent"] != ELIGIBILITY_EVENT) return null

    validIdentity(data["installationId"]) ?: return null
    val eventId = validIdentity(data["eventId"]) ?: return null
    val sourceId = validIdentity(data["sourceId"]) ?: return null
    val canonicalMessageId = validIdentity(data["canonicalMessageId"]) ?: return null

    return MiraRemotePushEnvelope(
      eventId = eventId,
      sourceId = sourceId,
      canonicalMessageId = canonicalMessageId,
    )
  }
}

internal data class MiraCanonicalDedupeResult(
  val isNew: Boolean,
  val ids: List<String>,
)

internal fun appendCanonicalMessageId(
  existing: List<String>,
  canonicalMessageId: String,
  limit: Int = 128,
): MiraCanonicalDedupeResult {
  require(limit > 0)
  if (canonicalMessageId in existing) {
    return MiraCanonicalDedupeResult(isNew = false, ids = existing)
  }
  return MiraCanonicalDedupeResult(
    isNew = true,
    ids = (existing + canonicalMessageId).takeLast(limit),
  )
}
