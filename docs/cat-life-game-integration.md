# Cat Life Game website integration

The browser game is published as a static sub-application at `/games/cat-life/`. Its runtime was copied from `xdgf558/cat-life-game` at merge commit `0cc839f` (game version `1.17.0`). The Station Cat integration files are `site-integration.js` and `site-integration.css`; the copied `index.html` and `src/js/main.js` contain the small hooks that load them and apply a requested language.

The four indexable product pages live at `/en/apps/cat-life-game/`, `/ja/apps/cat-life-game/`, `/zh-hans/apps/cat-life-game/`, and `/zh-hant/apps/cat-life-game/`. The playable runtime is marked `noindex` and excluded from the sitemap so search results point to a localized product page instead of the application shell.

The save key remains `catGameSaveV1`. Task 1 deliberately keeps saves in the current browser. A later member-account phase must migrate or link this local save explicitly and must not replace it during login.

When updating the embedded game, copy the upstream `index.html` and `src/` tree, then reapply the Station Cat shell hooks and update both `sourceCommit` in `src/data/products/cat-life-game.ts` and the regression expectations in `scripts/test-cat-life-game-integration.mjs`.
