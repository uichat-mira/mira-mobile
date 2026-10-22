import { Vibration } from 'react-native';
import { loadGeneralSettings } from '../settings/generalSettings';

// 0.1 s. 10 ms was below the perceptible threshold on many Android devices
// (including the primary test device), so the haptic could not be felt at all.
const LIGHT_IMPACT_MS = 100;

// Continuous pattern for the in-app hardware test: vibrate 500 ms, pause 200 ms,
// then repeat. Repeating is enabled by passing `repeat: true` to Vibration.vibrate.
const CONTINUOUS_VIBRATION_PATTERN = [0, 500, 200, 500];

export async function lightImpact(): Promise<void> {
  let enabled: boolean;
  try {
    enabled = (await loadGeneralSettings()).hapticsEnabled;
  } catch {
    return;
  }
  if (!enabled) return;

  try {
    Vibration.vibrate(LIGHT_IMPACT_MS);
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
