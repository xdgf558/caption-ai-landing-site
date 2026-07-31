# Signal share cards

Published Signal briefs expose two dynamic card assets:

- `card.png` is the social preview used by Open Graph and X `summary_large_image` metadata.
- `card.svg` remains available as a backwards-compatible preview and debugging asset.

The Worker renders the existing 1200 x 675 SVG template to PNG with `@cf-wasm/resvg`. PNG responses are revisioned from the content entry timestamp plus the card-template version and cached at the edge. This makes visual template updates use a new image URL even when the brief content itself did not change. The brief URL, rather than the image URL, remains the value sent to the X share intent so X can attach the preview card to the post.

## Runtime font

PNG rendering reads this font from the `CONTENT_BUCKET` R2 binding:

`fonts/NotoSansCJKtc-Regular.otf`

The current object is Noto Sans CJK TC Regular from the official `notofonts/noto-cjk` repository. Its SHA-256 is:

`dce08bd4fd91aa8aa76ed8fea4b694c2dfb8550f67871e326843212ddbeb88b4`

The SIL Open Font License 1.1 is stored alongside it at:

`fonts/NotoSansCJKtc-Regular.LICENSE.txt`

If the font object is missing, PNG generation fails explicitly instead of returning an image with blank CJK text.
