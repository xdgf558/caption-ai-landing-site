# Local preview

Default fixture with internal reading and external source links:

```sh
ALLOW_EMPTY_SERIAL_CONTENT=1 PUBLIC_MUSIC_ENTRY_ENABLED=true npm run build
ARTICLE_PREVIEW_PORT=4198 node scripts/serve-article-preview.mjs
```

The optional `ARTICLE_PREVIEW_SNAPSHOT` JSON uses public article metadata; `ARTICLE_PREVIEW_COVERS` points to a local directory containing the associated image basenames. It is a local-only fixture, not a content import tool. No fetches or credentials are used by this fixture loader. The checked-in snapshot was read from the public article list on 2026-09-15. Same-date records may order differently in the ephemeral database.

Current local review URL: http://127.0.0.1:4197/signal/

See [design-qa.md](./design-qa.md) for scope, comparison iterations and test evidence. Screenshot files record the design check rather than being website assets.
