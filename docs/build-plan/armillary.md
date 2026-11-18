# Armillary — the 3D instrument on login and the dashboard

The armillary from the Telos page (a Blender-made instrument of platinum rings around a sunrise-orange core, with orbs on tilted orbits) now appears in two places. On **/login** it fills the background behind the access-code card, with plain gold and platinum orbs and no data, since nobody is signed in yet. On the **dashboard**, the Wealth Breakdown card shows it with one orb per piece of net worth (CR3 Franchise, Miami Shores, Investment Portfolio, Anthropic RSUs, Cash), sized and lit by its share of the total from `/api/wealth`, the same numbers as the bar and legend below it. The biggest piece sits on the innermost orbit. Tapping an orb or a legend row selects that piece and shows its label.

## How it works

- `src/lib/armillary/scene.ts` builds the three.js scene (framework-free). `src/components/armillary/Armillary.tsx` wraps it for React and imports the scene dynamically, so three.js loads only on pages that show it.
- The model is `public/armillary.json` (the `.glb` as base64, exported by Blender's glTF exporter) and the still is `public/armillary-poster.jpg`. Both are root-level files in `/public`, which the middleware's static-asset rule already serves without a session; the middleware is unchanged.
- The poster shows until the scene is ready and stays up when WebGL is unavailable. The scene pauses when off-screen or in a background tab, renders still frames under `prefers-reduced-motion`, and lowers the pixel ratio on very large canvases.

## Feature flag

`NEXT_PUBLIC_FEATURE_ARMILLARY` — on by default. Set it to `false` and rebuild to hide the instrument on both pages (the dashboard legend keeps working).

## Test

`e2e/armillary.spec.ts`: the model and poster are public; /login shows the instrument; the dashboard card has five orbs with the right shares from a mocked `/api/wealth`, and the legend rows select them.
