import { Vibration } from 'react-native';
import {
  HAPTICS_STRENGTH_MAX,
  HAPTICS_STRENGTH_MIN,
  loadGeneralSettings,
} from '../settings/generalSettings';

// 0.1 s. 10 ms was below the perceptible threshold on many Android devices
// (including the primary test device), so the haptic could not be felt at all.
const LIGHT_IMPACT_MS = 100;

// Continuous pattern for the in-app hardware test: vibrate 500 ms, pause 200 ms,
// then repeat. Repeating is enabled by passing `repeat: true` to Vibration.vibrate.
const CONTINUOUS_VIBRATION_PATTERN = [0, 500, 200, 500];

/**
 * Map the 0–100 perceptual strength slider to the physical vibrator duration
 * (milliseconds). Linear scaling keeps the mapping predictable; real vibrators
 * are not strictly linear, but this gives users an intuitive "more slider =
 * more vibration" relationship without hard-coding per-device quirks.
 *
 * Strength 0 returns 0 — callers should skip the Vibration call entirely so
 * we never wake the vibrator hardware when the user has effectively muted it.
 */
export function strengthToDurationMs(strength: number): number {
  const clamped = Math.min(HAPTICS_STRENGTH_MAX, Math.max(HAPTICS_STRENGTH_MIN, strength));
  return Math.round((clamped / HAPTICS_STRENGTH_MAX) * LIGHT_IMPACT_MS);
}

export async function lightImpact(): Promise<void> {
  let strength: number;
  let enabled: boolean;
  try {
    const settings = await loadGeneralSettings();
    enabled = settings.hapticsEnabled;
    strength = settings.hapticsStrength;
  } catch {
    return;
  }
  if (!enabled) return;
  const duration = strengthToDurationMs(strength);
  if (duration <= 0) return;

  try {
    Vibration.vibrate(duration);
  } catch {
    return;
  }
}

/**
 * Start a repeating vibration so the user can confirm the device vibration
 * hardware works. This is a hardware test, not a product behavior, so it
 * intentionally bypasses the `hapticsEnabled` setting.
 *
 * Must be paired with `stopContinuousVibration`; the caller is responsible for
 * stopping when the test ends or the screen unmounts.
 */
export function startContinuousVibration(): void {
  try {
    Vibration.vibrate(CONTINUOUS_VIBRATION_PATTERN, true);
  } catch {
    // ignore
  }
}

export function stopContinuousVibration(): void {
  try {
    Vibration.cancel();
  } catch {
    // ignore
  }
}
