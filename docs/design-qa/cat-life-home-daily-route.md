Historical report from the homepage redesign. Evidence filenames below refer to that review's attachments; machine-specific paths have been removed. This is an archive, not a fresh verification.

# 首页「今日生活路线」Design QA

## Comparison setup

- Source visual truth: `exec-f90a3fbf-af57-4097-a002-dd15e99d1c05.png`（与用户选择的 `截屏2026-09-02 21.41.00.png` 同一视觉方向；桌面附件路径在当前环境不可直接读取）。源图像素尺寸 1487 × 1058。
- Implementation evidence: `cat-life-home-daily-route-compact-desktop.jpg`（桌面）、`cat-life-home-daily-route-qa-1040.jpg`（中间宽度）、`cat-life-home-daily-route-qa-mobile.jpg`（移动端）。截图来自本地 in-app browser，deviceScaleFactor 1；浏览器视口分别为 1536 × 1024、1040 × 800、390 × 844，截图像素因滚动条/浏览器捕获区域分别为 1521 × 985、1025 × 788、375 × 812。
- Desktop state: Simplified Chinese, guest mode, one unlocked healthy cat (`小橘`), 200 gold, no active work; the live route resolves to “打工” from the existing headline state. The source uses the “喂食” route state, so route state is intentionally different while comparing the shared layout and interaction contract.
- The generated target contains an exterior-house illustration that was not present in the repository. A project-local `home-house-scene.webp` was generated in the same storybook direction, optimized to 1200 × 800 / about 96 KB, and the live cat pose remains a separate dynamic asset.

## Full-view comparison evidence

The source and the final desktop capture were opened together as one comparison input. The implementation carries over the selected composition: Station Cat shell, status strip, large paper homepage, date-led diary cover, left copy/right home scene, horizontal five-step route, and a divided tasks/current-work area below. The compact desktop result is 805px tall for the homepage panel, so the lower split remains visible within the same above-the-fold rhythm as the source.

The route state is data-driven rather than hard-coded: health, hunger, cleanliness, sleep, active work, and player hunger select the current step and CTA while preserving the existing `data-page-target`, `data-cat-action`, and `data-player-sleep` handlers.

## Focused-region comparison evidence

- Hero + route crop comparison was reviewed together using `cat-life-home-daily-route-source-focus.png` and `cat-life-home-daily-route-qa-focus.jpg`. The implementation matches the source's paper frame, editorial title hierarchy, right-side illustrated scene, timeline rule, first-step emphasis, and lower divider. The source's exterior illustration is intentionally adapted to the repository's real dynamic cat pose layered over the new house scene.
- At 1040px, the five route entries remain on one row at approximately 136px each with no overlap or horizontal overflow; the earlier oversized first-column behavior was removed at the intermediate breakpoint.
- At 390px, the cover becomes a vertical reading order, the scene remains readable, the route becomes a single-column path, and the fixed mobile navigation stays visible. DOM checks reported `scrollWidth - clientWidth = 0`.

## Required fidelity surfaces

- Typography: the existing Station Cat storybook type stack and weights are retained; the journal date, title, route heading, status pills, and small route copy follow the source's strong-to-quiet hierarchy. Chinese, English, and Japanese route/home keys resolve without raw translation keys.
- Spacing and layout rhythm: the cover is a two-column hero on desktop, the route is a full-width five-step track with a larger current entry, and the lower split uses the source's vertical divider. The cover/route heights were tightened after the first capture so the lower tasks/work area is visible at the target desktop height.
- Colors and tokens: existing `--story-*` paper, ink, orange, mint, and green tokens are used; orange marks the active route/CTA, mint marks completed care, and cream surfaces keep the page calm. No new gradients or `!important` rules were added for this module.
- Image quality and asset fidelity: the hero uses the new optimized `home-house-scene.webp` plus the game's current cat pose, while route cards use existing food, job, shop, litter, and nap assets. All visible images have explicit dimensions; the hero background is decorative (`alt=""`) and the live cat retains its name as alt text.
- Copy/content: the homepage now exposes the date, greeting, route context, route status, task progress, current work state, comfort, furniture, and backpack facts while keeping existing game data and navigation.
- Accessibility and interaction: the page has labelled sections, semantic headings, button CTAs, explicit image alt behavior, a mobile navigation fallback, and no focus/interaction regression observed. The primary route CTA was clicked in the local browser and opened the work panel; returning Home restored all five route entries.
- Runtime: `home-house-scene.webp` finished loading in desktop, 1040px, and 390px checks. In-app browser console checks returned no error or warning entries for the final captures. `prefers-reduced-motion` disables the homepage cat animation.

## Comparison history

### Pass 1 — blocked findings

- `[P1]` The tasks heading rendered the raw key `home_tasks_panel_title` because the renderer referenced a key missing from the locale packs. This was visible in the desktop capture.
- `[P2]` The old `.home-cat-stage` grid rule kept the new page root in a two-column layout, putting the route beside the hero instead of below it.
- `[P2]` The first desktop route layout was too tall and the intermediate first route column consumed too much width, reducing the lower split and making 1040px cards unnecessarily uneven.

### Pass 2 — fixes and evidence

- Added `home_tasks_panel_title` to `zh-CN`, `en`, and `ja`; the final DOM reports `今日任务` / `Today's tasks` / `今日のタスク` and no raw home translation keys.
- Explicitly set `.home-journal-page { display: block; }`, removed unused intro action styling, and tightened the cover and route sizing.
- Added the compact route copy, reduced route card media/padding, made the intermediate track five equal columns, and re-captured the desktop, 1040px, and 390px evidence. Final geometry is root 805px / route 251px on the 1536px desktop capture, equal 136px route entries at 1040px, and zero horizontal overflow at 390px.

## Verification checklist

- [x] Selected “今日生活路线” visual direction resolved before implementation.
- [x] Hero, date/greeting, illustrated home scene, five-step route, task list, and current-work panel implemented.
- [x] Existing game state, dynamic cat pose, navigation, work CTA, and sleep CTA remain wired through existing handlers.
- [x] New hero image generated in the matching storybook style, optimized to WebP, and included in the integration asset manifest.
- [x] Chinese, English, and Japanese home keys checked in the rendered browser; no raw translation keys remain.
- [x] Desktop 1536px, intermediate 1040px, and mobile 390px browser captures completed.
- [x] No horizontal overflow; hero and route images loaded successfully.
- [x] Primary route navigation tested from Home → Work → Home.
- [x] Changed JavaScript passed `node --check`; `git diff --check` passed.
- [x] `node scripts/test-cat-life-game-integration.mjs` passed.
- [x] `npm test` passed.
- [x] `npm run build` passed; only the repository's existing empty-content warnings were emitted during Astro content sync.

## Follow-up polish

- `[P3]` If the route gains more steps, consider horizontally scrollable chapters or a compressed tablet mode rather than shrinking each card further.
- `[P3]` The source includes small notebook/briefcase decorative marks in the lower split; the implementation keeps the repository's existing icon/image language and can add dedicated assets in a later polish pass if desired.

final result: passed
