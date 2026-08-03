/**
 * Glastonbury Terminal — Design Tokens
 *
 * Single source of truth for color, typography, spacing, radius, elevation,
 * and motion. Consumed by:
 *   - `tailwind.config.ts` (theme.extend)
 *   - `src/app/globals.css` (:root CSS vars, kept as fallback + for legacy inline styles)
 *   - `src/components/ui/*` primitives (import from here directly)
 *
 * Brand direction — "Afrofuturist Quiet Luxury" per TERMINAL-DESIGN-AND-QA.md.
 * Wakanda meets Goldman. Deep obsidian ground, warm cream ink, one restrained
 * gold accent, JetBrains Mono for numeric density. NO purple SaaS accent,
 * NO neon glows.
 *
 * Retired from the pre-2026 drift:
 *   - `#f0c674` (secondary gold — a fork, not a shade of the spec `#c9a84c`)
 *   - `#8a5cf6` (purple — reads as generic SaaS; replaced by gold for AI accents)
 *   - Duplicate greys `#1a1a24` vs `#1e1e35`, `#e8e8e8` vs `#e8e8f0`
 *
 * When adding a value: add it here, run the codemod (or migrate by hand for
 * one showcase page), and delete the raw hex from inline styles.
 */

// ── Color ────────────────────────────────────────────────────────────────
// Names describe SEMANTIC role, not hue. `bg` may be dark today; if we ever
// ship a light mode it stays `bg`.
export const color = {
  // Surfaces (dark → light)
  bg:            '#08080D',  // page ground (near-black w/ warmth vs pure #000)
  surface:       '#12121A',  // raised card
  surfaceHigh:   '#1C1C26',  // elevated (modal, popover)
  surfaceMuted:  '#0F0F16',  // sunken (inset panels)

  // Borders
  border:        '#2A2A34',  // default 1px hairline
  borderStrong:  '#3D3D48',  // hover / active card outline
  borderFaint:   '#1E1E28',  // barely-there dividers

  // Text
  text:          '#EDEBE4',  // warm off-white (Afrofuturist cream, NOT #FFF)
  textMuted:     '#8A8A96',  // secondary copy
  textDim:       '#5A5A64',  // captions, timestamps
  textFaint:     '#3D3D48',  // disabled

  // Brand accent — the ONE gold. All AI/interactive accents use this.
  gold:          '#C9A84C',  // spec-official gold (retired the drift #f0c674)
  goldHover:     '#D9B85C',
  goldSubtle:    'rgba(201, 168, 76, 0.12)',
  goldEmphasis:  'rgba(201, 168, 76, 0.24)',

  // Semantic — data & state
  positive:      '#4ADE80',  // P&L green
  positiveSubtle:'rgba(74, 222, 128, 0.12)',
  negative:      '#F87171',  // P&L red
  negativeSubtle:'rgba(248, 113, 113, 0.12)',
  warning:       '#F0C674',  // was the drift gold — now dedicated warning color
  warningSubtle: 'rgba(240, 198, 116, 0.12)',
  info:          '#22D3EE',  // cyan (kept from drift — genuinely useful for tags)
  infoSubtle:    'rgba(34, 211, 238, 0.12)',
  danger:        '#B85C4E',  // claret — for destructive confirmation, NOT p&l red

  // Glass overlays (canonicalized from the rgba(255,255,255,0.02-0.06) drift)
  glassLo:       'rgba(255, 255, 255, 0.02)',
  glassMd:       'rgba(255, 255, 255, 0.04)',
  glassHi:       'rgba(255, 255, 255, 0.06)',

  // Shadow black
  shadowLo:      'rgba(0, 0, 0, 0.20)',
  shadowMd:      'rgba(0, 0, 0, 0.30)',
  shadowHi:      'rgba(0, 0, 0, 0.50)',
} as const;

// ── Typography ───────────────────────────────────────────────────────────
// Three faces (loaded via next/font in app/layout.tsx):
//   - Inter (sans)         — UI + body
//   - Fraunces (serif)     — editorial voice (Keisha long-form: memos, briefings, coach reviews)
//   - JetBrains Mono (mono)— numbers, tickers, code, latency chips
export const font = {
  sans:  'var(--font-sans), Inter, system-ui, -apple-system, sans-serif',
  serif: 'var(--font-serif), Fraunces, Georgia, "Times New Roman", serif',
  mono:  'var(--font-mono), "JetBrains Mono", Menlo, Consolas, monospace',
} as const;

// Type scale — collapsed from the 10-40+ pixel-perfect drift into a
// modular scale. Terminal density → base is 13 (not 16). Line-height baked in.
export const size = {
  micro:   { fontSize: 10, lineHeight: 14 },  // timestamps, ARIA labels
  label:   { fontSize: 11, lineHeight: 16 },  // section eyebrows, chip text
  body:    { fontSize: 12, lineHeight: 18 },  // dense body
  bodyLg:  { fontSize: 13, lineHeight: 20 },  // main paragraph body
  base:    { fontSize: 14, lineHeight: 22 },  // default UI text
  subhead: { fontSize: 16, lineHeight: 24 },  // card/section title
  h3:      { fontSize: 20, lineHeight: 28 },
  h2:      { fontSize: 24, lineHeight: 32 },
  h1:      { fontSize: 32, lineHeight: 40 },
  hero:    { fontSize: 40, lineHeight: 48 },
  metric:  { fontSize: 28, lineHeight: 32 },  // big P&L / net-worth numbers
} as const;

export const weight = {
  regular: 400,
  medium:  500,
  semibold: 600,
  bold:    700,
  extrabold: 800,  // reserved for the single largest metric on a page
} as const;

export const tracking = {
  tight:    '-0.02em',   // hero / metric
  normal:   '0',
  loose:    '0.04em',    // labels
  eyebrow:  '0.08em',    // uppercase section eyebrows
} as const;

// ── Spacing (4-px base rhythm) ───────────────────────────────────────────
// Replaces the '20px 22px' / '16px 18px' / '32px 36px' inline drift.
export const space = {
  0: 0,
  0.5: 2,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
} as const;

// ── Radius ───────────────────────────────────────────────────────────────
// Canonicalized from the 2/3/4/6/8/10/12/14/16/20 drift. Six values only.
export const radius = {
  chip:   4,    // chips, pills, tags
  button: 8,    // buttons, inputs
  card:   12,   // default card
  panel:  16,   // panels / sheets
  hero:   20,   // hero card, artifact frame
  full:   999,  // status dots, avatars, capsule buttons
} as const;

// ── Elevation ────────────────────────────────────────────────────────────
// Composite: border + shadow + optional gold ring for AI accent
export const elevation = {
  flat: {
    border: `1px solid ${color.borderFaint}`,
    boxShadow: 'none',
  },
  card: {
    border: `1px solid ${color.border}`,
    boxShadow: `0 1px 2px ${color.shadowLo}`,
  },
  cardHover: {
    border: `1px solid ${color.borderStrong}`,
    boxShadow: `0 4px 12px ${color.shadowMd}`,
  },
  raised: {
    border: `1px solid ${color.border}`,
    boxShadow: `0 8px 24px ${color.shadowMd}`,
  },
  modal: {
    border: `1px solid ${color.borderStrong}`,
    boxShadow: `0 24px 64px ${color.shadowHi}`,
  },
  aiAccent: {
    border: `1px solid ${color.gold}40`,      // gold @ 25% opacity
    boxShadow: `0 0 0 1px ${color.goldSubtle}, 0 8px 24px ${color.shadowMd}`,
  },
} as const;

// ── Motion ───────────────────────────────────────────────────────────────
// Consolidates the ad-hoc 150ms/200ms/400ms/600ms/1.5s/1.2s durations across
// count-ups, shimmer, pulse, bounce, blink, cubic-bezier stroke.
export const motion = {
  duration: {
    fast:   120,   // hover, focus ring
    base:   200,   // most transitions
    slow:   400,   // count-up, progress ring
    languid: 800,  // hero entrance
  },
  easing: {
    // Expo-out — satisfying "settle" for finance UI
    settle: 'cubic-bezier(0.16, 1, 0.3, 1)',
    // Standard material-style ease
    default: 'cubic-bezier(0.4, 0, 0.2, 1)',
    // In-out for pulses/loops
    inOut: 'cubic-bezier(0.4, 0, 0.6, 1)',
  },
} as const;

// ── Z-index ──────────────────────────────────────────────────────────────
export const z = {
  base:      0,
  raised:    10,
  sticky:    100,
  sidebar:   500,
  header:    600,
  dropdown:  1000,
  modal:     5000,
  toast:     8000,
  voiceOrb:  9000,   // always on top
  tooltip:   9500,
} as const;

// ── Semantic tokens (compose primitives above) ───────────────────────────
export const semantic = {
  chatBubbleUser: {
    background: color.goldSubtle,
    border: `1px solid ${color.gold}30`,
    color: color.text,
    borderRadius: `${radius.panel}px ${radius.panel}px ${radius.chip}px ${radius.panel}px`,
  },
  chatBubbleAssistant: {
    background: color.surface,
    border: `1px solid ${color.border}`,
    color: color.text,
    borderRadius: `${radius.panel}px ${radius.panel}px ${radius.panel}px ${radius.chip}px`,
  },
  metricValue: {
    fontFamily: font.mono,
    fontSize: size.metric.fontSize,
    lineHeight: size.metric.lineHeight,
    fontWeight: weight.bold,
    letterSpacing: tracking.tight,
    color: color.gold,
  },
  sectionEyebrow: {
    fontSize: size.label.fontSize,
    fontWeight: weight.semibold,
    letterSpacing: tracking.eyebrow,
    textTransform: 'uppercase' as const,
    color: color.textMuted,
  },
} as const;

// ── Aliases for legacy code (temporary — remove after full migration) ────
// So a pre-existing `color.gold` in a component keeps working during migration.
export const legacyAlias = {
  '#f0c674': color.warning,      // was drift gold, now warning-only
  '#8a5cf6': color.gold,         // purple SaaS → brand gold
  '#1e1e35': color.surface,
  '#1a1a24': color.surface,
  '#e8e8f0': color.text,
  '#e8e8e8': color.text,
  '#6b6b80': color.textDim,
  '#8888a8': color.textMuted,
  '#555570': color.textDim,
} as const;
