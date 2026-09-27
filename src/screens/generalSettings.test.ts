import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import {
  DEFAULT_GENERAL_SETTINGS,
  applyStartupTextScale,
  loadGeneralSettings,
  saveGeneralSettings,
} from './generalSettings';
import { fontSize, setTextScale } from '../theme/tokens';

const makeStore = () => new MemoryLocalKeyValueStore();

describe('generalSettings', () => {
  // textScaleFactor is process-wide mutable state; leaving it changed would make
  // any later test that reads fontSize depend on execution order.
  beforeEach(() => setTextScale('standard'));
  afterEach(() => setTextScale('standard'));

  it('returns defaults when nothing is stored', async () => {
    const store = makeStore();
    await expect(loadGeneralSettings(store)).resolves.toEqual(DEFAULT_GENERAL_SETTINGS);
  });

  it('round-trips saved settings', async () => {
    const store = makeStore();
    const settings = {
      defaultSessionSource: 'remote-host',
      launchBehavior: 'last-session',
      autoCheckUpdates: false,
      textScale: 'large',
      hapticsEnabled: false,
    } as const;

    await saveGeneralSettings(settings, store);
    await expect(loadGeneralSettings(store)).resolves.toEqual(settings);
  });

  it('falls back per field on invalid stored values', async () => {
    const store = makeStore();
    await store.set(
      'mira.mobile.general.v1',
      JSON.stringify({
        defaultSessionSource: 'bluetooth',
        launchBehavior: 'splash',
        autoCheckUpdates: 'yes',
        textScale: 'huge',
        hapticsEnabled: 1,
      }),
    );

    await expect(loadGeneralSettings(store)).resolves.toEqual(DEFAULT_GENERAL_SETTINGS);
  });

  it('falls back to defaults on malformed JSON', async () => {
    const store = makeStore();
    await store.set('mira.mobile.general.v1', '{not-json');

    await expect(loadGeneralSettings(store)).resolves.toEqual(DEFAULT_GENERAL_SETTINGS);
  });

  it('still applies the default text scale when the store throws', async () => {
    const failingStore = {
      isAvailable: () => false,
      get: () => Promise.reject(new Error('storage unavailable')),
      set: () => Promise.reject(new Error('storage unavailable')),
      remove: () => Promise.reject(new Error('storage unavailable')),
    };

    setTextScale('compact');
    await applyStartupTextScale(failingStore);
    expect(fontSize.bodyMd).toBe(16);
  });
});
