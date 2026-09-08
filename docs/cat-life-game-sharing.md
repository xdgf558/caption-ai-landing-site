# Station Letters — game sharing (1.27.0)

The Version page offers **Share this update**. The selected visual direction is option 1, the cream-paper watercolor **小站来信 / Station Letters** postcard. This is a local-first frontend feature: no Worker, database, account, economy or save-schema change. Schema remains 3. Release 1.26.2 is fully archived in all three languages.

## Contract

- `shareCard.getModel()` snapshots only public `config.version`, current `releaseNotes` and localized brand copy. It never includes historical notes, player identifiers, balances, save contents or current-page query data. Locale follows the game's display language; a traditional-Chinese site request retains `zh-Hant` in the QR link while game copy follows the existing simplified-Chinese fallback.
- The QR destination is always `https://wwwstationcat.org/games/cat-life/?lang=<allowed locale>`; no account, token, return path, tracking query, or fragment is forwarded. It links to the game, not a preview or Vercel deployment.
- The PNG is 1080 × 1440. It shows up to three current-note summaries, bounded to two lines each. The selectable share text retains all current notes. Future releases only need the existing `releaseNotes`/`releaseHistory` workflow; no separate card-version metadata is required.
- Native sharing is offered only when `navigator.canShare({ files })` succeeds. The prepared PNG File is handed to `navigator.share` in the user gesture. Cancellation is not an error. There is no automatic social posting.
- [X Web Intents](https://docs.x.com/x-for-websites/web-intents/overview) open a short text/link draft. They do not attach the PNG. UI explicitly asks the user to save and attach it. WeChat Moments uses save-image/manual-post, or long-pressing the preview where downloading is restricted. No WeChat JS-SDK promise or backend is added.
- Clipboard failure selects a readonly text field for manual copying. Image/font/QR failures offer retry and leave text/link copying available. Preparation is bounded by timeouts.

## Lifecycle and security

The modal is outside `#app-main`; timer, focus and commerce redraws cannot replace its controls or image. Native dialog focus containment and Escape dismissal apply. The stable entry ID lets focus return even when the version page was redrawn. Epoch checks discard preparation results after close/reopen. Object URLs are revoked on close/retry. Pagehide closes the dialog.

Production's existing game CSP permits `img-src data:` but not `blob:`. The preview therefore uses a PNG data URL; a separate blob URL is used only for the download. No CSP relaxation or third-party runtime calls are needed. Browser tests load the actual game CSP from `public/_headers`.

## Assets and licenses

- `public/games/cat-life/src/assets/share/station-letter.webp`: 1080 × 1440, 158,472 bytes. Built-in ImageGen edit of the approved option 1; only overlay copy, logo copies and illustrative QR removed. Cottage, orange tabby, bow, lamp, flowers, signs and postal marks are retained. Compressed to WebP for shipping. Dynamic copy and real QR remain code-rendered.
- `public/images/optimized/station-cat-logo-1668c2e5-320.webp`: actual existing Station Cat logo, reused twice. No generated replacement logo.
- `public/games/cat-life/src/assets/share/letter-title.ttf`: 10,628-byte Noto Serif SC Black subset; [Google Fonts CSS API](https://developers.google.com/fonts/docs/css2) `text=` request for `打工养猫日记Cat Life Diaryねこと暮らす日記Station Cat`. The SIL OFL license is beside the font. Only fixed game titles use this font. Body copy uses the existing system CJK stack; Latin display copy uses Georgia/serif fallback. Changing a fixed game title requires regenerating this subset.
- `public/games/cat-life/src/js/vendor/qrcode.js`: exact local copy of the existing `qrcode-generator` 1.4.4 dependency; MIT notice retained. Loaded only after opening the modal. QR uses M correction, integer square modules and a white four-module quiet zone, with no logo overlay. `jsqr` is a dev-only independent decoder used to test exported PNGs and compressed 540px JPEGs.
- Illustration, font and QR library are lazy-loaded. No mockup screenshots are shipped. Review screenshots live under ignored `test-results/share-card/`.

### Final asset edit prompt (built-in ImageGen)

Input: selected option 1 as edit target. Produce a production 3:4 poster background for 1080 × 1440 export. Erase overlaid top brand/logo, headline/subtitle and all lower typography, logos, rules, QR and QR frame; fill with matching warm paper. Preserve botanical sprigs, green paw, postal cancellation lines and orange paw stamp. Preserve the central watercolor cottage, shutter, lamp, mailbox, daisies, planters, orange tabby with bow and stone steps in the same position/scale, including the inherent signs “小站来信”, “小站 欢迎你” and “POST”. Keep scene at approximately 25–69% of the portrait and lower 30% blank for live text/real QR. No crop, restyling or added elements; flat full-bleed artwork.

## Verification

Run `node scripts/test-cat-life-share.mjs`, `TZ=UTC npx playwright test scripts/browser-tests/cat-life-share.spec.mjs`, `npm test` and `npm run build`. The browser suite exercises 390/1040/1280 in zh-Hant/en/ja, real download and independent QR decoding, compressed-image decoding, public data allowlisting, deferred assets, CSP, commerce/redraw focus, image/font/QR retry, close during generation, object-URL cleanup, clipboard fallback and native success/cancel/failure/unavailability.

Native sharing is browser/platform dependent ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)). Automated native-share cases mock the OS handoff. They do not prove a physical iPhone/WeChat client can publish. No real social account is contacted during tests and no real online save is used.
