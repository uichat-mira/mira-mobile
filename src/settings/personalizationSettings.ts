import { localKeyValueStore, type LocalKeyValueStore } from '../storage/localKeyValueStore';

// Both keys are read during load so the v1 -> v2 migration can run once.
// v1 is only read for migration; new writes always target v2.
const LEGACY_PERSONALIZATION_KEY = 'mira.mobile.personalization.v1';
const PERSONALIZATION_KEY = 'mira.mobile.personalization.v2';

// Base style / tone. `default` is the explicit "no Base style chosen" state;
// `friendly` / `professional` / `concise` are all real user choices.
export type BaseStyleTone = 'default' | 'friendly' | 'professional' | 'concise';

// Characteristics: stable micro-adjustments layered on top of the base style.
export interface PersonalizationCharacteristics {
  /** Warmer, more personable phrasing. */
  warmth: boolean;
  /** Free-text traits the user explicitly asked Mira to keep. */
  traits: string[];
  /** Prefer concise answers by default. */
  conciseFirst: boolean;
}

export interface PersonalizationSettings {
  /** Base style / tone. */
  baseStyle: {
    tone: BaseStyleTone;
  };
  /** Characteristics. */
  characteristics: PersonalizationCharacteristics;
  /** Custom Instructions: free-text user-authored directives. */
  instructions: string;
}

export const DEFAULT_PERSONALIZATION_SETTINGS: PersonalizationSettings = {
  baseStyle: { tone: 'default' },
  characteristics: {
    warmth: false,
    traits: [],
    conciseFirst: false,
  },
  instructions: '',
};

export const MAX_TRAITS = 12;
export const MAX_TRAIT_LENGTH = 60;
export const MAX_INSTRUCTIONS_LENGTH = 2000;

const TONES: readonly BaseStyleTone[] = ['default', 'friendly', 'professional', 'concise'];

const isTone = (value: unknown): value is BaseStyleTone =>
  typeof value === 'string' && (TONES as readonly string[]).includes(value);

export const normalizeTrait = (value: string): string => value.trim().slice(0, MAX_TRAIT_LENGTH);

const sanitizeTraits = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  const traits: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trait = normalizeTrait(item);
    if (!trait || traits.includes(trait)) continue;
    traits.push(trait);
    if (traits.length >= MAX_TRAITS) break;
  }
  return traits;
};

export function addTrait(traits: readonly string[], rawTrait: string): string[] {
  const trait = normalizeTrait(rawTrait);
  if (!trait || traits.includes(trait) || traits.length >= MAX_TRAITS) {
    return [...traits];
  }
  return [...traits, trait];
}

export function removeTrait(traits: readonly string[], index: number): string[] {
  return traits.filter((_, position) => position !== index);
}

const normalizeInstructions = (value: unknown): string =>
  typeof value === 'string' ? value.slice(0, MAX_INSTRUCTIONS_LENGTH) : '';

export const PERSONALIZATION_LOAD_FAILED = 'PERSONALIZATION_LOAD_FAILED';

/**
 * Raised when a persisted v2 payload exists but cannot be parsed into the
 * current contract. Load must surface this instead of returning defaults so a
 * later save can never silently overwrite the user's original data.
 */
export class PersonalizationLoadError extends Error {
  readonly code = PERSONALIZATION_LOAD_FAILED;

  constructor(message: string) {
    super(message);
    this.name = 'PersonalizationLoadError';
  }
}

const parseSettings = (value: unknown): PersonalizationSettings => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PersonalizationLoadError('Stored personalization settings are not an object');
  }
  const candidate = value as Record<string, unknown>;
  const baseStyleRecord =
    typeof candidate.baseStyle === 'object' && candidate.baseStyle !== null
      ? (candidate.baseStyle as Record<string, unknown>)
      : null;
  const characteristicsRecord =
    typeof candidate.characteristics === 'object' && candidate.characteristics !== null
      ? (candidate.characteristics as Record<string, unknown>)
      : null;

  if (!baseStyleRecord || !isTone(baseStyleRecord.tone)) {
    throw new PersonalizationLoadError('Stored personalization base style is invalid');
  }
  if (!characteristicsRecord || typeof characteristicsRecord.warmth !== 'boolean') {
    throw new PersonalizationLoadError('Stored personalization characteristics are invalid');
  }
  if (typeof characteristicsRecord.conciseFirst !== 'boolean') {
    throw new PersonalizationLoadError('Stored personalization characteristics are invalid');
  }
  const traitsValue = characteristicsRecord.traits;
  if (!Array.isArray(traitsValue)) {
    throw new PersonalizationLoadError('Stored personalization traits are invalid');
  }
  for (const item of traitsValue) {
    if (typeof item !== 'string') {
      throw new PersonalizationLoadError('Stored personalization traits are invalid');
    }
  }
  if (typeof candidate.instructions !== 'string') {
    throw new PersonalizationLoadError('Stored personalization instructions are invalid');
  }

  return {
    baseStyle: { tone: baseStyleRecord.tone },
    characteristics: {
      warmth: characteristicsRecord.warmth,
      // Shape is already validated above; only trim / dedupe / cap the valid strings.
      traits: sanitizeTraits(traitsValue),
      conciseFirst: characteristicsRecord.conciseFirst,
    },
    instructions: candidate.instructions.slice(0, MAX_INSTRUCTIONS_LENGTH),
  };
};

/**
 * One-time migration from the v1 flat shape (`tone` / `warmthEnabled` /
 * `traits` / `quickReplies` / `instructions`) to the v2 layered shape.
 * Returns null when the payload is not a usable v1 object.
 */
const migrateLegacySettings = (value: unknown): PersonalizationSettings | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  // v1's default tone was `friendly`, so a v1 `friendly` cannot prove the user
  // actively chose it. Migrate it to the explicit v2 `default` instead of
  // fabricating a user choice; professional/concise are preserved as choices.
  const migratedTone: BaseStyleTone =
    candidate.tone === 'professional' || candidate.tone === 'concise'
      ? candidate.tone
      : DEFAULT_PERSONALIZATION_SETTINGS.baseStyle.tone;
  return {
    baseStyle: { tone: migratedTone },
    characteristics: {
      warmth:
        typeof candidate.warmthEnabled === 'boolean'
          ? candidate.warmthEnabled
          : DEFAULT_PERSONALIZATION_SETTINGS.characteristics.warmth,
      traits: sanitizeTraits(candidate.traits),
      // v1 `quickReplies` (prefer shorter answers) maps onto the concise characteristic.
      conciseFirst:
        typeof candidate.quickReplies === 'boolean'
          ? candidate.quickReplies
          : DEFAULT_PERSONALIZATION_SETTINGS.characteristics.conciseFirst,
    },
    instructions: normalizeInstructions(candidate.instructions),
  };
};

export async function loadPersonalizationSettings(
  store: LocalKeyValueStore = localKeyValueStore,
): Promise<PersonalizationSettings> {
  const raw = await store.get(PERSONALIZATION_KEY);
  if (raw !== null) {
    // v2 exists but is unreadable: surface a load failure. Returning defaults
    // here would make the UI believe loading succeeded and a later save could
    // overwrite the user's original payload.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new PersonalizationLoadError('Stored personalization settings are not valid JSON');
    }
    return parseSettings(parsed);
  }

  // No v2 payload yet: attempt a single explicit migration from v1. A failed
  // migration must not clobber the legacy value, so the write only happens
  // after the legacy payload parsed into a real settings object. Unreadable v1
  // data is not a load failure: it yields defaults and stays untouched.
  const legacyRaw = await store.get(LEGACY_PERSONALIZATION_KEY);
  if (legacyRaw === null) return DEFAULT_PERSONALIZATION_SETTINGS;

  let migrated: PersonalizationSettings | null = null;
  try {
    migrated = migrateLegacySettings(JSON.parse(legacyRaw) as unknown);
  } catch {
    migrated = null;
  }
  if (!migrated) return DEFAULT_PERSONALIZATION_SETTINGS;

  await store.set(PERSONALIZATION_KEY, JSON.stringify(migrated));
  await store.remove(LEGACY_PERSONALIZATION_KEY);
  return migrated;
}

export async function savePersonalizationSettings(
  settings: PersonalizationSettings,
  store: LocalKeyValueStore = localKeyValueStore,
): Promise<void> {
  await store.set(PERSONALIZATION_KEY, JSON.stringify(settings));
}
