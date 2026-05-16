# Landing Site

This is the static multi-product website for Everyday AI Apps. The first product is `caption-ai` (Caption AI), an AI lifestyle caption app in development.

The default language is Traditional Chinese. Opening `/` shows the Traditional Chinese brand home page.

## What is included

- Traditional Chinese brand home page: `/`
- English brand home page: `/en/`
- Product list: `/apps/`
- Caption AI Traditional Chinese pages:
  - `/zh-hant/apps/caption-ai/`
  - `/zh-hant/apps/caption-ai/download/`
  - `/zh-hant/apps/caption-ai/android/`
  - `/zh-hant/apps/caption-ai/privacy/`
  - `/zh-hant/apps/caption-ai/support/`
  - `/zh-hant/apps/caption-ai/terms/`
- Caption AI English pages:
  - `/apps/caption-ai/`
  - `/apps/caption-ai/download/`
  - `/apps/caption-ai/android/`
  - `/apps/caption-ai/privacy/`
  - `/apps/caption-ai/support/`
  - `/apps/caption-ai/terms/`
- Caption AI Japanese pages:
  - `/ja/apps/caption-ai/`
  - `/ja/apps/caption-ai/download/`
  - `/ja/apps/caption-ai/android/`
  - `/ja/apps/caption-ai/privacy/`
  - `/ja/apps/caption-ai/support/`
  - `/ja/apps/caption-ai/terms/`
- Brand entry pages:
  - `/privacy/`
  - `/support/`
  - `/terms/`
- Compatibility entry pages:
  - `/download/`
  - `/android/`
- SEO basics:
  - page titles
  - meta descriptions
  - Open Graph tags
  - Twitter card tags
  - canonical URLs
  - Traditional Chinese/English/Japanese hreflang links on product pages
  - `robots.txt`
  - `sitemap.xml`

## Local setup

Open Terminal, go to this folder, then run:

```bash
cd /Users/shaola/Downloads/软件开发相关/多品牌网站开发相关/landing-site
npm install
npm run dev
```

After `npm run dev`, open:

```text
http://localhost:4321
```

You should see the brand home page. Important pages to check:

```text
http://localhost:4321/
http://localhost:4321/en/
http://localhost:4321/apps/
http://localhost:4321/zh-hant/apps/caption-ai/
http://localhost:4321/zh-hant/apps/caption-ai/download/
http://localhost:4321/zh-hant/apps/caption-ai/android/
http://localhost:4321/zh-hant/apps/caption-ai/privacy/
http://localhost:4321/zh-hant/apps/caption-ai/support/
http://localhost:4321/zh-hant/apps/caption-ai/terms/
http://localhost:4321/apps/caption-ai/
http://localhost:4321/apps/caption-ai/download/
http://localhost:4321/apps/caption-ai/android/
http://localhost:4321/apps/caption-ai/privacy/
http://localhost:4321/apps/caption-ai/support/
http://localhost:4321/apps/caption-ai/terms/
http://localhost:4321/ja/apps/caption-ai/
http://localhost:4321/ja/apps/caption-ai/download/
http://localhost:4321/ja/apps/caption-ai/android/
http://localhost:4321/ja/apps/caption-ai/privacy/
http://localhost:4321/ja/apps/caption-ai/support/
http://localhost:4321/ja/apps/caption-ai/terms/
http://localhost:4321/privacy/
http://localhost:4321/support/
http://localhost:4321/terms/
http://localhost:4321/robots.txt
http://localhost:4321/sitemap.xml
```

If something fails, copy the red error block from Terminal and send it to Codex.

## Build check

Before deploying, run:

```bash
npm run build
```

You should see a successful build and a new `dist` folder. Cloudflare Pages should use this `dist` folder as the output directory.

## Mobile check for beginners

1. Open `http://localhost:4321/zh-hant/apps/caption-ai/` in Chrome or Safari.
2. Right click the page and choose `Inspect`.
3. Click the phone/tablet icon in the developer tools.
4. Choose an iPhone size.
5. Check that navigation wraps cleanly, buttons are tappable, and Traditional Chinese/Japanese text does not overflow.

Also check:

```text
http://localhost:4321/
http://localhost:4321/zh-hant/apps/caption-ai/
http://localhost:4321/ja/apps/caption-ai/
```

## Replacing Tally waitlist links

The current form URLs are placeholders in:

```text
src/data/products/caption-ai.ts
```

Replace these values:

```ts
waitlistFormUrl: 'TALLY_IOS_FORM_URL'
waitlistFormUrl: 'TALLY_ANDROID_FORM_URL'
```

with real Tally form URLs, for example:

```ts
waitlistFormUrl: 'https://tally.so/r/yourFormId'
```

The embedded form URL automatically adds these hidden fields:

```text
product
locale
platform
utm_source
utm_medium
utm_campaign
utm_content
landing_path
```

In Tally, create matching hidden fields with the same names.

## Replacing App Store and Google Play links

Do not add fake store links before launch.

When Caption AI is live, edit:

```text
src/data/products/caption-ai.ts
```

For iOS:

```ts
ios: {
  status: 'available',
  appStoreUrl: 'https://apps.apple.com/...'
}
```

For Android:

```ts
android: {
  status: 'available',
  googlePlayUrl: 'https://play.google.com/store/apps/details?id=...'
}
```

After launch, add official App Store and Google Play badge assets according to Apple and Google marketing guidelines. Do not draw a fake badge yourself.

## Cloudflare Pages deployment

Codex cannot log into your Cloudflare account for you, so do this manually:

1. Create a GitHub repository for this `landing-site` folder.
2. Push the code to GitHub.
3. Open Cloudflare Dashboard.
4. Go to `Workers & Pages`.
5. Click `Create`.
6. Choose `Pages`.
7. Connect your GitHub repository.
8. Set build command:

```text
npm run build
```

9. Set output directory:

```text
dist
```

10. Deploy.
11. Open the generated `pages.dev` URL and check the same pages listed above.

When you buy a custom domain later, add it in the Cloudflare Pages `Custom domains` area.

## Updating the production domain

Before real deployment, replace `https://example.com` in:

```text
astro.config.mjs
src/data/site.ts
public/robots.txt
public/sitemap.xml
```

Use your real domain or your Cloudflare Pages URL. This makes canonical URLs, sitemap, and social previews correct.

## Adding a second app later

When you add another app, do not put it inside the Caption AI pages. Use the same structure:

1. Create a new product config in `src/data/products/`.
2. Create English copy in `src/data/copy/`.
3. Create Japanese copy only if that app needs Japanese pages.
4. Create Traditional Chinese copy if the app should appear in the default language experience.
5. Create FAQ data in `src/data/faqs/`.
6. Create privacy and terms drafts in `src/data/legal/`.
7. Add pages under `/apps/new-app/`.
8. Add Traditional Chinese pages under `/zh-hant/apps/new-app/`.
9. Add Japanese pages under `/ja/apps/new-app/` if needed.
10. Update `/apps/` and the home page product list.
11. Update `public/sitemap.xml`.
12. Make sure the waitlist hidden field uses the new product id, not `caption-ai`.

## Important privacy note

The privacy policy and terms are practical drafts. Before App Store submission, commercialization, paid features, analytics, email marketing, or cloud AI uploads, review them against the real app data flow and local legal requirements.
