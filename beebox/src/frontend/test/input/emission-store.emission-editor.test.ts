// # EmissionEditor — the one mutation surface for the composition draft
//
// `createEmissionStore` (docs/plans/input-extraction.md, chunk 2) holds the
// whole in-progress emission — text, images, pending-image count, files,
// selections — behind one editor. Framework-free (no React/DOM), so it's
// doctestable headlessly; the React bindings
// (`useChatAttachments`/`useChatSelections`) are thin wrappers covered
// elsewhere by typecheck + manual verification.

import { test } from "tap";
import "agent-doctest/tap";
import { createEmissionStore } from "../../src/input/emission-store.js";
import { draftAttachments } from "../../src/input/emission.js";

// ## setText: updater + no-op on an equal value (no notify)
void test("setText: updater + no-op on an equal value (no notify)", async (t) => {
  // doctest:L18
  const store = createEmissionStore();
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });

  // doctest:L22
  store.editor.setText("hello");
  t.check(store.get().text, "hello");

  // doctest:L26
  t.check(notifications, 1);

  // Setting the same value again does not notify — the same guard `input-store.ts`
  // always had, now living in the shared editor:

  // doctest:L34
  store.editor.setText("hello");
  t.check(notifications, 1);

  // An updater function works too, and does notify (the resolved value differs):

  // doctest:L42
  store.editor.setText((prev) => prev + " world");
  t.check(store.get().text, "hello world");

  // doctest:L46
  t.check(notifications, 2);
});

// ## Images: pendingImages accounting, addImage decrements, floor at 0
void test("Images: pendingImages accounting, addImage decrements, floor at 0", async (t) => {
  // doctest:L53
  const store = createEmissionStore();
  store.editor.setText("check [image#1] and [image#2] out");
  store.editor.bumpPendingImages(2);
  t.check(store.get().pendingImages, 2);

  // doctest:L59
  const id1 = store.editor.nextImageId();
  store.editor.addImage({ id: id1, mimeType: "image/png", dataBase64: "aGk=", objectUrl: "blob:1", byteLength: 100, original: { status: "uploading", progress: 0 } });
  t.check(store.get().pendingImages, 1);

  // doctest:L64
  const id2 = store.editor.nextImageId();
  store.editor.addImage({ id: id2, mimeType: "image/png", dataBase64: "aGk=", objectUrl: "blob:2", byteLength: 100, original: { status: "uploading", progress: 0 } });
  t.check(store.get().pendingImages, 0);

  // doctest:L69
  await t.checkText(store.get().images.length, "2");

  // A failed encode (no `addImage` call — nothing to add) is the caller's job to
  // decrement directly; the editor still floors at 0 rather than going negative
  // on an unmatched decrement:

  // doctest:L78
  store.editor.bumpPendingImages(-5);
  t.check(store.get().pendingImages, 0);

  // ## removeImage strips the token — including the bounding whitespace
  //
  // Only the matching id's token is removed; another image's token, and the
  // words around it, are left alone:

  // doctest:L90
  store.editor.removeImage(id1);
  t.check(store.get().text, "check and [image#2] out");

  // doctest:L94
  t.check(store.get().images.map((i) => i.id), [
    2,
  ]);
});

// ## Files: same token-strip shape, independent id sequence
void test("Files: same token-strip shape, independent id sequence", async (t) => {
  // doctest:L101
  const store = createEmissionStore();
  store.editor.setText("see [file#1] please");
  const fid = store.editor.nextFileId();
  store.editor.addFile({ id: fid, originalName: "report.pdf", size: 10, mimetype: "application/pdf", state: { status: "uploaded", path: "_tmp/report.pdf" } });
  await t.checkText(store.get().files.length, "1");

  // doctest:L108
  store.editor.removeFile(fid);
  t.check(store.get().text, "see please");

  // doctest:L112
  await t.checkText(store.get().files.length, "0");
});

// ## Selections: same token-strip shape
void test("Selections: same token-strip shape", async (t) => {
  // doctest:L119
  const store = createEmissionStore();
  store.editor.setText("compare [selection#1] with the doc");
  const sid = store.editor.nextSelectionId();
  store.editor.addSelection({ id: sid, ref: "/_content/notes/Bread.doc.card", text: "let it rise", position: "body" });
  await t.checkText(store.get().selections.length, "1");

  // doctest:L126
  store.editor.removeSelection(sid);
  t.check(store.get().text, "compare with the doc");

  // doctest:L130
  await t.checkText(store.get().selections.length, "0");
});

// ## reset("attachments"): clears images+files+pendingImages, id counters restart at 1, hands back object URLs to revoke
//
// Text is untouched by `reset` — the send site clears it itself (today's
// `handleSend` does `resetAttachments(); resetSelections(); inputStore.set("")`
// as three separate calls):
void test("Text is untouched by reset — the send site clears it itself (today's handleSe...", async (t) => {
  // doctest:L141
  const store = createEmissionStore();
  store.editor.setText("two photos");
  store.editor.bumpPendingImages(1);
  const a = store.editor.nextImageId();
  store.editor.addImage({ id: a, mimeType: "image/png", dataBase64: "x", objectUrl: "blob:a", byteLength: 1, original: { status: "uploading", progress: 0 } });
  const b = store.editor.nextImageId();
  store.editor.addImage({ id: b, mimeType: "image/png", dataBase64: "x", objectUrl: "blob:b", byteLength: 1, original: { status: "uploading", progress: 0 } });
  const f = store.editor.nextFileId();
  store.editor.addFile({ id: f, originalName: "x.txt", size: 1, mimetype: "text/plain", state: { status: "uploaded", path: "_tmp/x.txt" } });

  // doctest:L151
  const result = store.editor.reset("attachments");
  t.check(result.removedImageObjectUrls, [
    "blob:a",
    "blob:b",
  ]);

  // doctest:L155
  await t.checkText(store.get().images.length, "0");

  // doctest:L158
  await t.checkText(store.get().files.length, "0");

  // doctest:L161
  t.check(store.get().pendingImages, 0);

  // doctest:L164
  t.check(store.get().text, "two photos");

  // Counters restart at 1 — matching today's `resetAttachments`, which resets
  // both id refs (`nextAttachmentIdRef.current = 1`,
  // `nextFileAttachmentIdRef.current = 1`):

  // doctest:L173
  t.check(store.editor.nextImageId(), 1);

  // doctest:L176
  t.check(store.editor.nextFileId(), 1);
});

// `reset("selections")` is the independent counterpart — it never touches
// images/files/pendingImages, and hands back no object URLs (there's nothing
// to revoke):
void test("reset(\"selections\") is the independent counterpart — it never touches images/...", async (t) => {
  // doctest:L185
  const store = createEmissionStore();
  const s1 = store.editor.nextSelectionId();
  store.editor.addSelection({ id: s1, ref: "/a", text: "one", position: "" });
  const result = store.editor.reset("selections");
  t.check(result.removedImageObjectUrls, []);

  // doctest:L192
  await t.checkText(store.get().selections.length, "0");

  // doctest:L195
  t.check(store.editor.nextSelectionId(), 1);
});

// ## Id counters are monotonic within a session — never reused except across a reset
void test("Id counters are monotonic within a session — never reused except across a reset", async (t) => {
  // doctest:L202
  const store = createEmissionStore();
  t.check(store.editor.nextImageId(), 1);

  // doctest:L206
  t.check(store.editor.nextImageId(), 2);

  // doctest:L209
  store.editor.addImage({ id: 1, mimeType: "image/png", dataBase64: "x", objectUrl: "blob:1", byteLength: 1, original: { status: "uploading", progress: 0 } });
  store.editor.removeImage(1);
  t.check(store.editor.nextImageId(), 3);
});

// ## reserveIds: advances counters past ids added directly, never rewinds them
//
// Restoring a persisted emission (docs/plans/input-extraction.md, chunk 4)
// re-adds items with their ORIGINAL ids (the restored text still carries the
// matching `[imageN]`/`[fileN]`/`[selectionN]` tokens), bypassing
// `nextImageId()`/`nextFileId()`/`nextSelectionId()` entirely. `reserveIds`
// is how the store is told those ids are taken, so a later mint can't collide:
void test("Restoring a persisted emission (docs/plans/input-extraction.md, chunk 4) re-a...", async (t) => {
  // doctest:L224
  const store = createEmissionStore();
  store.editor.addImage({ id: 5, mimeType: "image/png", dataBase64: "x", objectUrl: "data:x", byteLength: 1, original: { status: "uploading", progress: 0 } });
  store.editor.reserveIds({ image: 5 });
  t.check(store.editor.nextImageId(), 6);

  // A lower reservation than the current counter is a no-op — it never rewinds:

  // doctest:L234
  store.editor.reserveIds({ image: 2 });
  t.check(store.editor.nextImageId(), 7);
});

// Files and selections reserve independently, and an absent field in the input
// leaves that counter untouched:
void test("Files and selections reserve independently, and an absent field in the input...", async (t) => {
  // doctest:L243
  const store = createEmissionStore();
  store.editor.reserveIds({ file: 3, selection: 10 });
  t.check(store.editor.nextFileId(), 4);

  // doctest:L248
  t.check(store.editor.nextSelectionId(), 11);

  // doctest:L251
  t.check(store.editor.nextImageId(), 1);
});

// ## Unrelated slices keep their reference across a mutation
//
// The keystroke-isolation invariant (components/chat/AGENTS.md) depends on a
// selector-based subscriber bailing out of a re-render when its slice didn't
// change; that only works if unrelated fields keep the same reference across
// a `patch`:
void test("The keystroke-isolation invariant (components/chat/AGENTS.md) depends on a se...", async (t) => {
  // doctest:L263
  const store = createEmissionStore();
  const imagesBefore = store.get().images;
  const filesBefore = store.get().files;
  store.editor.setText("hi");
  await t.checkText(store.get().images === imagesBefore, "true");

  // doctest:L270
  await t.checkText(store.get().files === filesBefore, "true");
});

// ## Removal strips the pre-rename token form too
//
// A composition persisted before 2026-08-25 comes back saying `[image1]`. Taking
// that attachment out has to strip the token the text actually holds, or the
// message ships a reference to a photo that is no longer attached.
void test("A composition persisted before 2026-08-25 comes back saying [image1].", async (t) => {
  // doctest:L281
  const store = createEmissionStore();
  store.editor.setText("look at [image1] here");
  store.editor.addImage({ id: 1, mimeType: "image/png", dataBase64: "aGk=", objectUrl: "blob:1", byteLength: 100, original: { status: "uploading", progress: 0 } });
  store.editor.removeImage(1);
  t.check(store.get().text, "look at here");
});

// ## An image's original file has its own upload state
//
// The inline copy is what the agent sees; the original goes up beside it and
// its state lives on the image (`ImageItem.original`). `setImageOriginal`
// follows `setFileState`'s rule: a result for an image that was removed is a
// no-op, never a resurrection.
void test("The inline copy is what the agent sees; the original goes up beside it and it...", async (t) => {
  // doctest:L297
  const store = createEmissionStore();
  store.editor.bumpPendingImages(1);
  const id = store.editor.nextImageId();
  store.editor.addImage({ id, mimeType: "image/jpeg", dataBase64: "x", objectUrl: "blob:o", byteLength: 1, original: { status: "uploading", progress: 0 } });
  store.editor.setImageOriginal({ id, state: { status: "uploading", progress: 0.5 } });
  t.check(store.get().images[0]?.original, {
    status: "uploading",
    progress: 0.5,
  });

  // doctest:L305
  store.editor.setImageOriginal({ id, state: { status: "uploaded", path: "_tmp/2026-09-16T10-00-00.000Z_IMG_0001.jpg" } });
  t.check(store.get().images[0]?.original, {
    status: "uploaded",
    path: "_tmp/2026-09-16T10-00-00.000Z_IMG_0001.jpg",
  });

  // doctest:L309
  store.editor.removeImage(id);
  store.editor.setImageOriginal({ id, state: { status: "failed", message: "late" } });
  await t.checkText(store.get().images.length, "0");
});

// The emission projection carries the path only once the original landed — a
// failed or in-flight original is an image with pixels and no file.
void test("The emission projection carries the path only once the original landed — a fa...", async (t) => {
  // doctest:L319
  const store = createEmissionStore();
  store.editor.bumpPendingImages(2);
  store.editor.addImage({ id: 1, mimeType: "image/png", dataBase64: "a", objectUrl: "blob:1", byteLength: 1, original: { status: "uploaded", path: "_tmp/a.png" } });
  store.editor.addImage({ id: 2, mimeType: "image/png", dataBase64: "b", objectUrl: "blob:2", byteLength: 1, original: { status: "failed", message: "offline" } });
  t.check(draftAttachments(store.get()).images, [
    {
      id: 1,
      mimeType: "image/png",
      dataBase64: "a",
      path: "_tmp/a.png",
    },
    {
      id: 2,
      mimeType: "image/png",
      dataBase64: "b",
    },
  ]);
});

// ## One upload batch per draft
//
// Every attachment of one message uploads into the same `_tmp/chat/<batch>/`
// directory. The id is minted by the first attachment that needs it, reused
// until the message goes, and cleared with the attachments after a send, so
// the next message gets its own directory. The message id itself is minted at
// send, too late to name the directory.
void test("Every attachment of one message uploads into the same tmp/chat/<batch>/ direc...", async (t) => {
  // doctest:L336
  const store = createEmissionStore();
  t.check(store.get().uploadBatch, null);

  // doctest:L340
  const first = store.editor.uploadBatch();
  await t.checkText(/^[\w-]{8,64}$/.test(first) && store.editor.uploadBatch() === first && store.get().uploadBatch === first, "true");

  // doctest:L344
  store.editor.reset("attachments");
  t.check(store.get().uploadBatch, null);

  // doctest:L348
  await t.checkText(store.editor.uploadBatch() !== first, "true");

  // doctest:L351
  // A restored draft brings its batch back so later uploads join it.
  store.editor.restoreUploadBatch("restored-batch-01");
  t.check(store.editor.uploadBatch(), "restored-batch-01");
});

// ## Images stay in pick order, whatever order their encodes finish
//
// Photos picked together encode at the same time and can finish in any order;
// a small photo picked second often finishes before a large one picked first.
// The list stays in id order, the order the person picked them and the order
// their tokens went into the text, so the thumbnails and the sent
// `<attachments>` block agree with "the first photo":
void test("Photos picked together encode at the same time and can finish in any order; a...", async (t) => {
  // doctest:L366
  const store = createEmissionStore();
  const first = store.editor.nextImageId();
  const second = store.editor.nextImageId();
  store.editor.bumpPendingImages(2);
  store.editor.addImage({ id: second, mimeType: "image/jpeg", dataBase64: "x", objectUrl: "blob:small", byteLength: 1, original: { status: "uploading", progress: 0 } });
  store.editor.addImage({ id: first, mimeType: "image/jpeg", dataBase64: "x", objectUrl: "blob:large", byteLength: 1, original: { status: "uploading", progress: 0 } });
  t.check(store.get().images.map((image) => image.id), [
    1,
    2,
  ]);
});
