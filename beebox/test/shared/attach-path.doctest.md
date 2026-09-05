# Attach Path Helpers

Helpers for the `.attach/` directory convention. Every card may have a sibling directory named `<basename>.attach/`. Refs from the card to its attached files use the virtual prefix `attach/<file>`.

```ts setup
import {
  cardBasename,
  attachDirFor,
  attachmentPath,
  isAttachRef,
  splitAttachRef,
  resolveAttachRef,
  isLiteralAttachName,
  isAttachDirName,
  attachDirOwnerBasename,
  isInsideAttachScope,
} from "../../src/shared/attach-path.js";
```

## cardBasename

Strips `.<type>.card` to return the card's basename. Works on both filenames and full paths.

```ts
cardBasename("Foo.image.card")
=> Foo

cardBasename("Voice_Memo.memo.card")
=> Voice_Memo

cardBasename("scan-001.capture-session.card")
=> scan-001

cardBasename("/box/inbox/Foo.image.card")
=> Foo

cardBasename("Project.Notes.doc.card")
=> Project.Notes
```

Inputs that don't follow the convention are returned unchanged.

```ts
cardBasename("notes.txt")
=> notes.txt

cardBasename("nofile.card")
=> nofile
```

## attachDirFor

Returns the path of a card's attach scope — `<basename>.attach` in the same directory as the card.

```ts
attachDirFor("inbox/Foo.image.card")
=> inbox/Foo.attach

attachDirFor("/box/inbox/scan-001.capture-session.card")
=> /box/inbox/scan-001.attach

attachDirFor("Foo.memo.card")
=> Foo.attach
```

## attachmentPath

Computes a file path inside a card's attach scope.

```ts
attachmentPath("inbox/Foo.image.card", "photo-001.jpg")
=> inbox/Foo.attach/photo-001.jpg

attachmentPath("Foo.memo.card", "audio.webm")
=> Foo.attach/audio.webm

attachmentPath("inbox/scan-001.capture-session.card", "photo-001.image.card")
=> inbox/scan-001.attach/photo-001.image.card
```

Nested paths inside the scope work too.

```ts
attachmentPath("inbox/Foo.email-message.card", "attachments/quarterly.pdf")
=> inbox/Foo.attach/attachments/quarterly.pdf
```

## isAttachRef and splitAttachRef

A ref uses the `attach/` virtual prefix when it starts with `attach/` (or is exactly `attach`).

```ts
isAttachRef("attach/photo-001.jpg")
=> true

isAttachRef("attach")
=> true

isAttachRef("attach/sub/scan.image.card")
=> true
```

Mid-path `.attach` and other patterns are NOT recognized as attach refs.

```ts
isAttachRef("store/x.attach/y.jpg")
=> false

isAttachRef("photo-001.jpg")
=> false

isAttachRef("./attach/photo.jpg")
=> false
```

`splitAttachRef` returns the portion after the prefix, or `null` for non-attach refs.

```ts
splitAttachRef("attach/photo-001.jpg")
=> photo-001.jpg

splitAttachRef("attach/sub/scan.image.card")
=> sub/scan.image.card

splitAttachRef("attach")
=>

splitAttachRef("store/x.attach/y.jpg")
=> null
```

## resolveAttachRef

Expands a ref that uses the `attach/` prefix to a path against a card's attach scope.

```ts
resolveAttachRef("inbox/Foo.image.card", "attach/photo-001.jpg")
=> inbox/Foo.attach/photo-001.jpg

resolveAttachRef("inbox/Foo.email-message.card", "attach/attachments/foo.pdf")
=> inbox/Foo.attach/attachments/foo.pdf

resolveAttachRef("Foo.memo.card", "attach")
=> Foo.attach

resolveAttachRef("Foo.memo.card", "store/some/path.jpg")
=> null
```

## isLiteralAttachName and isAttachDirName

Used by lint rules.

```ts
isLiteralAttachName("attach")
=> true

isLiteralAttachName("attachments")
=> false

isLiteralAttachName("Foo.attach")
=> false
```

A directory name ends with `.attach` when it's a card's attach scope.

```ts
isAttachDirName("Foo.attach")
=> true

isAttachDirName("scan-001.attach")
=> true

isAttachDirName(".attach")
=> false

isAttachDirName("attach")
=> false
```

`attachDirOwnerBasename` returns the basename of the card that owns a given attach directory, or `null` if the directory isn't an attach scope.

```ts
attachDirOwnerBasename("Foo.attach")
=> Foo

attachDirOwnerBasename("scan-001.attach")
=> scan-001

attachDirOwnerBasename("attachments")
=> null

attachDirOwnerBasename("attach")
=> null
```

## isInsideAttachScope

Recognizes paths nested anywhere inside any attach scope.

```ts
isInsideAttachScope("inbox/Foo.attach/photo.jpg")
=> true

isInsideAttachScope("inbox/Foo.attach/nested/deeper/thing.jpg")
=> true

isInsideAttachScope("inbox/Foo.attach/scan.image.attach/photo.jpg")
=> true

isInsideAttachScope("inbox/Foo.memo.card")
=> false

isInsideAttachScope("store/regular/path/file.txt")
=> false
```
