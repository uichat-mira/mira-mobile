import { localKeyValueStore, type LocalKeyValueStore } from '../storage/localKeyValueStore';

const LEGACY_PERSONALIZATION_V1_KEY = 'mira.mobile.personalization.v1';
const LEGACY_PERSONALIZATION_V2_KEY = 'mira.mobile.personalization.v2';
const PERSONALIZATION_KEY = 'mira.mobile.personalization.v3';

// Base style / tone. `default` is the explicit "no Base style chosen" state;
// the other values are mutually exclusive presets.
export type BaseStyleTone = 'default' | 'friendly' | 'professional' | 'concise';

// Traits are additive preferences layered on top of the selected Base style.
// Built-in Base-style synonyms are rejected so Traits cannot become a second
// tone selector.
export interface PersonalizationCharacteristics {
  traits: string[];
}

export interface PersonalizationSettings {
  baseStyle: {
    tone: BaseStyleTone;
  };
  characteristics: PersonalizationCharacteristics;
  /** Custom Instructions: free-text user-authored directives. */
  instructions: string;
}

export const DEFAULT_PERSONALIZATION_SETTINGS: PersonalizationSettings = {
  baseStyle: { tone: 'default' },
  characteristics: {
    traits: [],
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

const BASE_STYLE_LABELS: Record<Exclude<BaseStyleTone, 'default'>, string> = {
  friendly: '亲和友善',
  professional: '专业严谨',
  concise: '简洁直接',
};

const BASE_STYLE_DUPLICATE_TRAITS: Readonly<Record<string, Exclude<BaseStyleTone, 'default'>>> = {
  friendly: 'friendly',
  '亲和': 'friendly',
  '亲和友善': 'friendly',
  '友善': 'friendly',
  '友好': 'friendly',
  '更友好': 'friendly',
  '更亲和': 'friendly',
  '提高亲和度': 'friendly',
  professional: 'professional',
  '专业': 'professional',
  '专业严谨': 'professional',
  '严谨': 'professional',
  '更专业': 'professional',
  concise: 'concise',
  '简洁': 'concise',
  '简洁直接': 'concise',
  '简短': 'concise',
  '讲话简短': 'concise',
  '更简洁': 'concise',
  '快速回答': 'concise',
};

const MIGRATION_STYLE_INSTRUCTIONS: Record<Exclude<BaseStyleTone, 'default'>, string> = {
  friendly: '保持亲和友善的表达。',
  professional: '保持专业严谨的表达。',
  concise: '优先简洁直接，先给结论。',
};

const traitKey = (value: string): string => normalizeTrait(value).toLocaleLowerCase();

const baseStyleToneForTrait = (
  value: string,
): Exclude<BaseStyleTone, 'default'> | null =>
  BASE_STYLE_DUPLICATE_TRAITS[traitKey(value)] ?? null;

export function getTraitSemanticError(rawTrait: string): string | null {
  const tone = baseStyleToneForTrait(rawTrait);
  if (!tone) return null;
  return `“${BASE_STYLE_LABELS[tone]}”属于基础风格，请在“基本风格和语调”中选择。`;
}

const sanitizeTraits = (value: unknown, dropBaseStyleDuplicates = false): string[] => {
  if (!Array.isArray(value)) return [];

  const traits: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trait = normalizeTrait(item);
    if (!trait || traits.includes(trait)) continue;
    if (dropBaseStyleDuplicates && baseStyleToneForTrait(trait)) continue;
    traits.push(trait);
    if (traits.length >= MAX_TRAITS) break;
  }
  return traits;
};

export function addTrait(traits: readonly string[], rawTrait: string): string[] {
  const trait = normalizeTrait(rawTrait);
  if (
    !trait ||
    getTraitSemanticError(trait) ||
    traits.includes(trait) ||
    traits.length >= MAX_TRAITS
  ) {
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

export class PersonalizationLoadError extends Error {
  readonly code = PERSONALIZATION_LOAD_FAILED;

  constructor(message: string) {
    super(message);
    this.name = 'PersonalizationLoadError';
  }
}

interface StoredPersonalizationEnvelope {
  tone: BaseStyleTone;
  characteristics: Record<string, unknown>;
  instructions: string;
}

const parseStoredEnvelope = (value: unknown): StoredPersonalizationEnvelope => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PersonalizationLoadError('Stored personalization settings are not an object');
  }
  const candidate = value as Record<string, unknown>;
  const baseStyle =
    typeof candidate.baseStyle === 'object' && candidate.baseStyle !== null
      ? (candidate.baseStyle as Record<string, unknown>)
      : null;
  const characteristics =
    typeof candidate.characteristics === 'object' && candidate.characteristics !== null
      ? (candidate.characteristics as Record<string, unknown>)
      : null;

  if (!baseStyle || !isTone(baseStyle.tone)) {
    throw new PersonalizationLoadError('Stored personalization base style is invalid');
  }
  if (!characteristics) {
    throw new PersonalizationLoadError('Stored personalization characteristics are invalid');
  }
  if (typeof candidate.instructions !== 'string') {
    throw new PersonalizationLoadError('Stored personalization instructions are invalid');
  }

  return {
    tone: baseStyle.tone,
    characteristics,
    instructions: candidate.instructions,
  };
};

const requireStringTraits = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new PersonalizationLoadError('Stored personalization traits are invalid');
  }
  return value as string[];
};

const parseStoredJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new PersonalizationLoadError('Stored personalization settings are not valid JSON');
  }
};

const parseCurrentSettings = (value: unknown): PersonalizationSettings => {
  const stored = parseStoredEnvelope(value);
  const traits = requireStringTraits(stored.characteristics.traits);

  return {
    baseStyle: { tone: stored.tone },
    characteristics: {
      traits: sanitizeTraits(traits, true),
    },
    instructions: stored.instructions.slice(0, MAX_INSTRUCTIONS_LENGTH),
  };
};

const appendMigrationInstructions = (
  instructions: string,
  additions: readonly string[],
): string => {
  const existing = normalizeInstructions(instructions);
  const uniqueAdditions = additions.filter(
    (addition, index) =>
      additions.indexOf(addition) === index && !existing.includes(addition),
  );
  return [existing, ...uniqueAdditions]
    .filter((part) => part.length > 0)
    .join('\n')
    .slice(0, MAX_INSTRUCTIONS_LENGTH);
};

/**
 * v2 carried two built-in characteristic toggles that overlapped Base style:
 * warmth ~= friendly and conciseFirst ~= concise. v3 removes those controls.
 *
 * Migration keeps one compatible signal as the Base style when no Base style
 * was explicitly selected. Any additional/conflicting legacy style signal is
 * moved into visible Custom Instructions instead of becoming a hidden runtime
 * preference. Base-style-like free-text traits are handled the same way.
 */
const migrateV2Settings = (value: unknown): PersonalizationSettings => {
  const stored = parseStoredEnvelope(value);
  const { characteristics } = stored;
  if (
    typeof characteristics.warmth !== 'boolean' ||
    typeof characteristics.conciseFirst !== 'boolean'
  ) {
    throw new PersonalizationLoadError('Stored personalization characteristics are invalid');
  }
  const legacyTraits = requireStringTraits(characteristics.traits);

  let tone: BaseStyleTone = stored.tone;
  const migratedInstructions: string[] = [];
  const absorbStyleSignal = (target: Exclude<BaseStyleTone, 'default'>) => {
    if (tone === 'default') {
      tone = target;
      return;
    }
    if (tone !== target) {
      migratedInstructions.push(MIGRATION_STYLE_INSTRUCTIONS[target]);
    }
  };

  if (characteristics.warmth) absorbStyleSignal('friendly');
  if (characteristics.conciseFirst) absorbStyleSignal('concise');

  const traits: string[] = [];
  for (const trait of sanitizeTraits(legacyTraits)) {
    const duplicateTone = baseStyleToneForTrait(trait);
    if (duplicateTone) {
      absorbStyleSignal(duplicateTone);
      continue;
    }
    traits.push(trait);
  }

  return {
    baseStyle: { tone },
    characteristics: { traits },
    instructions: appendMigrationInstructions(
      stored.instructions,
      migratedInstructions,
    ),
  };
};

/**
 * v1 had a flat shape. Its default tone was friendly, so a stored friendly
 * value cannot prove an explicit user choice and still migrates to default.
 * From there it passes through the same v2 -> v3 semantic migration.
 */
const migrateV1Settings = (value: unknown): PersonalizationSettings | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const migratedTone: BaseStyleTone =
    candidate.tone === 'professional' || candidate.tone === 'concise'
      ? candidate.tone
      : DEFAULT_PERSONALIZATION_SETTINGS.baseStyle.tone;

  return migrateV2Settings({
    baseStyle: { tone: migratedTone },
    characteristics: {
      warmth: typeof candidate.warmthEnabled === 'boolean' ? candidate.warmthEnabled : false,
      traits: sanitizeTraits(candidate.traits),
      conciseFirst: typeof candidate.quickReplies === 'boolean' ? candidate.quickReplies : false,
    },
    instructions: normalizeInstructions(candidate.instructions),
  });
};

export async function loadPersonalizationSettings(
  store: LocalKeyValueStore = localKeyValueStore,
): Promise<PersonalizationSettings> {
  const currentRaw = await store.get(PERSONALIZATION_KEY);
  if (currentRaw !== null) {
    return parseCurrentSettings(parseStoredJson(currentRaw));
  }

  const v2Raw = await store.get(LEGACY_PERSONALIZATION_V2_KEY);
  if (v2Raw !== null) {
    const migrated = migrateV2Settings(parseStoredJson(v2Raw));
    await store.set(PERSONALIZATION_KEY, JSON.stringify(migrated));
    await store.remove(LEGACY_PERSONALIZATION_V2_KEY);
    return migrated;
  }

  const v1Raw = await store.get(LEGACY_PERSONALIZATION_V1_KEY);
  if (v1Raw === null) return DEFAULT_PERSONALIZATION_SETTINGS;

  let migrated: PersonalizationSettings | null = null;
  try {
    migrated = migrateV1Settings(JSON.parse(v1Raw) as unknown);
  } catch {
    migrated = null;
  }
  if (!migrated) return DEFAULT_PERSONALIZATION_SETTINGS;

  await store.set(PERSONALIZATION_KEY, JSON.stringify(migrated));
  await store.remove(LEGACY_PERSONALIZATION_V1_KEY);
  return migrated;
}

export async function savePersonalizationSettings(
  settings: PersonalizationSettings,
  store: LocalKeyValueStore = localKeyValueStore,
): Promise<void> {
  await store.set(PERSONALIZATION_KEY, JSON.stringify(settings));
}
