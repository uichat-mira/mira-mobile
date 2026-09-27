import { Vibration } from 'react-native';
import { loadGeneralSettings } from '../screens/generalSettings';

const LIGHT_IMPACT_MS = 10;

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
