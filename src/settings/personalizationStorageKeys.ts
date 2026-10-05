export const PERSONALIZATION_STORAGE_KEYS = {
  current: 'mira.mobile.personalization.v3',
  legacyV2: 'mira.mobile.personalization.v2',
  legacyV1: 'mira.mobile.personalization.v1',
} as const;

export const ALL_PERSONALIZATION_STORAGE_KEYS = [
  PERSONALIZATION_STORAGE_KEYS.current,
  PERSONALIZATION_STORAGE_KEYS.legacyV2,
  PERSONALIZATION_STORAGE_KEYS.legacyV1,
] as const;
