# Homepage night desk design

The selected September 14 homepage reference is implemented by StationHome, HomeHeader and HomeFooter, with homepage-scoped home-night.css. Other product pages retain their existing header, footer and theme. Four homepage locales, canonical URLs, structured data and build-time music activation are preserved.

## Assets

All night scene assets were generated with built-in Image Gen from the owner's selected reference. Production files are optimized WebP under public/images/home-night/:

- hero.webp (2172×724) and hero-1200.webp: night city window, sleeping cat, laptop and lamp; dark left area for real HTML text.
- music.webp: dark room and warm window light for music and novel backgrounds.
- novel.webp (1983×793): cat at a 1999 CRT computer, illustration for the existing Offline Future novel.
- cat-mark.webp: gold sitting-cat silhouette with transparency, shared by the homepage header/footer.
- late-confession.webp: existing public cover for the owner's published album 晚一点告白, collection slug wydgb, cover version 5; editorial homepage feature links to the live album. It does not advertise a permanent free/VIP status.

Product cards reuse current product catalog icons and routes. Music remains behind PUBLIC_MUSIC_ENTRY_ENABLED; no Worker, access policy, playback or data changes. Four highlighted tools match the reference layout; the remaining tools are reachable through the expandable workbench and Apps link. The reference's unconfigured search and social destinations were not made into dead buttons.

## Verification

Active and closed full builds and their four-locale launch checks pass. Site foundation, product catalog, NovelForge release and PrivatePinyin release checks pass. In-app browser QA covers desktop, tablet and mobile; Chinese variants, English and Japanese; menu toggle, workbench expansion, card navigation, locale switching, loaded images, console errors and horizontal overflow. See local design-qa.md for screenshots and comparison evidence.

This change is local and has not been deployed.
