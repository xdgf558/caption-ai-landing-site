# Native music links: exact association contract

This change prepares local release verification. Production remains closed; no AASA was deployed, no Apple CDN state was changed, and no device association or Universal Link launch is established by these tests.

## Routes and evidence

`src/music/navigation.js` creates copied/shared URLs through `musicShareUrl`, including the URLs embedded in song and album share cards. `src/music/pagePaths.js` defines four canonical pages. `src/music/pageHttp.js` also accepts each page without its final slash and the Traditional Chinese `/zh-hant/music` alias, then redirects to the canonical page. AASA claims those exact existing entry paths:

| Environment | Exact music paths | App ID |
| --- | --- | --- |
| Production, `https://wwwstationcat.org` | `/music`, `/music/`, `/en/music`, `/en/music/`, `/ja/music`, `/ja/music/`, `/zh-hans/music`, `/zh-hans/music/`, `/zh-hant/music`, `/zh-hant/music/` | `2AM5S7BM2N.org.stationcat.music` |
| R2, `https://station-cat-music-r2.yehao1105.workers.dev` | `/music`, `/music/` | `2AM5S7BM2N.org.stationcat.music.staging` |

Both AASA documents additionally claim the exact authentication callback `/auth/mobile/callback`; its query is handled by the authentication flow, never by `MusicLink`. The R2 association does not advertise localized website pages. Its existing plain-text `/music/` fallback is unchanged; `/music` is included for the client's accepted root URL form. No wildcard claims music descendants, admin/API routes, other locales, or the rest of the website.

Apple's [`components` documentation](https://developer.apple.com/documentation/bundleresources/applinks/details-swift.dictionary/components-swift.dictionary) defines literal path matching, default case sensitivity and percent-encoded matching. Specifying only `/` leaves the query and fragment unrestricted. Therefore `/music/` does not cover `/music`, and association matching does not validate the selected track, collection, query count, or fragment. Client parsing separately requires one supported identifier and rejects ambiguous or credential-bearing links. A link resolves a selection; it never grants access or starts playback.

## Shared local verification

[`tests/fixtures/mobile-links/canonical-link-cases.json`](../../tests/fixtures/mobile-links/canonical-link-cases.json) is the cross-repository fixture. It contains `schemaVersion`, per-environment `origins` and `musicPaths`, and 74 full-URL cases. Each case specifies its environment, `aasaExpected`, and `client` (`kind: track | collection | null`, with `value` for a selection). `canonicalShareLocale` marks the eight URLs produced by the real website share helper: song and album in each of four languages. All IDs are synthetic.

The 24 accepted client URLs cover both slash forms and all advertised music paths. Rejected cases include unsupported locale/path casing, percent-encoded path aliases, descendants, unrelated pages, wrong environment/host, invalid identifiers, duplicate or mixed queries, unexpected query parameters, and fragments. Several rejected client cases intentionally have `aasaExpected: true`: Apple's path-only rules still match, while the app must reject their content.

Run the website checks from this checkout:

```sh
node --test scripts/test-mobile-production-association.mjs
node --test --test-timeout=90000 scripts/test-mobile-r2.mjs
```

The association suite checks the serialized production/R2 documents, exact path-only components, the shared origin/path matrix, real share URL generation, GET/HEAD behavior, and the closed production response. Its deliberately limited local matcher checks the documented literal-path defaults; it is not Apple's association engine. Production marker doubles also verify one reader/catalog/audio check per request and rejection after a marker changes. The broader production suite provides real local D1/R2 coverage. Markers detect mismatched deployment labels; they do not prove resource ownership.

Production AASA still uses the existing `configuration` and `verifyMobileBindings` gates. Clean-checkout settings return 503 without exposing the App ID or touching bindings. These path changes do not modify flags, origin/callback settings, registration, account deletion, secrets, resource bindings, or deployments.

## Remaining device acceptance

Apple's [TN3155](https://developer.apple.com/documentation/technotes/tn3155-debugging-universal-links) describes local `swcutil verify` pattern checks and device diagnostics. The installed `swcutil` requires root on this host; it was not run with privilege. Website tests and the companion iOS parser/AppModel tests do not establish Apple CDN approval, signed entitlements, cold/warm OS delivery, or a successful authentication-session callback.

After a separately authorized deployment, device acceptance must record the served AASA's status/body (no redirect), the signed app's exact associated domain and App ID, Apple's association diagnostics, and song/album links opened from another app with the app both terminated and running. Confirm the expected selection and no automatic audio, and exercise the authentication callback separately. Browser address-bar navigation or a direct call to `MusicLink` is insufficient evidence of OS delivery. Production activation remains a separate decision.
