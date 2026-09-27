import { localKeyValueStore, type LocalKeyValueStore } from '../storage/localKeyValueStore';
import { setTextScale, type TextScaleId } from '../theme/tokens';
import type { SessionSource } from '../types';

export type DefaultSessionSource = 'ask' | SessionSource;
export type LaunchBehavior = 'home' | 'last-session';

export interface GeneralSettings {
  defaultSessionSource: DefaultSessionSource;
  launchBehavior: LaunchBehavior;
  autoCheckUpdates: boolean;
  textScale: TextScaleId;
  hapticsEnabled: boolean;
}

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  defaultSessionSource: 'ask',
  launchBehavior: 'home',
  autoCheckUpdates: true,
  textScale: 'standard',
  hapticsEnabled: true,
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
