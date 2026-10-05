import type { BaseStyleTone, PersonalizationSettings } from '../settings/personalizationSettings';

// This compiler turns the persisted Personalization settings into a single
// Local-AI-only system context. It is deliberately pure: no storage, no
// network, no Remote Host awareness. Anything that is not a stable expression
// preference is intentionally excluded so Personalization cannot influence
// tool permissions, credentials, or runtime capability.

// Every real Base style is a user choice and compiles to a tone line. `default`
// is the explicit "no Base style chosen" state and emits no tone line.
const BASE_STYLE_TONE_LABELS: Record<Exclude<BaseStyleTone, 'default'>, string> = {
  friendly: 'Use a friendly, approachable tone.',
  professional: 'Use a clear, professional tone.',
  concise: 'Be concise and direct; lead with the answer.',
};

const BASE_STYLE_PREAMBLE = 'Apply the following personalization to how you respond.';
const INSTRUCTIONS_PREAMBLE = 'Additionally, follow these user instructions:';
// Always appended when a personalization context is emitted: an explicit
// instruction in the current user message must win over the stored style
// preference. The runtime never rewrites storage to honour this; precedence
// stays request-local.
const PRECEDENCE_NOTE =
  'If the current user message conflicts with the above style preferences, follow the current user message.';

const normalizeText = (value: string): string => value.trim();

/**
 * Compile the local Personalization settings into a Local-AI-only system
 * context string, or `null` when the settings carry no meaningful signal.
 *
 * Default settings (explicit `default` tone, no characteristics, no
 * instructions) compile to `null`, so an unconfigured user never gets a noisy
 * prompt. When a context is produced, it always ends with a precedence note so
 * the current user message can override the stored style.
 */
export function buildLocalPersonalizationContext(
  settings: PersonalizationSettings,
): string | null {
  const lines: string[] = [];

  const tone = settings.baseStyle.tone;
  if (tone !== 'default') {
    lines.push(BASE_STYLE_TONE_LABELS[tone]);
  }

  const { warmth, traits, conciseFirst } = settings.characteristics;
  if (warmth) lines.push('Be warm and personable.');
  if (conciseFirst) lines.push('Prefer short answers unless more detail is needed.');

  const normalizedTraits = traits.map(normalizeText).filter((trait) => trait.length > 0);
  if (normalizedTraits.length > 0) {
    lines.push(`Keep these traits: ${normalizedTraits.join('; ')}.`);
  }

  const instructions = normalizeText(settings.instructions);
  if (instructions) {
    lines.push(INSTRUCTIONS_PREAMBLE);
    lines.push(instructions);
  }

  if (lines.length === 0) return null;

  return [BASE_STYLE_PREAMBLE, ...lines, PRECEDENCE_NOTE].join('\n');
}
