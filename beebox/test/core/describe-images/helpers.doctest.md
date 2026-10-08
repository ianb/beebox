# Describe Images Helpers

Helper utilities for scan-import's Gemini image analysis: image file detection and MIME type mapping.

```ts setup
import {
  isImageFile,
  getMimeType,
} from "../../../src/core/describe-images/helpers.js";
```

## Image file detection

Recognizes common image extensions:

```ts
isImageFile("photo.jpg")
=> true

isImageFile("photo.JPEG")
=> true

isImageFile("document.pdf")
=> false
```

## MIME type mapping

```ts
getMimeType("photo.jpg")
=> image/jpeg

getMimeType("photo.JPEG")
=> image/jpeg

getMimeType("scan.tiff")
=> image/jpeg
```
