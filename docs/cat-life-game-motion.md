# Ordinary orange-tabby motion · v1.28.0

The approved PR111 rig is now consumed by the real game. Home and the cat profile
use idle/feeding; the player's room uses distance-driven walking. The standalone
preview website is still not copied to `public/` and `window.catPreview` is absent
from the production entry.

## Boundaries

- No Spine runtime/editor or paid software license. PixiJS 8.20.1 is MIT; the
  bundled license and generated-asset provenance remain available.
- Only unlocked, living, unsheltered, non-diseased ordinary orange cats with
  energy above 35 qualify. Other cats, member skins and temporary non-feeding
  care poses retain existing art. Room animation resumes after that pose expires.
- Feeding reads the existing successful interaction receipt. It skips the
  preview's distant approach and plays the 7.6-second bowl sequence. It never
  calls a care action, consumes inventory, or persists animation state.
- Cat and save object identity scope reuse; rerenders retain the canvas and
  feeding timestamp. Room route time is captured before DOM replacement.
- One shared WebGL context, at most three visible rigs, 30 fps, bounded pixel
  resolution, and no painting for offscreen stages after their first frame.
  Background pages stop requesting frames. Reduced motion, `file://`, missing
  assets and WebGL errors retain the original image and working care buttons.
- Runtime and textures are same-origin. CSP remains unchanged: the Pixi CSP
  compatibility module avoids dynamic evaluation and image decoder workers are
  disabled. No CDN, blob worker, production debug controls or telemetry is added.

## Rebuild

Run `npm ci --prefix experiments/orange-cat-preview`, then
`npm run build:game --prefix experiments/orange-cat-preview`. This explicit build
emits only the game runtime, seven approved WebP layers and the MIT license to
`public/games/cat-life/src/vendor/cat-motion/`. It reuses the game's existing bowl.
Commit those generated assets with their sources. CI rebuilds and compares them;
ordinary site builds use the committed output without requiring preview tooling.

The runtime is approximately 603 KB / 179 KB gzip; the seven layers total about
266 KB. It is lazy-loaded when an eligible stage exists, not on unrelated pages.

## Verification

Regression coverage includes real pixel output under the production CSP at
390/1040/1280px, single settlement, nickname/focus preservation, canvas reuse,
skin/state fallbacks, reduced-motion transitions, missing textures, room movement,
reaction-to-room transitions and save replacement. Geometry tests retain paw,
neck, food clearance, mouth and stance invariants from the approved preview.

Real iPhone/Android GPU performance has not been certified. This integration
does not change the save schema (3), Worker, database, room collision policy or
the other cats' animation systems. Production deployment is recorded separately.
