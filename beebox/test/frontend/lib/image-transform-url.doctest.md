# Image transform URL helpers

```ts setup
import { apiRawImageUrl, apiTransformedImageUrl } from "../../../src/frontend/src/api-core.js";
import { transformedResolvedImageUrl } from "../../../src/frontend/src/lib/image-transform-url.js";
```

Box-relative paths are encoded while transform options remain ordinary query parameters.

```ts
apiTransformedImageUrl({
  apiBase: "/image-thumbnails/test1/api",
  path: "store/Q&A #1.jpg",
  options: { width: 480, quality: 85, format: "auto", fit: "scale-down" },
})
=> /image-thumbnails/test1/api/images/store/Q%26A%20%231.jpg?width=480&fit=scale-down&quality=85&format=auto
```

The original image-card route remains available for the lightbox.

```ts
apiRawImageUrl("/image-thumbnails/test1/api", "Portrait.image.card")
=> /image-thumbnails/test1/api/image/Portrait.image.card
```

Resolved canonical photo URLs can switch to a transform without losing their version token.

```ts
transformedResolvedImageUrl(
  "/image-thumbnails/test1/api/files/store/photo.jpg?v=abc123",
  { width: 960, quality: 85, format: "auto", fit: "scale-down" },
)
=> /image-thumbnails/test1/api/images/store/photo.jpg?v=abc123&width=960&fit=scale-down&quality=85&format=auto
```

Animated, unsupported, external, blob, session-media, and history images are deliberately left alone.

```ts
JSON.stringify([
  "/test/api/files/wave.gif",
  "/test/api/files/vector.svg",
  "/test/api/files/bitmap.bmp",
  "/test/api/files/icon.ico",
  "https://example.com/photo.jpg",
  "https://cdn.example.com/api/files/photo.jpg",
  "blob:https://example.com/id",
  "/test/api/session-media/session/entry/0",
  "/test/api/history/abc/blob/photo.jpg",
].map((source) => transformedResolvedImageUrl(source, { width: 960 })))
=> [null,null,null,null,null,null,null,null,null]
```

Chat retry and file-version parameters survive rewriting but do not become transform options.

```ts
transformedResolvedImageUrl("/test/api/files/photo.jpg?v=one&imageRetry=2", { width: 960, format: "auto" })
=> /test/api/images/photo.jpg?v=one&imageRetry=2&width=960&format=auto
```
