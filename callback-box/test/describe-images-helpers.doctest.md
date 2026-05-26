# Describe Images Helpers

Helper utilities for the `describe-images` command: image file detection, MIME type mapping, EXIF extraction, and card attachment lookup.

```ts setup
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import {
  isImageFile,
  isImageCard,
  getMimeType,
  findAttachedImage,
  extractExif,
} from "../src/core/commands/describe-images-helpers.js";
```

## Image file detection

Recognizes common image extensions:

```
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

## Image card detection

```
isImageCard("photo-001.image.card")
=> true

isImageCard("photo-001.jpg")
=> false

isImageCard("notes.memo.card")
=> false
```

## MIME type mapping

```
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

getMimeType("unknown.bmp")
=> image/jpeg
```

## Finding attached images

Finds image files that share a card's basename:

```
const box = await makeTmpBox();
const dir = join(box.root, "box/inbox/capture-test");
await mkdir(dir, { recursive: true });

await writeFile(join(dir, "photo-001.image.card"), "<image status=\"new\">\n<filename ref=\"photo-001.jpg\" captured=\"2024-01-01T00:00:00Z\" source=\"camera-user\" />\n<description></description>\n</image>\n");
await writeFile(join(dir, "photo-001.jpg"), "fake-jpg-data");

const result = await findAttachedImage(join(dir, "photo-001.image.card"));
result.endsWith("photo-001.jpg")
=> true
```

Returns null when no image file exists:

``` continue
const missing = await findAttachedImage(join(dir, "photo-999.image.card"));
missing
=> null
```

``` cleanup
await box.cleanup();
```

## EXIF extraction

Returns null for files without EXIF data (like a plain text file pretending to be an image):

```
const box = await makeTmpBox();
const fakePath = join(box.root, "fake.jpg");
await writeFile(fakePath, "not-a-real-image");

const exif = await extractExif(fakePath);
exif
=> null
```

``` cleanup
await box.cleanup();
```
