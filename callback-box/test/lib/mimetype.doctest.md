# mimetypeToExtension

Tests for the shared MIME-type → extension map. This map is the reconciled
**union** of two formerly-drifted copies (the CLI `create` command and the
webapp upload route), so the regression these cases guard is that *both*
callers' formats still resolve from the single map.

```ts setup
import { mimetypeToExtension } from "../../src/lib/mimetype.js";
```

## Shared audio/image formats (were in both copies)

```ts
print(mimetypeToExtension("audio/mpeg"));
print(mimetypeToExtension("audio/m4a"));
print(mimetypeToExtension("image/jpeg"));
print(mimetypeToExtension("image/png"));
=>
.mp3
.m4a
.jpg
.png
```

## Formerly CLI-only formats (image/heic, video/*)

```ts
print(mimetypeToExtension("image/heic"));
print(mimetypeToExtension("image/heif"));
print(mimetypeToExtension("video/mp4"));
print(mimetypeToExtension("video/webm"));
=>
.heic
.heif
.mp4
.webm
```

## Formerly webapp-only formats (pdf, text, json)

```ts
print(mimetypeToExtension("application/pdf"));
print(mimetypeToExtension("text/plain"));
print(mimetypeToExtension("application/json"));
=>
.pdf
.txt
.json
```

## Unknown type falls back to .bin

```ts
print(mimetypeToExtension("application/x-nonsense"));
=>
.bin
```
