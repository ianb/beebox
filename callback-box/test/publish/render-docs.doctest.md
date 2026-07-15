# Docs snapshot renderer

`renderDocsPublication` (Track B of `docs/plans/publish-pages.md`) turns a
markdown doc into a self-contained static bundle: one `index.html` at the root
with inline CSS and **no JavaScript**, plus any large images copied into
`assets/`. Small images inline as `data:` URIs. The load-bearing guarantee is
self-containment — nothing in the output points at an external URL — which is
what the publication CSP (`default-src 'none'`) and Track E's leak scan rely on.

```ts setup
import { writeFileSync } from "node:fs";
import {
  renderDocsPublication,
  INLINE_IMAGE_MAX_BYTES,
} from "../../src/publish/render-docs.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

// A fixed injected clock keeps the rendered timestamp (and thus index.html)
// deterministic — the renderer never reads the wall clock itself.
const now = new Date("2026-07-14T12:00:00Z");
```

## A doc with formatting and two images renders to a self-contained bundle

The fixture exercises the two image paths at once: a tiny image (below the
inline threshold) is embedded as a `data:` URI, and a large one (above it) is
copied into `assets/` with its reference rewritten to a relative path.

```ts
const box = await makeTmpBox();
writeFileSync(box.path("icon.png"), Buffer.alloc(64, 1));                       // small → inlined
writeFileSync(box.path("photo.png"), Buffer.alloc(INLINE_IMAGE_MAX_BYTES + 1, 2)); // large → asset file

const source = [
  "# Build Journal",
  "",
  "Some **bold** text and `inline code`.",
  "",
  "![an icon](icon.png)",
  "",
  "![a photo](photo.png)",
  "",
].join("\n");

const { files } = renderDocsPublication(source, { boxRoot: box.root, now });
const index = files.get("index.html");

// The bundle root entry exists and is a string of HTML.
typeof index
=> string

// Exactly one asset was emitted (the large image); the small one inlined.
const assetKeys = [...files.keys()].filter((k) => k.startsWith("assets/"));
assetKeys.length
=> 1

// The asset is named by content hash + original extension.
/^assets\/[\da-f]{16}\.png$/.test(assetKeys[0])
=> true
```

The rendered HTML carries the formatting, inlines the small image, and rewrites
the large image to its relative asset path — never the original `photo.png`.

```ts continue
index.includes("<strong>bold</strong>")
=> true

index.includes("<code>inline code</code>")
=> true

// Small image embedded inline (no separate file, no external fetch).
index.includes("data:image/png;base64,")
=> true

// Large image points at the emitted relative asset, not its box path.
index.includes(`src="${assetKeys[0]}"`)
=> true

index.includes('src="photo.png"')
=> false
```

**Self-containment** — the key guarantee, and the exact scan Track E's leak
check reuses: no `http://` or `https://` reference anywhere in `index.html`, and
no `<script` tag (doc bundles ship zero JS). The injected clock's timestamp is
present, confirming the time came from the injection, not the wall clock.

```ts continue
/https?:\/\//.test(index)
=> false

index.includes("<script")
=> false

index.includes("2026-07-14T12:00:00.000Z")
=> true

// Deterministic: same source + same clock ⇒ byte-identical output.
renderDocsPublication(source, { boxRoot: box.root, now }).files.get("index.html") === index
=> true

await box.cleanup();
```

## External and `data:` image references are left untouched

The renderer localizes only box-relative images. An already-inline `data:` URI
and an external URL pass through verbatim — the renderer never fetches the
network (the leak scan, not the renderer, decides an external URL is a problem).

```ts
const box = await makeTmpBox();
const source = [
  "![external](https://example.com/x.png)",
  "",
  "![inline](data:image/gif;base64,R0lGOD)",
  "",
].join("\n");

const { files } = renderDocsPublication(source, { boxRoot: box.root, now });
const index = files.get("index.html");

// No assets emitted — nothing box-local to localize.
[...files.keys()].sort().join(",")
=> index.html

index.includes('src="https://example.com/x.png"')
=> true

index.includes("data:image/gif;base64,R0lGOD")
=> true

await box.cleanup();
```

## A missing local image is a loud failure, not a silent broken bundle

A publication must be self-contained; a dangling local image reference can't be
allowed to ship as a broken `<img>`.

```ts
const box = await makeTmpBox();
renderDocsPublication("![gone](does-not-exist.png)", { boxRoot: box.root, now })
=> throws ImageNotFoundError

await box.cleanup();
```
