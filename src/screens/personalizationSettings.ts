import { localKeyValueStore, type LocalKeyValueStore } from '../storage/localKeyValueStore';

export type PersonalizationTone = 'friendly' | 'professional' | 'concise';

export interface PersonalizationSettings {
  tone: PersonalizationTone;
  warmthEnabled: boolean;
  traits: string[];
  quickReplies: boolean;
  instructions: string;
}

export const DEFAULT_PERSONALIZATION_SETTINGS: PersonalizationSettings = {
  tone: 'friendly',
  warmthEnabled: false,
  traits: [],
  quickReplies: true,
  instructions: '',
};

const PERSONALIZATION_KEY = 'mira.mobile.personalization.v1';

export const MAX_TRAITS = 12;
export const MAX_TRAIT_LENGTH = 60;
export const MAX_INSTRUCTIONS_LENGTH = 2000;

const TONES: readonly PersonalizationTone[] = ['friendly', 'professional', 'concise'];

const isTone = (value: unknown): value is PersonalizationTone =>
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

export async function loadPersonalizationSettings(
  store: LocalKeyValueStore = localKeyValueStore,
): Promise<PersonalizationSettings> {
  const raw = await store.get(PERSONALIZATION_KEY);
  if (!raw) return DEFAULT_PERSONALIZATION_SETTINGS;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return DEFAULT_PERSONALIZATION_SETTINGS;
    }

    const candidate = parsed as Record<string, unknown>;
    return {
      tone: isTone(candidate.tone) ? candidate.tone : DEFAULT_PERSONALIZATION_SETTINGS.tone,
      warmthEnabled:
        typeof candidate.warmthEnabled === 'boolean'
          ? candidate.warmthEnabled
          : DEFAULT_PERSONALIZATION_SETTINGS.warmthEnabled,
      traits: sanitizeTraits(candidate.traits),
      quickReplies:
        typeof candidate.quickReplies === 'boolean'
          ? candidate.quickReplies
          : DEFAULT_PERSONALIZATION_SETTINGS.quickReplies,
      instructions:
        typeof candidate.instructions === 'string'
          ? candidate.instructions.slice(0, MAX_INSTRUCTIONS_LENGTH)
          : DEFAULT_PERSONALIZATION_SETTINGS.instructions,
    };
  } catch {
    return DEFAULT_PERSONALIZATION_SETTINGS;
  }
}

export async function savePersonalizationSettings(
  settings: PersonalizationSettings,
  store: LocalKeyValueStore = localKeyValueStore,
): Promise<void> {
  await store.set(PERSONALIZATION_KEY, JSON.stringify(settings));
}
