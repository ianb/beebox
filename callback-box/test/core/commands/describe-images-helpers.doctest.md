# Describe Images Helpers

Helper utilities for scan-import's Gemini image analysis: image file detection and MIME type mapping.

```ts setup
import {
  isImageFile,
  getMimeType,
} from "../../../src/core/commands/describe-images-helpers.js";
```

## Image file detection

Recognizes common image extensions:

```ts
isImageFile("photo.jpg")
=> true

isImageFile("photo.JPEG")
=> true

isImageFile("screenshot.png")
=> true

isImageFile("photo.webp")
=> true

isImageFile("document.pdf")
=> false

isImageFile("notes.txt")
=> false
```

## MIME type mapping

```ts
getMimeType("photo.jpg")
=> image/jpeg

getMimeType("photo.JPEG")
=> image/jpeg

getMimeType("screenshot.png")
=> image/png

getMimeType("photo.webp")
=> image/webp

getMimeType("animation.gif")
=> image/gif

getMimeType("scan.tiff")
=> image/jpeg
```
