import type { BaseStyleTone, PersonalizationSettings } from '../settings/personalizationSettings';

// This compiler turns the persisted Personalization settings into a single
// Local-AI-only system context. It is deliberately pure: no storage, no
// network, no Remote Host awareness. Anything that is not a stable expression
// preference is intentionally excluded so Personalization cannot influence
// tool permissions, credentials, or runtime capability.

// Base style is a mutually exclusive preset. `default` emits no tone line.
const BASE_STYLE_TONE_LABELS: Record<Exclude<BaseStyleTone, 'default'>, string> = {
  friendly: 'Use a friendly, approachable tone.',
  professional: 'Use a clear, professional tone.',
  concise: 'Be concise and direct; lead with the answer.',
};

const BASE_STYLE_PREAMBLE = 'Apply the following personalization to how you respond.';
const INSTRUCTIONS_PREAMBLE = 'Additionally, follow these user instructions:';
const PRECEDENCE_NOTE =
  'If the current user message conflicts with the above style preferences, follow the current user message.';

const normalizeText = (value: string): string => value.trim();

/**
 * Compile the local Personalization settings into a Local-AI-only system
 * context string, or `null` when the settings carry no meaningful signal.
 *
 * Traits are explicitly additive: they refine the selected Base style rather
 * than acting as a second tone selector.
 */
export function buildLocalPersonalizationContext(
  settings: PersonalizationSettings,
): string | null {
  const lines: string[] = [];

  const tone = settings.baseStyle.tone;
  if (tone !== 'default') {
    lines.push(BASE_STYLE_TONE_LABELS[tone]);
  }

  const normalizedTraits = settings.characteristics.traits
    .map(normalizeText)
    .filter((trait) => trait.length > 0);
  if (normalizedTraits.length > 0) {
    lines.push(
      `Apply these additional traits without replacing the base style: ${normalizedTraits.join('; ')}.`,
    );
  }

  const instructions = normalizeText(settings.instructions);
  if (instructions) {
    lines.push(INSTRUCTIONS_PREAMBLE);
    lines.push(instructions);
  }

  if (lines.length === 0) return null;

  return [BASE_STYLE_PREAMBLE, ...lines, PRECEDENCE_NOTE].join('\n');
}
