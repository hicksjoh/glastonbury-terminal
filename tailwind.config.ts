import type { Config } from 'tailwindcss';
import { color, radius, space, size, weight, motion, tracking, z } from './src/lib/design-tokens';

// Tailwind theme is generated FROM design-tokens.ts. Never add a value here
// that isn't in the token file first. See docs/DESIGN-SYSTEM.md.

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Semantic (preferred going forward)
        bg:            color.bg,
        surface:       color.surface,
        'surface-high':  color.surfaceHigh,
        'surface-muted': color.surfaceMuted,
        border:        color.border,
        'border-strong': color.borderStrong,
        'border-faint':  color.borderFaint,
        text:          color.text,
        'text-muted':    color.textMuted,
        'text-dim':      color.textDim,
        'text-faint':    color.textFaint,
        gold:          color.gold,
        'gold-hover':    color.goldHover,
        'gold-subtle':   color.goldSubtle,
        'gold-emphasis': color.goldEmphasis,
        positive:      color.positive,
        negative:      color.negative,
        warning:       color.warning,
        info:          color.info,
        danger:        color.danger,

        // Legacy aliases — keep the old class names working during migration.
        // Delete these once PR #6 codemod is done.
        terminal:        color.bg,
        'gold-dim':      '#8A6F2E',
        secondary:       color.surface,
        'border-terminal': color.border,
        'text-primary':  color.text,
        'green-terminal': color.positive,
        'red-terminal':  color.negative,
      },
      fontFamily: {
        sans:      ['var(--font-sans)', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        serif:     ['var(--font-serif)', 'Fraunces', 'Georgia', 'serif'],
        mono:      ['var(--font-mono)', 'JetBrains Mono', 'Menlo', 'monospace'],
        terminal:  ['var(--font-sans)', 'Inter', 'sans-serif'], // legacy alias
      },
      fontSize: {
        micro:   [`${size.micro.fontSize}px`,   { lineHeight: `${size.micro.lineHeight}px` }],
        label:   [`${size.label.fontSize}px`,   { lineHeight: `${size.label.lineHeight}px` }],
        body:    [`${size.body.fontSize}px`,    { lineHeight: `${size.body.lineHeight}px` }],
        bodyLg:  [`${size.bodyLg.fontSize}px`,  { lineHeight: `${size.bodyLg.lineHeight}px` }],
        base:    [`${size.base.fontSize}px`,    { lineHeight: `${size.base.lineHeight}px` }],
        subhead: [`${size.subhead.fontSize}px`, { lineHeight: `${size.subhead.lineHeight}px` }],
        h3:      [`${size.h3.fontSize}px`,      { lineHeight: `${size.h3.lineHeight}px` }],
        h2:      [`${size.h2.fontSize}px`,      { lineHeight: `${size.h2.lineHeight}px` }],
        h1:      [`${size.h1.fontSize}px`,      { lineHeight: `${size.h1.lineHeight}px` }],
        hero:    [`${size.hero.fontSize}px`,    { lineHeight: `${size.hero.lineHeight}px` }],
        metric:  [`${size.metric.fontSize}px`,  { lineHeight: `${size.metric.lineHeight}px`, letterSpacing: tracking.tight, fontWeight: `${weight.bold}` }],
      },
      fontWeight: {
        regular:   `${weight.regular}`,
        medium:    `${weight.medium}`,
        semibold:  `${weight.semibold}`,
        bold:      `${weight.bold}`,
        extrabold: `${weight.extrabold}`,
      },
      letterSpacing: {
        tight:   tracking.tight,
        normal:  tracking.normal,
        loose:   tracking.loose,
        eyebrow: tracking.eyebrow,
      },
      spacing: Object.fromEntries(
        Object.entries(space).map(([k, v]) => [k, `${v}px`])
      ),
      borderRadius: {
        chip:   `${radius.chip}px`,
        button: `${radius.button}px`,
        card:   `${radius.card}px`,
        panel:  `${radius.panel}px`,
        hero:   `${radius.hero}px`,
        full:   '9999px',
      },
      transitionDuration: {
        fast:    `${motion.duration.fast}ms`,
        base:    `${motion.duration.base}ms`,
        slow:    `${motion.duration.slow}ms`,
        languid: `${motion.duration.languid}ms`,
      },
      transitionTimingFunction: {
        settle:  motion.easing.settle,
        default: motion.easing.default,
        inOut:   motion.easing.inOut,
      },
      zIndex: Object.fromEntries(
        Object.entries(z).map(([k, v]) => [k, `${v}`])
      ),
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':  'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [],
};

export default config;
