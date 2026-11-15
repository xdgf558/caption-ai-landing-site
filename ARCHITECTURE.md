# Architecture

- Framework: Astro static site.
- Deployment: Cloudflare Workers with static assets.
- Global shell: `BaseLayout`, `Header`, `Footer`, language switcher, and shared CSS.
- Public brand pages (home, music, games, member, about) use `StationBrandLayout` with the paper theme in `src/redesign/paper.css` and presentation-only motion in `src/redesign/motion.js`.
- Content: Astro content collections for devlog and X works.
- Product data: product-specific config files under `src/data/products`.
- Product pages: per-route Astro files under `src/pages`, with reusable components in `src/components`.

## StoryCat

- Product config and localized copy: `src/data/products/storycat.ts`.
- Landing component: `src/components/StoryCatLanding.astro`.
- Preview asset: `public/images/storycat-preview.svg`.
- Routes:
  - `/apps/storycat/`
  - `/en/apps/storycat/`
  - `/zh-hant/apps/storycat/`
