# Glastonbury Terminal — Design System

> **North star:** Afrofuturist Quiet Luxury. Wakanda meets Goldman.
> Deep obsidian ground, warm cream ink, one restrained gold accent,
> JetBrains Mono for numeric density. No purple SaaS accents, no neon glows,
> no gradient logos, no "AI orb" bling.

This system lives in three places, in strict order of authority:

1. **`src/lib/design-tokens.ts`** — the source of truth. Every color, radius,
   type size, motion curve begins here.
2. **`tailwind.config.ts`** — Tailwind's `theme.extend` reads from tokens so
   utility classes stay in lockstep with the token file.
3. **`src/app/globals.css`** — publishes CSS custom properties for legacy
   inline styles that haven't been migrated yet.

Components import from `@/lib/design-tokens` directly. **Never** hardcode
a hex, a radius, or a millisecond duration in a component.

---

## What we retired (drift catalog)

Grep over `src/**/*.{ts,tsx,css}` on `2026-08-02` surfaced this drift:

| Token                | Occurrences | Verdict                                                                  |
| -------------------- | ----------- | ------------------------------------------------------------------------ |
| `#f0c674` gold       | 244         | **Retire.** Fork of spec-official `#c9a84c`. Repurposed as `warning`. |
| `#8a5cf6` purple     | 209         | **Retire.** Generic SaaS. AI accents now use `color.gold`.               |
| `#c9a84c` gold       | 122         | **Keep.** Spec-official. Now the *only* brand gold.                      |
| `#1a1a24` / `#1e1e35`| 340+ combined | **Collapse.** One surface: `color.surface = #12121A`.                 |
| Border radii 2/3/6/10/14/16/20 | 500+ | **Collapse to six.** chip / button / card / panel / hero / full.  |
| Inline `style={{}}`  | 3,727       | **Migrate.** 50:1 vs `className`. Not urgent — showcase pages first.     |

---

## Tokens

### Color

Names describe **semantic role**, not hue.

```ts
color.bg           // #08080D — page ground
color.surface      // #12121A — raised card
color.surfaceHigh  // #1C1C26 — modal / popover
color.surfaceMuted // #0F0F16 — inset panel
color.border       // #2A2A34
color.borderStrong // #3D3D48 (hover / active)
color.borderFaint  // #1E1E28

color.text         // #EDEBE4 — warm off-white, NOT pure white
color.textMuted    // #8A8A96
color.textDim      // #5A5A64
color.textFaint    // #3D3D48

color.gold         // #C9A84C — THE brand accent
color.goldHover    // #D9B85C
color.goldSubtle   // rgba(201, 168, 76, 0.12)
color.goldEmphasis // rgba(201, 168, 76, 0.24)

color.positive     // #4ADE80 — P&L green
color.negative     // #F87171 — P&L red
color.warning      // #F0C674 — was the drift gold, now warning-only
color.info         // #22D3EE
color.danger       // #B85C4E — claret for destructive confirm (NOT P&L red)

color.glassLo/Md/Hi   // rgba(255,255,255, 0.02/0.04/0.06)
color.shadowLo/Md/Hi  // rgba(0,0,0, 0.20/0.30/0.50)
```

### Typography

Three faces, all loaded via `next/font` in `src/app/layout.tsx`:

- **Inter** (sans) — UI + body
- **Fraunces** (serif) — editorial voice: Keisha memos, briefings, coach reviews
- **JetBrains Mono** (mono) — numbers, tickers, code, latency chips

Type scale (line-height baked in):

```
micro   10/14   — timestamps, ARIA labels
label   11/16   — section eyebrows, chip text
body    12/18   — dense body
bodyLg  13/20   — main paragraph body
base    14/22   — default UI text
subhead 16/24   — card / section title
h3      20/28
h2      24/32
h1      32/40
hero    40/48
metric  28/32   — big P&L / net-worth numbers
```

Weights: `regular 400` · `medium 500` · `semibold 600` · `bold 700` ·
`extrabold 800` (reserved for the single largest metric on a page).

Tracking: `tight -0.02em` · `normal 0` · `loose 0.04em` ·
`eyebrow 0.08em uppercase`.

### Spacing

4-px base rhythm: `0 · 2 · 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80`.
Replaces the `20px 22px` / `16px 18px` / `32px 36px` inline drift.

### Radius

Canonicalized to six values:

```
chip   4    — chips, pills, tags
button 8    — buttons, inputs
card   12   — default card
panel  16   — panels / sheets
hero   20   — hero card, artifact frame
full   999  — status dots, avatars, capsule buttons
```

### Elevation

Composite of border + shadow + optional gold ring:

- `flat` — inset panels
- `card` — default
- `cardHover` — hover / focused
- `raised` — dropdowns, floating cards
- `modal` — dialogs
- `aiAccent` — AI surfaces (Keisha reply, agent trace, streaming card)

### Motion

Durations: `fast 120ms` · `base 200ms` · `slow 400ms` · `languid 800ms`.
Easings: `settle cubic-bezier(0.16,1,0.3,1)` (expo-out — the finance "settle"),
`default cubic-bezier(0.4,0,0.2,1)`, `inOut cubic-bezier(0.4,0,0.6,1)`.

### Z-index

`base 0` · `raised 10` · `sticky 100` · `sidebar 500` · `header 600` ·
`dropdown 1000` · `modal 5000` · `toast 8000` · `voiceOrb 9000` · `tooltip 9500`.

---

## Primitives

Every UI concern below has exactly one primitive. Do not fork.

| Primitive              | Purpose                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| `<Card>`               | Default card surface — border + radius + shadow                                  |
| `<HeroCard>`           | Big-format hero (net worth, primary metric)                                      |
| `<MetricTile>`         | KPI + delta + sparkline slot                                                     |
| `<PillBadge>`          | Chip w/ tone (`positive` · `negative` · `warning` · `info` · `gold`)             |
| `<StatusDot>`          | Live/idle dot                                                                    |
| `<ChatBubble>`         | User (gold-tinted) or Assistant (surface) bubble                                 |
| `<StreamingIndicator>` | Shimmer + three-dot cursor for in-flight Claude tokens                           |
| `<ModelBadge>`         | "Opus 4.7" / "Sonnet 4.6" / "Haiku 4.5" pill w/ latency + cost                   |
| `<AgentTrace>`         | Collapsible tool-use trace (each step is a `<Card>` with a `<ModelBadge>`)       |
| `<EditorialProse>`     | Wraps long-form Keisha output in Fraunces + generous leading                     |
| `<HairlineTable>`      | Dense grid-row data table — micro mono header, faint hairline separators, glassLo hover, tabular mono numerics |

Import path: `@/components/ui/*`.

---

## AI surfaces (Claude-inspired patterns)

Selective adoption from Claude.ai / Artifacts:

- **Streaming cursor**: three dots pulsing at 200ms, easing `settle`.
- **Agent trace**: expandable tool-use log, one card per turn, each with a
  `ModelBadge` showing which model handled the step.
- **Artifact frame**: `radius.hero + elevation.aiAccent` for anything Keisha
  *generates* (memo, chart, table).
- **Voice orb**: single gold pulse, no rainbow / no ripples.

Nothing else from Claude.ai. Terminal is a Bloomberg, not a chat app.

---

## Migration order (6-PR foundation plan)

1. **PR #1** (this one) — tokens + primitives + dashboard + Keisha showcase.
2. PR #2 — Command palette + right sidebar migration.
3. PR #3 — Portfolio / positions / positions detail.
4. PR #4 — Earnings + research pages.
5. PR #5 — Coach + Storm + Debate.
6. PR #6 — Codemod to purge remaining raw hex/px from inline styles.

Ban list going forward (grep the PR):

- Any hex not defined in `design-tokens.ts`
- Purple `#8a5cf6`
- Drift gold `#f0c674` (outside the one `warning` re-use)
- Border radius outside `chip/button/card/panel/hero/full`
- `Inter, sans-serif` inline (use `font.sans`)

---

Last updated: 2026-08-02.
