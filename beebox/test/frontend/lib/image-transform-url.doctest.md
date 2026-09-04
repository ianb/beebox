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

Animated and external images are deliberately left alone.

```ts
JSON.stringify([transformedResolvedImageUrl("/test/api/files/wave.gif", { width: 960 }), transformedResolvedImageUrl("https://example.com/photo.jpg", { width: 960 })])
=> [null,null]
```
