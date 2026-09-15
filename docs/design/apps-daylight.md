# Apps daylight redesign

Reference: `/Users/shaola/Desktop/ChatGPT Image 2026年9月15日 06_54_00.png`.

Scope: the four existing localized Apps collection routes. Bright offwhite chrome, a daylight window hero, three featured product cards, a compact remaining-app grid, and a sunset contact banner. The homepage and product detail pages retain their existing themes. HomeHeader receives an optional Apps context so the home link, active Apps entry, and mobile locale destinations are correct.

All seven real products and existing detail/download/game destinations are retained. The screenshot's duplicate MindBudget and illustrative Safety Quiz are replaced with actual products. Real brand icons and platform/release statuses take precedence over mockup placeholders. SimpleCut links to its existing Mac/Windows release. No auth, backend, runtime music flags, checkout, download binaries, or product settings change.

## Assets

The built-in image generation tool produced individual decorative assets under `public/images/apps-daylight/`, subsequently resized and encoded as WebP. These are not a flattened page screenshot. Text, navigation, controls and product metadata remain HTML.

- `hero.webp`: 1536×600 daylight window/desk, sleeping tabby on books on the right, cream negative space on the left.
- `banner.webp`: 1536×370 pale sunset rooftop, cat looking over the skyline on the right.
- `mindbudget.webp`: 650×520 illustrative tilted phone using the existing budget dashboard as a reference, soft botanical foreground.
- `cat-life.webp`: 650×520 illustrative browser game scene grounded in the site's actual orange tabby and station-room art, rather than the mockup's fictional native diary.
- `snapcopy.webp`: 650×520 illustrative phone with a cat/seaside photo and photo-caption context.
- `cat-life-icon.webp`: optimized copy of the existing orange tabby icon. Other icons reuse existing optimized product WebP files.

Phone artwork is marked as an app concept illustration in alternative text. Actual interface images remain on existing product pages. All five newly generated artwork assets total approximately 225 KB.

## Validation

- `npm run build:music:active` passed, including built foundation and four-locale music entry checks.
- Product catalog, NovelForge release, PrivatePinyin release, Cat Life integration and site foundation scripts passed.
- Existing source-shape assertions updated for data-driven cards, including the correct simplified Chinese product title.
- Four built Apps locales checked for seven products, existing detail/download destinations and image resources.
- Browser QA: 1024 px desktop, 768 px tablet, 390 px phone; four locale routes, mobile menu, both locale switchers, featured section anchors, MindBudget detail navigation, contact/X hrefs, no horizontal overflow or broken images, no console errors.
- Existing homepage, music and product detail outputs remain outside the Apps body theme.

Preview screenshots: [desktop](apps-daylight/desktop.png), [mobile](apps-daylight/mobile.jpg).

Review branch only. Not deployed.
