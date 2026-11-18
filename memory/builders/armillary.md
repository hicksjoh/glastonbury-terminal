# armillary — 3D instrument on /login and the dashboard Wealth Breakdown

## Status
verified (locally) · PR opened

## Timeline
- Started: 2026-11-18
- Last checkpoint: 2026-11-18
- Finished: 2026-11-18

## Progress
- [x] Wrote Playwright acceptance test first (`e2e/armillary.spec.ts`)
- [x] Scene module `src/lib/armillary/scene.ts` (three@0.160.0, dynamic import)
- [x] React wrapper `src/components/armillary/Armillary.tsx` (poster fallback, flag `NEXT_PUBLIC_FEATURE_ARMILLARY`, default on)
- [x] /login background (decorative, no data)
- [x] Dashboard Wealth Breakdown: orbs from /api/wealth shares; legend rows are buttons that select an orb
- [x] Self-refine 1: hydration mismatch from quotes in an inline `<style>` text child → raw CSS via dangerouslySetInnerHTML
- [x] Self-refine 2: crowded labels in the narrow card → show only the selected orb's label; labels clamped inside the frame; phone login raises the sphere above the card
- [x] `npx tsc --noEmit`, `npm run lint`, `npm run build` green
- [x] Local Playwright run against `next start`: all armillary assertions pass; the run's only console errors come from this sandbox (placeholder Supabase realtime socket, 500s from APIs without credentials)

## Files touched
- e2e/armillary.spec.ts
- src/lib/armillary/scene.ts
- src/components/armillary/Armillary.tsx
- src/app/login/page.tsx
- src/app/page.tsx
- public/armillary.json, public/armillary-poster.jpg
- package.json, package-lock.json (three, @types/three)
- docs/build-plan/armillary.md

## Notes
- No API routes, no middleware or schema changes. The model is served as a root-level `.json` because the middleware's static-asset regex has no `.glb`.
- The dashboard e2e swaps the PWA service worker for an empty one (context route on `/sw.js`); the real worker answers `/api/wealth` itself, past `page.route`.

## Open questions
- None.
