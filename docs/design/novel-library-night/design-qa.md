# Novel hub and member center — design QA

Design QA passed for the local implementation, 2026-09-15. Not deployed.

The requested reference is the existing approved Station Cat midnight desk theme. The live `/novel/` and `/zh-hant/library/` pages were inspected before implementation. The novel before/after screenshots were compared together. Reused the existing night header/footer, gold cat mark, novel desk illustration and Points desk illustration; no new artwork or licensing dependencies.

Scope: `/novel/` and the four localized member centers. The auth client, checkout, VIP redemption, bookmark logic and all Worker handlers are unchanged. The chapter reader is outside this theme. The English dynamic novel hub is not redesigned in this change; its existing navigation destination is preserved.

Browser evidence used the actual built HTML and scripts. A loopback-only preview server supplied fictional member responses; POST/DELETE/etc. are rejected. Public novel entries and covers were read from the existing public API. No real credentials, payments, membership mutations or bookmark writes were performed. Preview controls and sample accounts are not included in the production build.

Verified locally in the in-app browser:
- Desktop 1280 CSS px: novel hero, both real books and covers, member login, overview, points and security.
- Mobile 390 CSS px: novel categories and book switching, login/register/password-reset forms, overview, shelf and history, checkout confirmation/cancel, security and bottom navigation.
- English 768 CSS px: full-width member layout and inactive VIP status.
- Japanese 390 CSS px: overview, empty shelf, unlinked authenticator and security forms.
- Simplified Chinese 390 CSS px: overview and checkout-disabled points view; no checkout control exposed.
- No horizontal page overflow in measured mobile/tablet/desktop states. No console errors on final novel/member tabs.
- The final shelf title is rgb(241,241,237), description rgb(170,184,193), against the dark card. Earlier inherited dark-on-dark text was corrected.
- The Creem official light trust badge and scannable QR background intentionally retain their original presentation.

Corrections from visual QA: full-width novel hero; complete wrapping mobile filters; remove old green bookshelf rail; fix member shelf text contrast and security card corners; align the member breakpoint with the existing 820px navigation switch.

Validation: build and built-site foundation checks; test-novel-library-night; reader-library-locales; serials-hub-latest; reader-bookmark-shortcut; membership-safety; reader-totp; station-points; git diff --check. All passed.

The local build used ALLOW_EMPTY_SERIAL_CONTENT=1 because this isolated checkout lacks untracked static novel content. This is a preview build, not a production deployment artifact. Real iPhone/WeChat, actual login/2FA and real checkout are not claimed as verified.

Preview: `node scripts/serve-novel-library-preview.mjs`, bound to 127.0.0.1:4397. `/novel/`, `/__preview?state=guest`, `/__preview?state=member`; optional `lang=zh-hant|zh-hans|en|ja`, states `empty|expired|closed`.

Screenshots: docs/design/novel-library-night/. Screenshot dimensions differ slightly from CSS viewports because browser chrome/scrollbars are excluded.
