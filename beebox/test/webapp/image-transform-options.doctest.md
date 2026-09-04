# Image transformation options and cache decisions

The public query vocabulary is strict, but aliases normalize to one typed option set.

```ts setup
import {
  imageTransformCacheKey,
  negotiateImageFormat,
  parseImageTransformOptions,
} from "../../src/webapp/image-transform-options.js";
import { selectImageCacheEvictions } from "../../src/webapp/image-transform-cache.js";

function optionError(query: Record<string, unknown>): string {
  try { parseImageTransformOptions(query); return "accepted"; }
  catch (error) { return error instanceof Error ? error.message : String(error); }
}
```

```ts
const long = parseImageTransformOptions({ width: "480", quality: "75", format: "webp" });
const short = parseImageTransformOptions({ w: "480", q: "75", f: "webp" });
JSON.stringify(long) === JSON.stringify(short)
=> true
```

Defaults match the public contract and `format=auto` negotiates from `Accept`:

```ts
parseImageTransformOptions({ height: "240" }, "image/avif,image/webp").options
=>
{
  "height": 240,
  "fit": "scale-down",
  "quality": 85,
  "format": "avif",
  "dpr": 1
}
```

An AVIF type explicitly rejected with `q=0` falls through to WebP:

```ts
negotiateImageFormat("image/avif;q=0, image/webp;q=0.8")
=> webp
```

Unknown, duplicate, and physically oversized options fail at the boundary:

```ts
[optionError({ width: "10", nope: "1" }), optionError({ width: "10", w: "10" }), optionError({ width: "3000", dpr: "2" })]
=>
[
  "Invalid image option \"nope\": unknown option",
  "Invalid image option \"width\": use only one of width or w",
  "Invalid image option \"dpr\": physical width and height must not exceed 4096 pixels"
]
```

Aliases produce the same disk-cache identity after normalization, while a source version change does not:

```ts
const options = parseImageTransformOptions({ width: "480", quality: "75", format: "webp" }).options;
const equivalent = parseImageTransformOptions({ w: "480", q: "75", f: "webp" }).options;
const retried = parseImageTransformOptions({ w: "480", q: "75", f: "webp", v: "changed", imageRetry: "2" }).options;
const first = imageTransformCacheKey({ sourcePath: "store/photo.jpg", sourceVersion: "v1", options });
const same = imageTransformCacheKey({ sourcePath: "store/photo.jpg", sourceVersion: "v1", options: equivalent });
const sameRetry = imageTransformCacheKey({ sourcePath: "store/photo.jpg", sourceVersion: "v1", options: retried });
const changed = imageTransformCacheKey({ sourcePath: "store/photo.jpg", sourceVersion: "v2", options });
`${first === same} ${first === sameRetry} ${first === changed}`
=> true true false
```

The purge removes stale temporary and finished files, then the oldest live variants until the cache is at most 512 MiB:

```ts
const mib = 1024 * 1024;
const now = Date.UTC(2026, 8, 3);
selectImageCacheEvictions([
  { path: "stale", size: 1, mtimeMs: now - 31 * 86400000, temporary: false },
  { path: "temp", size: 1, mtimeMs: now - 2 * 3600000, temporary: true },
  { path: "old", size: 300 * mib, mtimeMs: now - 3, temporary: false },
  { path: "new", size: 300 * mib, mtimeMs: now - 2, temporary: false },
], now).sort()
=>
[
  "old",
  "stale",
  "temp"
]
```
