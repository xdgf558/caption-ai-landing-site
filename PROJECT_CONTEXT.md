# Project Context

Station Cat is a personal creator website built with Astro and deployed to Cloudflare Workers. The site includes a warm paper-style brand homepage, multilingual product pages, works, devlog, admin pages, waitlist flows, and several app entries.

Current language surfaces include Traditional Chinese, Simplified Chinese, English, and Japanese. Existing app routes use per-locale page files under `src/pages`.

StoryCat is a new Station Cat experiment for an AI playable novel and iOS TestFlight testing entry. The MVP should add a lightweight product page and homepage app card without changing existing backend logic.

StoryCat routes added in this project:

- `/apps/storycat/`
- `/en/apps/storycat/` compatibility route
- `/zh-hant/apps/storycat/`
- `/zh-hans/apps/storycat/`
- `/ja/apps/storycat/`

The canonical English route remains `/apps/storycat/`, matching the existing product route style.
