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
        settings({ characteristics: { warmth: false, traits: ['  ', ''], conciseFirst: false } }),
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

  it('emits no tone line for the explicit default base style', () => {
    const context = buildLocalPersonalizationContext(
      settings({
        baseStyle: { tone: 'default' },
        characteristics: { warmth: true, traits: [], conciseFirst: false },
      }),
    );

    expect(context).not.toBeNull();
    expect(context).toContain('warm and personable');
    expect(context).not.toContain('friendly');
  });

  it('compiles characteristics independently of the base style', () => {
    const context = buildLocalPersonalizationContext(
      settings({
        characteristics: { warmth: true, traits: ['讲话简短', '喜欢举一反三'], conciseFirst: true },
      }),
    );

    expect(context).toContain('warm and personable');
    expect(context).toContain('讲话简短');
    expect(context).toContain('喜欢举一反三');
    expect(context).toContain('short answers');
  });

  it('compiles custom instructions as free text', () => {
    const context = buildLocalPersonalizationContext(
      settings({ instructions: '讲话风骚幽默、引人联想' }),
    );

    expect(context).toContain('讲话风骚幽默、引人联想');
    expect(context).toContain('user instructions');
  });

  it('always appends the precedence note so the current user message can override the style', () => {
    const context = buildLocalPersonalizationContext(
      settings({ baseStyle: { tone: 'professional' } }),
    );

    expect(context).toContain('follow the current user message');
  });
});
