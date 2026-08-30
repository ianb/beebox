# Unsupported-image message

`unsupportedImageMessage` (`lib/image-paste.ts`) writes the toast shown when a
picked file cannot be turned into a chat attachment.

The message it replaced said only "Those files couldn't be added to the
message". The encoder rejects whatever the browser cannot decode — in practice
a HEIC straight off an iPhone — so the format was the one fact the user needed
and the only place it appeared was a developer console line. A first-time user
guessed their way to the answer from that log and noted their mother could not
have. So the format is named, and so are the ones that work.

```ts setup
import { unsupportedImageMessage } from "../../../src/frontend/src/lib/image-paste.js";

const file = (name: string, type: string) => new File([], name, { type });
```

## The format is named

```ts
unsupportedImageMessage([file("IMG_1139.HEIC", "image/heic")])
=> HEIC files can't be added: this browser can't read that format. JPEG, PNG, GIF and WebP work.
```

## Several of one format say it once; several formats are listed

The set is deduplicated and sorted, so the message is stable no matter what
order the picker handed the files over in.

```ts
unsupportedImageMessage([file("a.heic", "image/heic"), file("b.heic", "image/heic")])
=> HEIC files can't be added: this browser can't read that format. JPEG, PNG, GIF and WebP work.

unsupportedImageMessage([file("b.tiff", "image/tiff"), file("a.heic", "image/heic")])
=> HEIC and TIFF files can't be added: this browser can't read that format. JPEG, PNG, GIF and WebP work.
```

## A missing type falls back to the extension

A drag-and-drop from some file managers arrives with an empty `type`, which is
still no reason to withhold the format — the name carries it.

```ts
unsupportedImageMessage([file("scan.HEIC", "")])
=> HEIC files can't be added: this browser can't read that format. JPEG, PNG, GIF and WebP work.
```

## With nothing to go on, it says which files rather than inventing a format

```ts
unsupportedImageMessage([file("clipboard", "")])
=> That file can't be added: this browser can't read that format. JPEG, PNG, GIF and WebP work.

unsupportedImageMessage([file("clipboard", ""), file("other", "")])
=> Those files can't be added: this browser can't read that format. JPEG, PNG, GIF and WebP work.
```
