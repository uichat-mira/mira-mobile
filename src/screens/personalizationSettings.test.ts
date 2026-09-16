import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import {
  DEFAULT_PERSONALIZATION_SETTINGS,
  addTrait,
  loadPersonalizationSettings,
  savePersonalizationSettings,
} from './personalizationSettings';

const STORAGE_KEY = 'mira.mobile.personalization.v1';

describe('personalizationSettings', () => {
  it('uses safe defaults when nothing has been persisted', async () => {
    const store = new MemoryLocalKeyValueStore();

    await expect(loadPersonalizationSettings(store)).resolves.toEqual(
      DEFAULT_PERSONALIZATION_SETTINGS,
    );
  });

  it('persists and hydrates every personalization control', async () => {
    const store = new MemoryLocalKeyValueStore();

    await savePersonalizationSettings(
      {
        tone: 'concise',
        warmthEnabled: true,
        traits: ['讲话简短', '喜欢举一反三'],
        quickReplies: false,
        instructions: '讲话风骚幽默、引人联想',
      },
      store,
    );

    await expect(loadPersonalizationSettings(store)).resolves.toEqual({
      tone: 'concise',
      warmthEnabled: true,
      traits: ['讲话简短', '喜欢举一反三'],
      quickReplies: false,
      instructions: '讲话风骚幽默、引人联想',
    });
  });

  it('falls back and sanitizes when persisted values are invalid', async () => {
    const store = new MemoryLocalKeyValueStore();
    await store.set(
      STORAGE_KEY,
      JSON.stringify({
        tone: 'passive-aggressive',
        warmthEnabled: 'yes',
        traits: ['  讲话简短  ', '', 42, '讲话简短'],
        quickReplies: 1,
        instructions: 123,
      }),
    );

    await expect(loadPersonalizationSettings(store)).resolves.toEqual({
      tone: DEFAULT_PERSONALIZATION_SETTINGS.tone,
      warmthEnabled: DEFAULT_PERSONALIZATION_SETTINGS.warmthEnabled,
      traits: ['讲话简短'],
      quickReplies: DEFAULT_PERSONALIZATION_SETTINGS.quickReplies,
      instructions: DEFAULT_PERSONALIZATION_SETTINGS.instructions,
    });
  });

  it('recovers from corrupted payloads', async () => {
    const store = new MemoryLocalKeyValueStore();
    await store.set(STORAGE_KEY, '{not-json');

    await expect(loadPersonalizationSettings(store)).resolves.toEqual(
      DEFAULT_PERSONALIZATION_SETTINGS,
    );
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
