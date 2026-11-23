# Logo hero — the steel wordmark on login

The top of the **/login** access card now shows The Glastonbury Group wordmark in polished steel, rendered in Blender with real studio reflections on pure black (Nov 2026, the same scene as the Command Center dashboard hero). It plays once (about 3 seconds) and holds on the finished logo. It takes the place of the small "The Glastonbury Group" eyebrow text, which comes back if the flag is off.

## How it works

- `src/components/brand/LogoHero.tsx` renders a `<picture>`: `public/logo-hero.webp` (animated WebP with transparency, 840×310 at 12 fps, ~220 KB, ANIM loop count 1 = play once) with `public/logo-hero-poster.webp` (the final frame, ~22 KB) swapped in under `prefers-reduced-motion`.
- WebP, not MP4, on purpose: the middleware's static-asset rule already lets root-level images through without a session, and video extensions are not on that list. The middleware is unchanged.
- The WebP carries real transparency (black keyed out from the render), so it sits on the card with no visible box. `mix-blend-mode` was tried first and does not work inside the frosted card (its backdrop-filter isolates blending).

## Feature flag

`NEXT_PUBLIC_FEATURE_LOGO_HERO` — on by default. Set it to `false` and rebuild to go back to the eyebrow text.

## Test

`e2e/logo-hero.spec.ts`: both files are public `image/webp`; the animation's loop count is 1; /login shows the wordmark (named "The Glastonbury Group") above the heading with no console errors.
