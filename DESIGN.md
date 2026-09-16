# UIChat Mira Mobile Design System

This file is the single visual design reference for the mobile app. It consolidates the former brand, principle, color, typography, spacing, icon, shape, component, and usage documents.

`src/theme/tokens.ts` is the canonical runtime token source. `tailwind.config.js` currently exposes compatibility aliases for existing screens; new work should use the canonical names documented here. When a feature task includes a visual reference, the task defines the feature-specific interaction and information hierarchy; this document defines the reusable visual language.

Last consolidated: 2026-09-03.

## Product Identity

| Item | Value |
|---|---|
| User-facing name | `UIChat Mira` |
| Compact name | `Mira` |
| Android application ID | `io.tomz.mira.mobile` |
| iOS Bundle ID | `io.tomz.mira.mobile` |
| Pairing deep link | `mira://pair` |
| Primary icon library | `lucide-react-native` |

The full name `UIChat Mira` is used on first appearance, stores, launch surfaces, and primary brand text. Internal project and React Native module names are not user-facing brand names.

Logo assets are kept in `ios/UIChatMira/Images.xcassets/AppIcon.appiconset/` and the Android mipmap resources. The logo uses a fixed `#f5f4ed` square canvas, is not stretched or rotated, and does not change for dark mode.

## Design Principles

- Keep the interface quiet, warm, and focused. Use breathing room and surface contrast instead of decorative effects.
- Prefer one restrained coral accent for primary actions and selected states; do not use it as a large page background.
- Design for mobile reachability: minimum touch target is 44x44pt, important flows use single-column layouts, and bottom input areas respect the Home Indicator.
- Make connection, loading, retry, success, and failure states visible and actionable. Do not hide errors in logs only.
- Verify text and control contrast before shipping, support Dynamic Type-compatible sizing, label icon-only controls, and provide clear pressed/disabled states.
- Maintain separate light and dark surface systems. Do not produce dark mode by blindly inverting light colors.
- Prefer stable dimensions for controls, boards, rows, and input areas so dynamic labels do not move surrounding content.

## Color Tokens

### Light and brand

| Token | Value | Use |
|---|---|---|
| `colors.primary` | `#c96442` | Primary actions, send, selected state, brand emphasis |
| `colors.primaryActive` | `#a95034` | Pressed state |
| `colors.primaryDisabled` | `#e8e6dc` | Disabled action background |
| `colors.onPrimary` | `#faf9f5` | Text/icons on primary |
| `colors.bg.canvas` | `#f5f4ed` | Main page canvas |
| `colors.bg.soft` | `#e8e6dc` | Subtle section and message separation |
| `colors.bg.card` | `#faf9f5` | Raised card and input surface |
| `colors.bg.input` | `#faf9f5` | Composer/input background |
| `colors.bg.bubble` | `#e8e6dc` | Optional separated message surface |
| `colors.text.ink` | `#141413` | Headings and highest-contrast text |
| `colors.text.base` | `#3d3d3a` | Body text |
| `colors.text.strong` | `#252523` | Emphasis |
| `colors.text.muted` | `#5e5d59` | Secondary text |
| `colors.text.soft` | `#87867f` | Placeholder and tertiary text |
| `colors.border.default` | `#e8e6dc` | Card/input border |
| `colors.border.soft` | `#f0eee6` | Light divider |

### Dark surfaces

| Token | Value | Use |
|---|---|---|
| `colors.dark.surface` | `#181715` | Dark section/background |
| `colors.dark.elevated` | `#252320` | Elevated dark surface |
| `colors.dark.soft` | `#1f1e1b` | Secondary dark section |
| `colors.dark.onDark` | `#faf9f5` | Primary text on dark |
| `colors.dark.onDarkSoft` | `#a09d96` | Secondary text on dark |

Dark surfaces rely on neutral value contrast. The logo and system icon remain on the fixed light brand canvas.

### Status and semantic colors

Use status colors only for their semantic meaning and verify contrast in both themes. Never communicate a state by color alone: pair it with text, an icon, shape, or layout change. Status colors are generally for icons, indicators, short labels, and surfaces; they are not default body-text colors.

For normal text, target at least 4.5:1 contrast; for large text, target at least 3:1. Non-text controls and meaningful state indicators should target at least 3:1 against adjacent colors. If a status token does not meet those targets on a given surface, use a stronger text token or a dedicated accessible variant.

| Token | Value | Use |
|---|---|---|
| `colors.status.success` | `#5db872` | Connected/success |
| `colors.status.warning` | `#d4a017` | Connecting/reconnecting |
| `colors.status.error` | `#c64545` | Error/disconnected |
| `colors.status.errorBg` | `#fce8e8` | Error surface |
| `colors.accent.teal` | `#5db8a6` | Code/chart accent |
| `colors.accent.amber` | `#e8a55a` | Code/chart accent |

Legacy aliases in `tokens.ts` and the older `mira-*` Tailwind names remain for compatibility. New code should use the canonical nested tokens above and must not introduce another alias family. Until the Tailwind palette is synchronized, do not assume a Tailwind status color has the same value as its runtime counterpart.

## Typography

Use the runtime values from `src/theme/tokens.ts`. The canonical scale is `displayLg`, `displaySm`, `titleXl`, `titleLg`, `titleMd`, `bodyMd`, `button`, `caption`, `captionUppercase`, and `code`. The older `xs` through `4xl` names are compatibility aliases and are not interchangeable with the canonical names. Letter spacing is `0` by default; do not add negative or ad hoc tracking in components.

| Token | Size | Typical use |
|---|---:|---|
| `fontSize.displayLg` | 64px | Rare display treatment |
| `fontSize.displaySm` | 40px | Large section heading |
| `fontSize.titleXl` | 28px | Welcome/page title |
| `fontSize.titleLg` | 20px | Card or screen title |
| `fontSize.titleMd` | 17px | Navigation/list title |
| `fontSize.bodyMd` | 16px | Body paragraph |
| `fontSize.button` | 14px | Button and navigation label |
| `fontSize.caption` | 13px | Supporting text |
| `fontSize.captionUppercase` | 12px | Compact metadata label |
| `fontSize.code` | 13px | Code block |

Line-height tokens are `body: 1.6`, `title: 1.3`, and `tight: 1.2`. Use 400 for body, 600 for list/button emphasis, and 700 for primary headings. Prefer the canonical runtime tokens when a Tailwind alias would obscure the intended size.

## Spacing and Layout

The spacing scale follows a 4px baseline:

| Token | Value | Use |
|---|---:|---|
| `spacing.xs` | 4px | Icon/text gap |
| `spacing.sm` | 8px | Compact control padding |
| `spacing.md` | 12px | Standard component gap |
| `spacing.lg` | 16px | Page/message inset |
| `spacing.xl` | 24px | Large module gap |
| `spacing.section` | 32px | Section separation |

Layout rules:

- Wrap screens in Safe Area handling and reserve space for the Home Indicator.
- Keep primary lists single-column and reachable with one hand.
- List rows are at least 64px high; when a 48px avatar is present, text begins at a 76px divider inset.
- Text inputs are at least 40px high and may grow to 120px for multiline composition.
- Bottom composers should remain stable while the keyboard moves content above them.
- Fixed-format controls use explicit dimensions or stable aspect ratios.

## Shape and Elevation

| Token | Value | Use |
|---|---:|---|
| `radius.sm` | 8px | Small controls and avatars |
| `radius.md` | 12px | Inputs and standard cards |
| `radius.lg` | 16px | Card containers |
| `radius.xl` | 20px | Large containers and inputs |
| `radius.full` | 9999px | Pills and circular buttons |

Prefer thin borders and surface contrast over shadows. Shadows are reserved for genuinely floating elements:

```ts
shadows.fab = {
  shadowColor: '#c96442',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.15,
  shadowRadius: 6,
  elevation: 3,
}
```

Message shape:

- User messages are right-aligned with an ink `#141413` surface, warm-white text, 18px corners, and a 6px lower-right corner.
- Assistant messages are left-aligned on the canvas without a surrounding bubble border.

## Iconography

Use Lucide React Native. Default stroke width is 2; use 2.5 only for emphasis. Keep icon sizes stable within the same context and pair important icon actions with text labels.

| Action | Icon | Size |
|---|---|---:|
| Back | `ChevronLeft` | 24px |
| Settings/configuration | `Settings` | 22px |
| Add/new | `Plus` | 24px |
| Send | `Send` | 20px |
| Connected/disconnected | `Wifi` / `WifiOff` | 16px |
| Delete | `Trash2` | 20px |
| More | `MoreVertical` | 20px |

Do not use emoji as interface icons. Unfamiliar icon-only controls require an accessible label and tooltip/help text where the platform supports it.

## Core Components

### Session list item

- 48x48px avatar/icon with 8px corners.
- 16px semibold single-line title with truncation.
- 12px muted timestamp.
- 14px muted one-line preview.
- Hairline divider beginning at the text column.

### Chat content

- User message: right-aligned ink surface, warm-white 15px text, 18px/6px asymmetric corners.
- Assistant message: transparent canvas surface, 15px ink text, 16px horizontal content inset.
- Render Markdown safely. Support KaTeX formulas, Mermaid fenced diagrams, and language-labelled code blocks without executing message HTML, loading remote images automatically, or depending on a CDN.

### Composer

- Warm-white `#faf9f5` input surface with `#e8e6dc` border and `radius.xl` (20px) radius.
- Minimum overall height 52px.
- 44x44px circular primary send button with a `Send` icon.
- Multiline input grows only within its defined maximum height.

### Buttons

| State | Background | Text/icon |
|---|---|---|
| Default | `colors.primary` | `colors.onPrimary` |
| Pressed | `colors.primaryActive` | `colors.onPrimary` |
| Disabled | `colors.primaryDisabled` | muted/disabled contrast |

Use text buttons for clear commands and icon buttons for familiar compact actions. Do not place explanatory feature text inside controls.

### Empty states and configuration surfaces

Empty states use a concise 18px semibold title and 14px muted supporting copy. Configuration surfaces use `colors.bg.card`, `radius.lg` (16px), `spacing.lg` (16px) content inset, and `radius.md` (12px) input radius unless a feature-specific task says otherwise.

## Implementation

Preferred order:

1. Use imported runtime tokens from `src/theme/tokens.ts` for canonical values, dynamic values, and calculations.
2. Use Tailwind classes backed by `mira-*` names when the alias is known to match the canonical token.
3. Use `StyleSheet` only where the existing component or platform API needs it; keep values sourced from runtime tokens.

```tsx
import { Text, View, Pressable } from 'react-native';

<View className="flex-1 bg-mira-canvas p-mira-xl">
  <Text className="font-bold text-mira-ink">Mira</Text>
  <Pressable className="rounded-mira-full bg-mira-primary px-mira-lg py-mira-md">
    <Text className="font-semibold text-mira-on-primary">发送</Text>
  </Pressable>
</View>;
```

When adding a token, update `src/theme/tokens.ts`, then update `tailwind.config.js` and this document in the same change. Do not introduce a one-off color, radius, spacing, type size, or shadow in a feature component when an existing token covers the need. If the Tailwind alias is not synchronized yet, use the runtime token instead of silently choosing a near-match.

## Review Checklist

- Is the user-facing hierarchy clear on a small phone viewport?
- Are touch targets at least 44x44pt and reachable around the keyboard/safe areas?
- Are colors and status states semantic, restrained, and contrast-checked in both themes?
- Are text, icons, borders, and surfaces sourced from canonical tokens?
- Do dynamic labels fit without overlap or layout shifts?
- Are loading, empty, success, error, retry, and offline states visible?
- Does the implementation preserve existing protocol and product boundaries?
