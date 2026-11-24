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
      hapticsStrength: 42,
      agentExecutionStrength: 'enhanced',
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
        hapticsStrength: 'strong',
      }),
    );

    await expect(loadGeneralSettings(store)).resolves.toEqual(DEFAULT_GENERAL_SETTINGS);
  });

  it('clamps hapticsStrength to the 0–100 scale', async () => {
    const store = makeStore();
    await store.set(
      'mira.mobile.general.v1',
      JSON.stringify({
        ...DEFAULT_GENERAL_SETTINGS,
        hapticsStrength: 999,
      }),
    );
    await expect(loadGeneralSettings(store)).resolves.toMatchObject({ hapticsStrength: 100 });

    await store.set(
      'mira.mobile.general.v1',
      JSON.stringify({
        ...DEFAULT_GENERAL_SETTINGS,
        hapticsStrength: -50,
      }),
    );
    await expect(loadGeneralSettings(store)).resolves.toMatchObject({ hapticsStrength: 0 });
  });

  it('migrates old general settings without an Agent budget to standard strength', async () => {
    const store = makeStore();
    await store.set('mira.mobile.general.v1', JSON.stringify({
      defaultSessionSource: 'ask',
      launchBehavior: 'home',
      autoCheckUpdates: true,
      textScale: 'standard',
      hapticsEnabled: true,
      hapticsStrength: 60,
    }));
    const loaded = await loadGeneralSettings(store);
    expect(loaded.agentExecutionStrength).toBe('standard');
  });

  it('deterministically migrates the removed free-form Agent budget', async () => {
    const store = makeStore();
    const migrate = async (agentBudget: unknown) => {
      await store.set('mira.mobile.general.v1', JSON.stringify({
        ...DEFAULT_GENERAL_SETTINGS,
        agentExecutionStrength: undefined,
        agentBudget,
      }));
      return (await loadGeneralSettings(store)).agentExecutionStrength;
    };

    await expect(migrate({ maxToolRounds: 16, maxDurationMinutes: 15 }))
      .resolves.toBe('standard');
    await expect(migrate({ maxToolRounds: 8, maxDurationMinutes: 5 }))
      .resolves.toBe('light');
    // Old bounds clamp this to 64 rounds / 1 minute, closest to enhanced.
    await expect(migrate({ maxToolRounds: 999, maxDurationMinutes: -2 }))
      .resolves.toBe('enhanced');
    await expect(migrate({ maxToolRounds: 'abc', maxDurationMinutes: null }))
      .resolves.toBe('standard');
  });

  it('prefers a valid execution-strength field over a legacy budget', async () => {
    const store = makeStore();
    await store.set('mira.mobile.general.v1', JSON.stringify({
      ...DEFAULT_GENERAL_SETTINGS,
      agentExecutionStrength: 'deep',
      agentBudget: { maxToolRounds: 8, maxDurationMinutes: 5 },
    }));
    await expect(loadGeneralSettings(store)).resolves.toMatchObject({
      agentExecutionStrength: 'deep',
    });
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
