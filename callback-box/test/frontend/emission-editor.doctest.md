# EmissionEditor — the one mutation surface for the composition draft

`createEmissionStore` (docs/plans/input-extraction.md, chunk 2) holds the
whole in-progress emission — text, images, pending-image count, files,
selections — behind one editor. Framework-free (no React/DOM), so it's
doctestable headlessly; the React bindings
(`useChatAttachments`/`useChatSelections`) are thin wrappers covered
elsewhere by typecheck + manual verification.

```ts setup
import { createEmissionStore } from "../../src/frontend/src/input/emission-store.js";
```

## setText: updater + no-op on an equal value (no notify)

```ts
const store = createEmissionStore();
let notifications = 0;
store.subscribe(() => { notifications += 1; });

store.editor.setText("hello");
store.get().text
=> hello

notifications
=> 1
```

Setting the same value again does not notify — the same guard `input-store.ts`
always had, now living in the shared editor:

```ts continue
store.editor.setText("hello");
notifications
=> 1
```

An updater function works too, and does notify (the resolved value differs):

```ts continue
store.editor.setText((prev) => prev + " world");
store.get().text
=> hello world

notifications
=> 2
```

## Images: pendingImages accounting, addImage decrements, floor at 0

```ts
const store = createEmissionStore();
store.editor.setText("check [image1] and [image2] out");
store.editor.bumpPendingImages(2);
store.get().pendingImages
=> 2

const id1 = store.editor.nextImageId();
store.editor.addImage({ id: id1, mimeType: "image/png", dataBase64: "aGk=", objectUrl: "blob:1", byteLength: 100 });
store.get().pendingImages
=> 1

const id2 = store.editor.nextImageId();
store.editor.addImage({ id: id2, mimeType: "image/png", dataBase64: "aGk=", objectUrl: "blob:2", byteLength: 100 });
store.get().pendingImages
=> 0

store.get().images.length
=> 2
```

A failed encode (no `addImage` call — nothing to add) is the caller's job to
decrement directly; the editor still floors at 0 rather than going negative
on an unmatched decrement:

```ts continue
store.editor.bumpPendingImages(-5);
store.get().pendingImages
=> 0
```

## removeImage strips the token — including the bounding whitespace

Only the matching id's token is removed; another image's token, and the
words around it, are left alone:

```ts continue
store.editor.removeImage(id1);
store.get().text
=> check and [image2] out

JSON.stringify(store.get().images.map((i) => i.id))
=> [2]
```

## Files: same token-strip shape, independent id sequence

```ts
const store = createEmissionStore();
store.editor.setText("see [file1] please");
const fid = store.editor.nextFileId();
store.editor.addFile({ id: fid, path: "tmp/report.pdf", originalName: "report.pdf", size: 10, mimetype: "application/pdf" });
store.get().files.length
=> 1

store.editor.removeFile(fid);
store.get().text
=> see please

store.get().files.length
=> 0
```

## Selections: same token-strip shape

```ts
const store = createEmissionStore();
store.editor.setText("compare [selection1] with the doc");
const sid = store.editor.nextSelectionId();
store.editor.addSelection({ id: sid, ref: "/store/notes/Bread.doc.card", text: "let it rise", position: "body" });
store.get().selections.length
=> 1

store.editor.removeSelection(sid);
store.get().text
=> compare with the doc

store.get().selections.length
=> 0
```

## reset("attachments"): clears images+files+pendingImages, id counters restart at 1, hands back object URLs to revoke

Text is untouched by `reset` — the send site clears it itself (today's
`handleSend` does `resetAttachments(); resetSelections(); inputStore.set("")`
as three separate calls):

```ts
const store = createEmissionStore();
store.editor.setText("two photos");
store.editor.bumpPendingImages(1);
const a = store.editor.nextImageId();
store.editor.addImage({ id: a, mimeType: "image/png", dataBase64: "x", objectUrl: "blob:a", byteLength: 1 });
const b = store.editor.nextImageId();
store.editor.addImage({ id: b, mimeType: "image/png", dataBase64: "x", objectUrl: "blob:b", byteLength: 1 });
const f = store.editor.nextFileId();
store.editor.addFile({ id: f, path: "tmp/x.txt", originalName: "x.txt", size: 1, mimetype: "text/plain" });

const result = store.editor.reset("attachments");
JSON.stringify(result.removedImageObjectUrls)
=> ["blob:a","blob:b"]

store.get().images.length
=> 0

store.get().files.length
=> 0

store.get().pendingImages
=> 0

store.get().text
=> two photos
```

Counters restart at 1 — matching today's `resetAttachments`, which resets
both id refs (`nextAttachmentIdRef.current = 1`,
`nextFileAttachmentIdRef.current = 1`):

```ts continue
store.editor.nextImageId()
=> 1

store.editor.nextFileId()
=> 1
```

`reset("selections")` is the independent counterpart — it never touches
images/files/pendingImages, and hands back no object URLs (there's nothing
to revoke):

```ts
const store = createEmissionStore();
const s1 = store.editor.nextSelectionId();
store.editor.addSelection({ id: s1, ref: "/a", text: "one", position: "" });
const result = store.editor.reset("selections");
JSON.stringify(result.removedImageObjectUrls)
=> []

store.get().selections.length
=> 0

store.editor.nextSelectionId()
=> 1
```

## Id counters are monotonic within a session — never reused except across a reset

```ts
const store = createEmissionStore();
store.editor.nextImageId()
=> 1

store.editor.nextImageId()
=> 2

store.editor.addImage({ id: 1, mimeType: "image/png", dataBase64: "x", objectUrl: "blob:1", byteLength: 1 });
store.editor.removeImage(1);
store.editor.nextImageId()
=> 3
```

## reserveIds: advances counters past ids added directly, never rewinds them

Restoring a persisted emission (docs/plans/input-extraction.md, chunk 4)
re-adds items with their ORIGINAL ids (the restored text still carries the
matching `[imageN]`/`[fileN]`/`[selectionN]` tokens), bypassing
`nextImageId()`/`nextFileId()`/`nextSelectionId()` entirely. `reserveIds`
is how the store is told those ids are taken, so a later mint can't collide:

```ts
const store = createEmissionStore();
store.editor.addImage({ id: 5, mimeType: "image/png", dataBase64: "x", objectUrl: "data:x", byteLength: 1 });
store.editor.reserveIds({ image: 5 });
store.editor.nextImageId()
=> 6
```

A lower reservation than the current counter is a no-op — it never rewinds:

```ts continue
store.editor.reserveIds({ image: 2 });
store.editor.nextImageId()
=> 7
```

Files and selections reserve independently, and an absent field in the input
leaves that counter untouched:

```ts
const store = createEmissionStore();
store.editor.reserveIds({ file: 3, selection: 10 });
store.editor.nextFileId()
=> 4

store.editor.nextSelectionId()
=> 11

store.editor.nextImageId()
=> 1
```

## Unrelated slices keep their reference across a mutation

The keystroke-isolation invariant (components/chat/CLAUDE.md) depends on a
selector-based subscriber bailing out of a re-render when its slice didn't
change; that only works if unrelated fields keep the same reference across
a `patch`:

```ts
const store = createEmissionStore();
const imagesBefore = store.get().images;
const filesBefore = store.get().files;
store.editor.setText("hi");
store.get().images === imagesBefore
=> true

store.get().files === filesBefore
=> true
```
