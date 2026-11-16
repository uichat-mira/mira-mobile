import { localKeyValueStore, type LocalKeyValueStore } from '../storage/localKeyValueStore';
import { setTextScale, type TextScaleId } from '../theme/tokens';
import type { SessionSource } from '../types';

export type DefaultSessionSource = 'ask' | SessionSource;
export type LaunchBehavior = 'home' | 'last-session';

/**
 * Perceptual haptics strength on a 0–100 scale.
 *
 * 0     => no vibration even when hapticsEnabled is on (user effectively muted)
 * 100   => strongest allowed (maps to the full LIGHT_IMPACT_MS baseline)
 *
 * The numeric scale is intentionally decoupled from the physical vibrator
 * duration so it stays stable across devices and future tuning.
 */
export const HAPTICS_STRENGTH_MIN = 0;
export const HAPTICS_STRENGTH_MAX = 100;
export const HAPTICS_STRENGTH_DEFAULT = 60;

export interface GeneralSettings {
  defaultSessionSource: DefaultSessionSource;
  launchBehavior: LaunchBehavior;
  autoCheckUpdates: boolean;
  textScale: TextScaleId;
  hapticsEnabled: boolean;
  hapticsStrength: number;
}

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  defaultSessionSource: 'ask',
  launchBehavior: 'home',
  autoCheckUpdates: true,
  textScale: 'standard',
  hapticsEnabled: true,
  hapticsStrength: HAPTICS_STRENGTH_DEFAULT,
};

const GENERAL_SETTINGS_KEY = 'mira.mobile.general.v1';

const DEFAULT_SESSION_SOURCES: readonly DefaultSessionSource[] = [
  'ask',
  'remote-host',
  'local-provider',
];
const LAUNCH_BEHAVIORS: readonly LaunchBehavior[] = ['home', 'last-session'];
const TEXT_SCALES: readonly TextScaleId[] = ['compact', 'standard', 'large'];

const oneOf = <T extends string>(values: readonly T[], value: unknown, fallback: T): T =>
  values.includes(value as T) ? (value as T) : fallback;

const sanitizeGeneralSettings = (value: unknown): GeneralSettings => {
  if (typeof value !== 'object' || value === null) {
    return { ...DEFAULT_GENERAL_SETTINGS };
  }
  const candidate = value as Record<string, unknown>;
  return {
    defaultSessionSource: oneOf(
      DEFAULT_SESSION_SOURCES,
      candidate.defaultSessionSource,
      DEFAULT_GENERAL_SETTINGS.defaultSessionSource,
    ),
    launchBehavior: oneOf(
      LAUNCH_BEHAVIORS,
      candidate.launchBehavior,
      DEFAULT_GENERAL_SETTINGS.launchBehavior,
    ),
    autoCheckUpdates:
      typeof candidate.autoCheckUpdates === 'boolean'
        ? candidate.autoCheckUpdates
        : DEFAULT_GENERAL_SETTINGS.autoCheckUpdates,
    textScale: oneOf(TEXT_SCALES, candidate.textScale, DEFAULT_GENERAL_SETTINGS.textScale),
    hapticsEnabled:
      typeof candidate.hapticsEnabled === 'boolean'
        ? candidate.hapticsEnabled
        : DEFAULT_GENERAL_SETTINGS.hapticsEnabled,
    hapticsStrength:
      typeof candidate.hapticsStrength === 'number' &&
      Number.isFinite(candidate.hapticsStrength)
        ? Math.min(
            HAPTICS_STRENGTH_MAX,
            Math.max(HAPTICS_STRENGTH_MIN, Math.round(candidate.hapticsStrength)),
          )
        : DEFAULT_GENERAL_SETTINGS.hapticsStrength,
  };
};

export async function loadGeneralSettings(
  store: LocalKeyValueStore = localKeyValueStore,
): Promise<GeneralSettings> {
  const raw = await store.get(GENERAL_SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_GENERAL_SETTINGS };

  try {
    return sanitizeGeneralSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_GENERAL_SETTINGS };
  }
}

export async function saveGeneralSettings(
  settings: GeneralSettings,
  store: LocalKeyValueStore = localKeyValueStore,
): Promise<void> {
  await store.set(GENERAL_SETTINGS_KEY, JSON.stringify(settings));
}

export async function applyStartupTextScale(
  store: LocalKeyValueStore = localKeyValueStore,
): Promise<void> {
  try {
    const settings = await loadGeneralSettings(store);
    setTextScale(settings.textScale);
  } catch {
    setTextScale(DEFAULT_GENERAL_SETTINGS.textScale);
  }
}
