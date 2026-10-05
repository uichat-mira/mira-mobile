import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import {
  DEFAULT_PERSONALIZATION_SETTINGS,
  PERSONALIZATION_LOAD_FAILED,
  addTrait,
  getTraitSemanticError,
  loadPersonalizationSettings,
  savePersonalizationSettings,
} from './personalizationSettings';

const V3_KEY = 'mira.mobile.personalization.v3';
const V2_KEY = 'mira.mobile.personalization.v2';
const V1_KEY = 'mira.mobile.personalization.v1';

const validV3 = {
  baseStyle: { tone: 'professional' },
  characteristics: { traits: ['多用类比'] },
  instructions: '保持克制',
};

interface V2Overrides {
  tone?: 'default' | 'friendly' | 'professional' | 'concise';
  warmth?: boolean;
  traits?: string[];
  conciseFirst?: boolean;
  instructions?: string;
}

const v2Payload = ({
  tone = 'professional',
  warmth = false,
  traits = ['多用类比'],
  conciseFirst = false,
  instructions = '保持克制',
}: V2Overrides = {}) => ({
  baseStyle: { tone },
  characteristics: { warmth, traits, conciseFirst },
  instructions,
});

const persistV2 = (store: MemoryLocalKeyValueStore, overrides?: V2Overrides) =>
  store.set(V2_KEY, JSON.stringify(v2Payload(overrides)));

describe('personalizationSettings', () => {
  it('uses safe defaults when nothing has been persisted', async () => {
    const store = new MemoryLocalKeyValueStore();

    await expect(loadPersonalizationSettings(store)).resolves.toEqual(
      DEFAULT_PERSONALIZATION_SETTINGS,
    );
  });

  it('persists and hydrates the v3 Base-style + additive-traits contract', async () => {
    const store = new MemoryLocalKeyValueStore();

    await savePersonalizationSettings(
      {
        baseStyle: { tone: 'concise' },
        characteristics: { traits: ['多用类比', '给出反例'] },
        instructions: '保持克制',
      },
      store,
    );

    await expect(loadPersonalizationSettings(store)).resolves.toEqual({
      baseStyle: { tone: 'concise' },
      characteristics: { traits: ['多用类比', '给出反例'] },
      instructions: '保持克制',
    });
    await expect(store.get(V3_KEY)).resolves.not.toBeNull();
  });

  it('accepts every real base style including friendly', async () => {
    const store = new MemoryLocalKeyValueStore();
    await store.set(V3_KEY, JSON.stringify({ ...validV3, baseStyle: { tone: 'friendly' } }));

    await expect(loadPersonalizationSettings(store)).resolves.toMatchObject({
      baseStyle: { tone: 'friendly' },
    });
  });

  it('sanitizes current traits and removes obvious Base-style duplicates', async () => {
    const store = new MemoryLocalKeyValueStore();
    await store.set(
      V3_KEY,
      JSON.stringify({
        ...validV3,
        characteristics: {
          traits: ['  多用类比  ', '', '多用类比', '讲话简短', '亲和友善'],
        },
      }),
    );

    await expect(loadPersonalizationSettings(store)).resolves.toMatchObject({
      characteristics: { traits: ['多用类比'] },
    });
  });

  it('throws a load failure and preserves the payload when v3 traits is invalid', async () => {
    const store = new MemoryLocalKeyValueStore();
    const corrupted = {
      baseStyle: { tone: 'professional' },
      characteristics: { traits: '多用类比' },
      instructions: '保持克制',
    };
    await store.set(V3_KEY, JSON.stringify(corrupted));

    await expect(loadPersonalizationSettings(store)).rejects.toMatchObject({
      code: PERSONALIZATION_LOAD_FAILED,
    });
    await expect(store.get(V3_KEY)).resolves.toBe(JSON.stringify(corrupted));
  });

  it('throws a load failure when persisted v3 is not valid JSON', async () => {
    const store = new MemoryLocalKeyValueStore();
    await store.set(V3_KEY, '{not-json');

    await expect(loadPersonalizationSettings(store)).rejects.toMatchObject({
      code: PERSONALIZATION_LOAD_FAILED,
    });
  });

  it('migrates a sole v2 warmth toggle into the friendly Base style', async () => {
    const store = new MemoryLocalKeyValueStore();
    await persistV2(store, { tone: 'default', warmth: true });

    await expect(loadPersonalizationSettings(store)).resolves.toEqual({
      baseStyle: { tone: 'friendly' },
      characteristics: { traits: ['多用类比'] },
      instructions: '保持克制',
    });
    await expect(store.get(V3_KEY)).resolves.not.toBeNull();
    await expect(store.get(V2_KEY)).resolves.not.toBeNull();
  });

  it('keeps an explicitly chosen Base style when v2 style signals conflict', async () => {
    const store = new MemoryLocalKeyValueStore();
    await persistV2(store, {
      warmth: true,
      traits: ['讲话简短', '给出反例'],
      conciseFirst: true,
    });

    const loaded = await loadPersonalizationSettings(store);

    expect(loaded).toEqual({
      baseStyle: { tone: 'professional' },
      characteristics: { traits: ['给出反例'] },
      instructions: '保持克制',
    });
  });

  it('uses a deterministic single winner when legacy signals conflict without an explicit Base style', async () => {
    const store = new MemoryLocalKeyValueStore();
    await persistV2(store, {
      tone: 'default',
      warmth: true,
      traits: ['亲和友善', '讲话简短', '给出反例'],
      conciseFirst: true,
    });

    await expect(loadPersonalizationSettings(store)).resolves.toEqual({
      baseStyle: { tone: 'concise' },
      characteristics: { traits: ['给出反例'] },
      instructions: '保持克制',
    });
  });

  it('is idempotent after v2 migration and keeps the legacy payload as a recovery snapshot', async () => {
    const store = new MemoryLocalKeyValueStore();
    await persistV2(store, { tone: 'default', warmth: true, traits: [] });

    const first = await loadPersonalizationSettings(store);
    const second = await loadPersonalizationSettings(store);

    expect(first).toEqual({
      baseStyle: { tone: 'friendly' },
      characteristics: { traits: [] },
      instructions: '保持克制',
    });
    expect(second).toEqual(first);
    await expect(store.get(V2_KEY)).resolves.not.toBeNull();
  });

  it('treats v3 as authoritative when a prior migration wrote v3 but v2 cleanup did not finish', async () => {
    const store = new MemoryLocalKeyValueStore();
    const current = {
      baseStyle: { tone: 'professional' },
      characteristics: { traits: ['给出反例'] },
      instructions: '保持克制',
    };
    await store.set(V3_KEY, JSON.stringify(current));
    await persistV2(store, { warmth: true, traits: [] });

    await expect(loadPersonalizationSettings(store)).resolves.toEqual(current);
    await expect(store.get(V2_KEY)).resolves.not.toBeNull();
  });

  it('promotes an old Base-style-like free-text trait instead of keeping a duplicate Trait', async () => {
    const store = new MemoryLocalKeyValueStore();
    await persistV2(store, {
      tone: 'default',
      traits: ['讲话简短', '给出反例'],
    });

    await expect(loadPersonalizationSettings(store)).resolves.toMatchObject({
      baseStyle: { tone: 'concise' },
      characteristics: { traits: ['给出反例'] },
    });
  });

  it('treats a missing legacy v2 traits field as an empty additive-traits list', async () => {
    const store = new MemoryLocalKeyValueStore();
    await store.set(
      V2_KEY,
      JSON.stringify({
        baseStyle: { tone: 'default' },
        characteristics: { warmth: true, conciseFirst: false },
        instructions: '保持克制',
      }),
    );

    await expect(loadPersonalizationSettings(store)).resolves.toEqual({
      baseStyle: { tone: 'friendly' },
      characteristics: { traits: [] },
      instructions: '保持克制',
    });
    await expect(store.get(V3_KEY)).resolves.not.toBeNull();
    await expect(store.get(V2_KEY)).resolves.not.toBeNull();
  });

  it('keeps v2 recoverable when writing the migrated v3 value fails', async () => {
    class FailingCurrentWriteStore extends MemoryLocalKeyValueStore {
      override async set(key: string, value: string) {
        if (key === V3_KEY) throw new Error('v3 write failed');
        return super.set(key, value);
      }
    }

    const store = new FailingCurrentWriteStore();
    await persistV2(store, { tone: 'default', warmth: true });

    await expect(loadPersonalizationSettings(store)).rejects.toThrow('v3 write failed');
    await expect(store.get(V2_KEY)).resolves.not.toBeNull();
    await expect(store.get(V3_KEY)).resolves.toBeNull();
  });

  it('preserves a genuinely malformed v2 traits payload instead of writing defaults over it', async () => {
    const store = new MemoryLocalKeyValueStore();
    const corrupted = {
      baseStyle: { tone: 'professional' },
      characteristics: { warmth: true, traits: 'not-an-array', conciseFirst: false },
      instructions: '保持克制',
    };
    await store.set(V2_KEY, JSON.stringify(corrupted));

    await expect(loadPersonalizationSettings(store)).rejects.toMatchObject({
      code: PERSONALIZATION_LOAD_FAILED,
    });
    await expect(store.get(V2_KEY)).resolves.toBe(JSON.stringify(corrupted));
    await expect(store.get(V3_KEY)).resolves.toBeNull();
  });

  it('migrates v1 data through the same semantic contract exactly once', async () => {
    const store = new MemoryLocalKeyValueStore();
    await store.set(
      V1_KEY,
      JSON.stringify({
        tone: 'professional',
        warmthEnabled: false,
        traits: ['多用类比'],
        quickReplies: true,
        instructions: '保持克制',
      }),
    );

    const loaded = await loadPersonalizationSettings(store);

    expect(loaded).toEqual({
      baseStyle: { tone: 'professional' },
      characteristics: { traits: ['多用类比'] },
      instructions: '保持克制',
    });
    await expect(store.get(V3_KEY)).resolves.not.toBeNull();
    await expect(store.get(V1_KEY)).resolves.not.toBeNull();
  });

  it('keeps unreadable v1 data untouched and falls back to defaults', async () => {
    const store = new MemoryLocalKeyValueStore();
    await store.set(V1_KEY, '{not-json');

    await expect(loadPersonalizationSettings(store)).resolves.toEqual(
      DEFAULT_PERSONALIZATION_SETTINGS,
    );
    await expect(store.get(V1_KEY)).resolves.toBe('{not-json');
    await expect(store.get(V3_KEY)).resolves.toBeNull();
  });

  it('rejects Traits that duplicate a Base-style preset', () => {
    expect(getTraitSemanticError('亲和友善')).toContain('基础风格');
    expect(getTraitSemanticError('讲话简短')).toContain('基础风格');
    expect(getTraitSemanticError('专业严谨')).toContain('基础风格');
    expect(getTraitSemanticError('多用类比')).toBeNull();

    expect(addTrait([], '讲话简短')).toEqual([]);
    expect(addTrait([], '多用类比')).toEqual(['多用类比']);
  });

  it('trims, dedupes, and caps additive traits', () => {
    const traits = addTrait([], '  多用类比  ');
    expect(traits).toEqual(['多用类比']);
    expect(addTrait(traits, ' 多用类比 ')).toEqual(['多用类比']);
    expect(addTrait(traits, '   ')).toEqual(['多用类比']);

    let capped: string[] = [];
    for (let index = 0; index < 20; index += 1) {
      capped = addTrait(capped, `额外特征 ${index}`);
    }
    expect(capped).toHaveLength(12);
  });
});
