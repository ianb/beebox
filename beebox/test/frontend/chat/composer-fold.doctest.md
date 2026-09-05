# Folding composer photos into a batch, and putting them back

When a file set routes to the bulk-upload batch, the photos already in the
composer go with it — one selection act, one destination. That removal is made
on the assumption the batch will be delivered, so it has to be reversible:
cancelling an upload is not a request to discard photos you had already
attached (`issues/bugs/2026-08-22-batch-cancel-loses-folded-composer-photos.md`).

```ts setup
import { createEmissionStore } from "../../../src/frontend/src/input/emission-store.js";
import { foldComposerImages, restoreFoldedImages } from "../../../src/frontend/src/components/chat/composer-fold.js";

function withPhotos(text, photos) {
  const store = createEmissionStore();
  store.editor.setText(text);
  for (const p of photos) {
    store.editor.addImage({
      id: store.editor.nextImageId(),
      mimeType: p.mimeType,
      dataBase64: p.dataBase64,
      objectUrl: `blob:${p.dataBase64}`,
      byteLength: 3,
    });
  }
  return store;
}
```

## The fold empties the composer and hands the photos over as files

`aGk=` is "hi" — the bytes only have to survive the round trip.

```ts
const store = withPhotos("look at [image#1] and [image#2]", [
  { mimeType: "image/webp", dataBase64: "aGk=" },
  { mimeType: "image/png", dataBase64: "aGk=" },
]);
const fold = foldComposerImages(store);
JSON.stringify([store.get().text, store.get().images.length])
=> ["look at and ",0]

fold.files.map((f) => `${f.name} ${f.type} ${String(f.size)}`).join(", ")
=> pasted-image-1.webp image/webp 2, pasted-image-2.png image/png 2
```

The extension names the format the bytes actually are. The encoder prefers
WebP (`canvas-encode.ts`), so a re-encoded photo is usually WebP — calling it
`.jpg`, as this used to, hands the box a file whose extension contradicts its
content.

Note the trailing space: `removeImage` strips a token plus one bounding
whitespace char, and collapses the rest — it does not trim the ends. The
restore below is what puts the sentence back exactly, which is the point.

## Restoring puts back the photos AND the tokens that anchored them

The text is restored whole, not rebuilt: the tokens were at particular places
in a particular sentence, and re-appending them would move them.

```ts continue
restoreFoldedImages(store, fold);
JSON.stringify([store.get().text, store.get().images.map((i) => i.id)])
=> ["look at [image#1] and [image#2]",[1,2]]
```

## A photo still encoding is neither folded nor lost

`pendingImages` counts photos whose bytes are not there yet, so they cannot
join the batch. They stay behind, finish, and go out with the next ordinary
send — and restoring must not disturb that count, or the placeholder tile for a
genuinely in-flight photo disappears.

```ts
const store = withPhotos("one [image#1] plus one arriving", [{ mimeType: "image/png", dataBase64: "aGk=" }]);
store.editor.bumpPendingImages(1);
const fold = foldComposerImages(store);
store.get().pendingImages
=> 1

restoreFoldedImages(store, fold);
JSON.stringify([store.get().pendingImages, store.get().images.length])
=> [1,1]
```

## Nothing attached, nothing to undo

```ts
const store = createEmissionStore();
store.editor.setText("just words");
JSON.stringify(foldComposerImages(store))
=> null
```

## A file attached alongside is not swept up

The fold takes photos, not the whole attachment slate. A PDF the user attached
separately is not joining this batch and must still be there afterwards — the
reason removal goes id-by-id instead of through `reset("attachments")`.

```ts
const store = withPhotos("photo [image#1] and doc [file#1]", [{ mimeType: "image/png", dataBase64: "aGk=" }]);
store.editor.addFile({ id: store.editor.nextFileId(), path: "_tmp/a.pdf", originalName: "a.pdf", size: 9, mimetype: "application/pdf" });
foldComposerImages(store);
JSON.stringify([store.get().text, store.get().files.length])
=> ["photo and doc [file#1]",1]
```
