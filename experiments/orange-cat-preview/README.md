# Orange tabby motion study 01

Independent local preview using **PixiJS 8.20.1 + custom lightweight 2D joint control**. It does not use Spine, a Spine runtime, a paid animation editor, or a cloud animation service. PixiJS is MIT licensed; retain its license when redistributing. No claim is made that art creation, development effort or hosting has zero cost.

## Run

```sh
npm ci
npm run dev
npm test
npm run build
```

Run these commands from `experiments/orange-cat-preview/` with Node 22.13+ (or a supported newer Node release). Prepared assets are committed: ImageGen and asset-preparation scripts are not required to run, test or build the preview.

Local port: 4190. This folder is outside the website's `public/` tree. Neither the existing game entrypoint nor its package dependencies import this experiment. No game version, storage, currency, inventory, account, API or save schema changes. A separate path-scoped GitHub Actions workflow installs this folder's dependencies, runs its tests and builds the preview; it does not deploy it.

## Motion scope

- Idle: planted feet, subtle independent chest breathing, ear displacement and a curved seven-point tail chain.
- Walk: one finite leftward clip; an eased root trajectory drives four staggered foot cycles by distance, not frame count. Stance-foot world X is invariant during steady gait. Two-bone IK drives shoulder/hip to ankle; textured limb meshes blend across joint regions.
- Eat: approach, settle, lower neck/head, separated short nibbles with pauses, lift. The bowl and planted feet remain fixed during the feeding phase.
- Paw refinement: preserve the source artwork's round toe cap with uniform scale and a horizontal contact plane; only the upper limb follows the bending chain. Retains the requested thicker legs without shearing the toes into points.
- Feeding refinement: a measured mouth anchor approaches the food surface with clearance; the bowl renders behind the cat instead of masking the muzzle. The head no longer translates downward without a bowl target.
- Visible bites: three timed mouth-open / take-food / close / chew / swallow cycles. A real raster mouth-interior/tongue overlay opens at the existing upper lip; the original eyes, nose, cheeks and bow are never swapped. Three decorative kibble sprites leave the bowl one at a time and disappear inside the open cavity. These are visual portions only; the underlying painted bowl still contains food, and no game inventory is consumed.
- Head/shoulder attachment: the rear-neck landmark is docked inside the shoulder instead of positioning the full head cutout by its image origin. Neutral placement is about 18 rig units rearward and 26 upward from the earlier pose; head rotation now resolves around that neck joint. The bottom neck/bib mesh tapers into the chest without moving the mouth or attachment landmark. Feeding still resolves the mouth to the same bowl target.
- Native HTML controls provide pause, restart, speed, deterministic timeline scrubbing and a skeleton/contact overlay. Hidden tabs pause the ticker; reduced-motion starts paused and allows deliberate playback.

The renderer uses separate torso, head, four limb meshes and a deformable tail. It is not an `AnimatedSprite` slideshow or a translate/rotate animation of the original whole-cat PNG. It is still **2D**, not a true 3D cat.

Out of scope: turning/other viewing angles, sitting transitions, multiple cats, membership skins, game integration, meals consuming inventory and mobile-device certification. Clip changes reset to their respective starting positions; they are preview controls, not transitions promised for game integration.

## Assets

Generated through built-in ImageGen, with the game's existing `orange-tabby-walk.png` as the exact character/style reference. Five requested components: head/short neck with bow, torso, front leg, hind leg, tail. The original reference is not modified. The existing `rooms/furniture-bowl.png` is reused for the bowl, without changing its aspect ratio.

Generated originals returned RGB checkerboard backgrounds, **not actual alpha**. With the user's explicit approval, `scripts/prepare-assets.mjs` removes border-connected neutral background pixels, crops and exports real-alpha WebP layers. Originals remain unchanged; `public/assets/rig-meta.json` records their hashes, dimensions and derived centerlines. The five prepared layers total about 258 KB. Subsequent user feedback widened front limbs from 53 to 69 rig units and hind limbs from 80 to 99; joint trajectories and contact targets are unchanged.

### Prompt set

Shared: identity-preserving, left-facing plump orange tabby; match reference orange stripes, white accents, amber-green eyes and soft painted fur. One complete centered animation component, rounded furry overlap regions, no text, diagrams, shadows, extra parts or gore. Requested transparent alpha with no baked checkerboard.

- Torso: horizontal shoulders-to-rump oval, plump cream lower belly, no head/neck/legs/tail/bow, about 2.1:1 width:height.
- Head: left-facing three-quarter face and short neck, amber-green half-open eyes, white muzzle/chin, pink nose, fine whiskers, ears and small orange bow; rounded lower-right neck overlap.
- Front leg: one nearly straight downward full limb, root at top, white paw pointing left at bottom; continuous striped fur, about 3.4:1 length:middle width.
- Hind leg: one continuous broad thigh, subtle digitigrade hock, white paw pointing left; rounded upper attachment region.
- Tail: one thick striped neutral horizontal tail, base left, cream rounded tip right, mostly straight with gentle curve, about 5:1 length:width.

## Verification status

- 21/21 tests passed: the original eight kinematics checks, toe proportions/floor contact, closed-head and open-mouth bowl clearance, real asset transparency, four deterministic bite timing/seeking tests, and three neck attachment/opaque torso overlap/taper isolation checks.
- Preview JavaScript bundling passed.
- Local WebGL preview checked in-browser: idle, mid-walk, lowering, feeding and lifting, including the thicker limbs and round paw refinement. Timeline scrubbing and action switching work. Product Design visual comparison is recorded in `design-qa.md`; the original paw/position correction reused existing art, while the later visible-bite supplement below added mouth/kibble assets.
- A full responsive matrix, real mobile hardware and production integration remain outside this verification; this is a local motion study for visual feedback.

## Feeding artwork supplement

Built-in ImageGen (not CLI/API fallback) produced the open-mouth reference and a single food pellet. `scripts/prepare-feeding-assets.mjs` derives project-owned `public/assets/mouth-open.webp` and `public/assets/kibble.webp`. `public/assets/feeding-meta.json` records original output names/hashes, the measured crop and upper-lip anchor. Original files are retained; the rest of the cat's face is not replaced. The mouth reference had a printed checkerboard, so only its interior mouth region is used; the kibble output contains real alpha. The previously approved local asset-preparation approach is reused for this integration.

Prompt set:

- **Mouth edit:** same-pose mouth-open texture from the existing head; keep exact framing, head silhouette, eyes, ears, stripes, nose position, orange bow, white fur and painted rendering unchanged. Open only the mouth under the existing nose/muzzle with a small natural feeding gape, warm dark-brown cavity, rounded pink tongue and slightly lowered furry jaw. No yawn, snarl, extra teeth, food or lettering. Preserve the left-facing three-quarter angle and expression; request transparent background. The final implementation uses only the mouth interior/lip crop, scaled down to a feeding-sized opening.
- **Kibble:** one golden-brown rounded dry cat-food pellet matching the supplied bowl artwork; slightly irregular rounded biscuit, shallow thickness, subtle painted porous surface, upper-left highlight, darker lower edge. Single centred cutout, no holes, no ground shadow, no bowl/cat/additional pieces/text. Transparent background, simplified enough for a roughly 12-rig-unit display.

Browser evidence for this supplement: ignored `test-results/paw-feeding/bite-open-t421.png`, `bite-taking-t436.png`, `bite-closed-t473.png`. Actual UI scrubbing verified opening at 4.21 s, food entering at 4.36 s, and closed lips/no airborne food at 4.73 s. Warning/error log check was empty. Existing Product Design QA describes the earlier paw/feeding-position pass; this supplement adds visible mouth motion without redoing that page design.

The subsequent head/shoulder correction was also visually checked in the user's desktop Chrome surface: neutral idle, eating at 5.50 s, and the return-to-neutral pose at 10.00 s. The preview's UI changes made outside this animation pass were preserved. No production routes/assets or saves were modified. This remains a layered 2D art study, not a promise of seamless 3D skinning from every viewing angle.

References: [PixiJS license](https://github.com/pixijs/pixijs/blob/dev/LICENSE), [mesh API](https://pixijs.com/8.x/guides/components/scene-objects/mesh), [application lifecycle](https://pixijs.com/8.x/guides/components/application).
