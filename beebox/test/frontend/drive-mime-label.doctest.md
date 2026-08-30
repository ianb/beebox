# Naming what a Drive pointer points at

A `.glink.card` records a `mime` because nothing was copied — the mime is the
box's whole answer to "what is this?". `driveMimeLabel`
(`frontend/src/lib/drive-card-display.ts`) is what the `glink` view shows in
its place.

The rule is: name it when we know the name, and otherwise show the raw mime.
A friendly-but-wrong label ("Document" for anything unrecognized) would hide
what the item actually is, and the raw string is what `bbx drive inspect`
prints anyway.

```ts setup
import { driveMimeLabel } from "../../src/frontend/src/lib/drive-card-display.js";
```

## Google's own types read as products, not as vendor strings

```ts
driveMimeLabel("application/vnd.google-apps.document")
=> Google Doc

driveMimeLabel("application/vnd.google-apps.presentation")
=> Google Slides

driveMimeLabel("application/vnd.google-apps.folder")
=> Drive folder
```

## The everyday attachments a mirror leaves pointers for

A PDF, a scan, an Office file — the children a folder mirror cannot sync, which
is exactly when a pointer gets written.

```ts
driveMimeLabel("application/pdf")
=> PDF

driveMimeLabel("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
=> Excel spreadsheet
```

## A family stands in when the exact subtype would not help

`image/heic` and `image/png` are both "an image" to someone deciding whether to
open it, and the subtype list would never finish.

```ts
driveMimeLabel("image/png")
=> Image

driveMimeLabel("image/heic")
=> Image

driveMimeLabel("video/quicktime")
=> Video
```

## Anything else keeps its mime, verbatim

```ts
driveMimeLabel("application/x-sqlite3")
=> application/x-sqlite3
```

## A missing mime says it is missing

A hand-written pointer the connector has not stamped yet has no mime. Rendering
nothing where a kind belongs would read as "no kind"; say the field is absent.

```ts
driveMimeLabel("")
=> Unknown type
```
