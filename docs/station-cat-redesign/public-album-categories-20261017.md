# Public album metadata for the native catalog

The iOS catalog now needs real album membership for its All / Singles / Albums categories. This change adds a nullable `albums` field to existing public track list and detail DTOs. It introduces no endpoint, migration, media grant, configuration activation or production write.

```json
{"albums":[{"id":"aaaaaaaa-0000-4000-8000-000000000001","slug":"night-letters","title":"Night Letters","summary":"Songs for the evening","version":1,"position":0}]}
```

Membership comes only from `music_collections` with `status = published` and `collection_type = album`, joined through `music_collection_tracks`. The existing Station publication checks still decide whether each parent song is public. A membership contains no sibling song IDs, storage keys, cover URL or audio. Playlists, drafts and archived collections are excluded. Localized album title/description use the same metadata validation and fallback rules as other public content.

- `[]` means the song has no currently published album membership and can appear in Singles.
- `null` means classification could not be validated; it must not be presented as a confirmed single. The public song remains usable.
- Up to 25 memberships per song; bounded SQL reads one extra entry to detect overflow. IDs, version, position and metadata are validated before projection.
- `position` is the backend ordering value, not an array index or a playback instruction. The native app groups only visible public songs and orders them by this value. It uses the first visible member's existing cover URL; this change does not expose the old collection-cover route.
- Current cache, rights and route policies remain unchanged. No extra cache lifetime is granted to metadata or platform destinations.

Publish this website change before delivering the paired iOS build 10. Older apps ignore the new field; the new app can still browse All against an old server but displays classification-unavailable feedback. The gallery is populated by existing operator-managed albums; this change does not create or publish albums on the user's behalf.

Local validation: public content unit tests 32/32; actual Miniflare/D1 runtime tests 9/9. The development build uses `ALLOW_EMPTY_SERIAL_CONTENT=1` because this checkout has no private serial sources; it passed 185 pages and postbuild checks and must not be deployed as a production package. The full scoped public regression suite passed 64/64 (including those unit/runtime subsets). No deployment performed.
