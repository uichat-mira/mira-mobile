import {
  DEFAULT_PERSONALIZATION_SETTINGS,
  type PersonalizationSettings,
} from '../settings/personalizationSettings';
import { buildLocalPersonalizationContext } from './localPersonalizationContext';

const settings = (
  overrides: Partial<PersonalizationSettings> = {},
): PersonalizationSettings => ({
  baseStyle: { tone: 'default', ...overrides.baseStyle },
  characteristics: {
    ...DEFAULT_PERSONALIZATION_SETTINGS.characteristics,
    ...overrides.characteristics,
  },
  instructions: overrides.instructions ?? '',
});

describe('buildLocalPersonalizationContext', () => {
  it('returns null for default settings', () => {
    expect(buildLocalPersonalizationContext(DEFAULT_PERSONALIZATION_SETTINGS)).toBeNull();
  });

  it('returns null for empty traits and blank instructions', () => {
    expect(
      buildLocalPersonalizationContext(
        settings({ characteristics: { traits: ['  ', ''] } }),
      ),
    ).toBeNull();
  });

  it('compiles an explicitly chosen friendly base style into a tone line', () => {
    const context = buildLocalPersonalizationContext(
      settings({ baseStyle: { tone: 'friendly' } }),
    );

    expect(context).not.toBeNull();
    expect(context).toContain('friendly');
  });

  it('compiles professional and concise base styles', () => {
    expect(
      buildLocalPersonalizationContext(settings({ baseStyle: { tone: 'professional' } })),
    ).toContain('professional');
    expect(
      buildLocalPersonalizationContext(settings({ baseStyle: { tone: 'concise' } })),
    ).toContain('concise');
  });

  it('compiles Traits as additive preferences that do not replace Base style', () => {
    const context = buildLocalPersonalizationContext(
      settings({
        baseStyle: { tone: 'professional' },
        characteristics: { traits: ['多用类比', '给出反例'] },
      }),
    );

    expect(context).toContain('professional');
    expect(context).toContain('additional traits without replacing the base style');
    expect(context).toContain('多用类比');
    expect(context).toContain('给出反例');
  });

  it('compiles custom instructions as free text', () => {
    const context = buildLocalPersonalizationContext(
      settings({ instructions: '保持克制' }),
    );

    expect(context).toContain('保持克制');
    expect(context).toContain('user instructions');
  });

  it('always appends the precedence note so the current user message can override the style', () => {
    const context = buildLocalPersonalizationContext(
      settings({ baseStyle: { tone: 'professional' } }),
    );

    expect(context).toContain('follow the current user message');
  });
});
