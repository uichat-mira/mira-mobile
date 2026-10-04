import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import {
  DEFAULT_PERSONALIZATION_SETTINGS,
  PERSONALIZATION_LOAD_FAILED,
  addTrait,
  loadPersonalizationSettings,
  savePersonalizationSettings,
} from './personalizationSettings';

const V2_KEY = 'mira.mobile.personalization.v2';
const V1_KEY = 'mira.mobile.personalization.v1';

const validV2 = {
  baseStyle: { tone: 'professional' },
  characteristics: { warmth: true, traits: ['讲话简短'], conciseFirst: false },
  instructions: '保持克制',
};

describe('personalizationSettings', () => {
  it('uses safe defaults when nothing has been persisted', async () => {
    const store = new MemoryLocalKeyValueStore();

    await expect(loadPersonalizationSettings(store)).resolves.toEqual(
      DEFAULT_PERSONALIZATION_SETTINGS,
    );
  });

  it('persists and hydrates every personalization layer', async () => {
    const store = new MemoryLocalKeyValueStore();

    await savePersonalizationSettings(
      {
        baseStyle: { tone: 'concise' },
        characteristics: {
          warmth: true,
          traits: ['讲话简短', '喜欢举一反三'],
          conciseFirst: true,
        },
        instructions: '讲话风骚幽默、引人联想',
      },
      store,
    );

    await expect(loadPersonalizationSettings(store)).resolves.toEqual({
      baseStyle: { tone: 'concise' },
      characteristics: {
        warmth: true,
        traits: ['讲话简短', '喜欢举一反三'],
        conciseFirst: true,
      },
      instructions: '讲话风骚幽默、引人联想',
    });
  });

  it('accepts every real base style including friendly', async () => {
    const store = new MemoryLocalKeyValueStore();
    await store.set(V2_KEY, JSON.stringify({ ...validV2, baseStyle: { tone: 'friendly' } }));

    await expect(loadPersonalizationSettings(store)).resolves.toMatchObject({
      baseStyle: { tone: 'friendly' },
    });
  });

  it('sanitizes valid string traits while keeping the rest of a valid v2 payload', async () => {
    const store = new MemoryLocalKeyValueStore();
    await store.set(
      V2_KEY,
      JSON.stringify({
        ...validV2,
        characteristics: {
          warmth: true,
          traits: ['  讲话简短  ', '', '讲话简短'],
          conciseFirst: false,
        },
      }),
    );

    await expect(loadPersonalizationSettings(store)).resolves.toMatchObject({
      characteristics: { warmth: true, traits: ['讲话简短'], conciseFirst: false },
    });
  });

  it('throws a load failure and preserves the payload when v2 traits is missing', async () => {
    const store = new MemoryLocalKeyValueStore();
    const corrupted = {
      baseStyle: { tone: 'professional' },
      characteristics: { warmth: true, conciseFirst: false },
      instructions: '保持克制',
    };
    await store.set(V2_KEY, JSON.stringify(corrupted));

    await expect(loadPersonalizationSettings(store)).rejects.toMatchObject({
      code: PERSONALIZATION_LOAD_FAILED,
    });
    await expect(store.get(V2_KEY)).resolves.toBe(JSON.stringify(corrupted));
  });

  it('throws a load failure and preserves the payload when v2 traits is not an array', async () => {
    const store = new MemoryLocalKeyValueStore();
    const corrupted = {
      baseStyle: { tone: 'professional' },
      characteristics: { warmth: true, traits: '讲话简短', conciseFirst: false },
      instructions: '保持克制',
    };
    await store.set(V2_KEY, JSON.stringify(corrupted));

    await expect(loadPersonalizationSettings(store)).rejects.toMatchObject({
      code: PERSONALIZATION_LOAD_FAILED,
    });
    await expect(store.get(V2_KEY)).resolves.toBe(JSON.stringify(corrupted));
  });

  it('throws a load failure and preserves the payload when a v2 trait is not a string', async () => {
    const store = new MemoryLocalKeyValueStore();
    const corrupted = {
      baseStyle: { tone: 'professional' },
      characteristics: { warmth: true, traits: ['讲话简短', 42], conciseFirst: false },
      instructions: '保持克制',
    };
    await store.set(V2_KEY, JSON.stringify(corrupted));

    await expect(loadPersonalizationSettings(store)).rejects.toMatchObject({
      code: PERSONALIZATION_LOAD_FAILED,
    });
    await expect(store.get(V2_KEY)).resolves.toBe(JSON.stringify(corrupted));
  });

  it('throws a load failure when a persisted v2 payload is not valid JSON', async () => {
    const store = new MemoryLocalKeyValueStore();
    await store.set(V2_KEY, '{not-json');

    await expect(loadPersonalizationSettings(store)).rejects.toMatchObject({
      code: PERSONALIZATION_LOAD_FAILED,
    });
  });

  it('throws a load failure when a persisted v2 payload has an invalid schema', async () => {
    const store = new MemoryLocalKeyValueStore();
    await store.set(
      V2_KEY,
      JSON.stringify({
        baseStyle: { tone: 'passive-aggressive' },
        characteristics: { warmth: 'yes', traits: [], conciseFirst: 1 },
        instructions: 123,
      }),
    );

    await expect(loadPersonalizationSettings(store)).rejects.toMatchObject({
      code: PERSONALIZATION_LOAD_FAILED,
    });
  });

  it('keeps the corrupted v2 payload untouched and never writes defaults over it', async () => {
    const store = new MemoryLocalKeyValueStore();
    const corrupted = '{not-json';
    await store.set(V2_KEY, corrupted);

    await expect(loadPersonalizationSettings(store)).rejects.toMatchObject({
      code: PERSONALIZATION_LOAD_FAILED,
    });
    await expect(store.get(V2_KEY)).resolves.toBe(corrupted);
    await expect(store.get(V2_KEY)).resolves.not.toBe(
      JSON.stringify(DEFAULT_PERSONALIZATION_SETTINGS),
    );
  });

  it('migrates v1 data into the v2 contract exactly once', async () => {
    const store = new MemoryLocalKeyValueStore();
    await store.set(
      V1_KEY,
      JSON.stringify({
        tone: 'professional',
        warmthEnabled: true,
        traits: ['讲话简短'],
        quickReplies: false,
        instructions: '保持克制',
      }),
    );

    await expect(loadPersonalizationSettings(store)).resolves.toEqual({
      baseStyle: { tone: 'professional' },
      characteristics: { warmth: true, traits: ['讲话简短'], conciseFirst: false },
      instructions: '保持克制',
    });
    await expect(store.get(V2_KEY)).resolves.not.toBeNull();
    await expect(store.get(V1_KEY)).resolves.toBeNull();
  });

  it('migrates a v1 default friendly tone to the explicit v2 default, not a fabricated choice', async () => {
    const store = new MemoryLocalKeyValueStore();
    await store.set(V1_KEY, JSON.stringify({ tone: 'friendly', instructions: '' }));

    await expect(loadPersonalizationSettings(store)).resolves.toMatchObject({
      baseStyle: { tone: 'default' },
    });
  });

  it('does not overwrite persisted v2 data when a stale v1 payload also exists', async () => {
    const store = new MemoryLocalKeyValueStore();
    await store.set(
      V2_KEY,
      JSON.stringify({
        baseStyle: { tone: 'concise' },
        characteristics: { warmth: false, traits: [], conciseFirst: true },
        instructions: 'v2 wins',
      }),
    );
    await store.set(V1_KEY, JSON.stringify({ tone: 'professional', instructions: 'stale v1' }));

    const loaded = await loadPersonalizationSettings(store);

    expect(loaded.baseStyle.tone).toBe('concise');
    expect(loaded.instructions).toBe('v2 wins');
  });

  it('keeps the v1 payload when a migration cannot parse it', async () => {
    const store = new MemoryLocalKeyValueStore();
    await store.set(V1_KEY, '{not-json');

    await expect(loadPersonalizationSettings(store)).resolves.toEqual(
      DEFAULT_PERSONALIZATION_SETTINGS,
    );
    await expect(store.get(V1_KEY)).resolves.toBe('{not-json');
    await expect(store.get(V2_KEY)).resolves.toBeNull();
  });

  it('trims and dedupes traits when adding', () => {
    const traits = addTrait([], '  讲话简短  ');

    expect(traits).toEqual(['讲话简短']);
    expect(addTrait(traits, ' 讲话简短 ')).toEqual(['讲话简短']);
    expect(addTrait(traits, '   ')).toEqual(['讲话简短']);
  });

  it('caps the trait list at the documented maximum', () => {
    let traits: string[] = [];
    for (let index = 0; index < 20; index += 1) {
      traits = addTrait(traits, `特征 ${index}`);
    }

    expect(traits).toHaveLength(12);
  });
});
