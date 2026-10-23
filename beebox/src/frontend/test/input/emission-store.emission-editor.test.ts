// # EmissionEditor — the one mutation surface for the composition draft
//
// `createEmissionStore` (docs/plans/input-extraction.md, chunk 2) holds the
// whole in-progress emission — text, images, pending-image count, files,
// selections — behind one editor. Framework-free (no React/DOM), so it's
// testable headlessly; the React bindings
// (`useChatAttachments`/`useChatSelections`) are thin wrappers covered
// elsewhere by typecheck + manual verification.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, not, is } from "@ianbicking/tap-check/check";
import { createEmissionStore } from "../../src/input/emission-store.js";
import { draftAttachments } from "../../src/input/emission.js";

// ## setText: updater + no-op on an equal value (no notify)
void test("setText: updater + no-op on an equal value (no notify)", async (t) => {
  const store = createEmissionStore();
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });

  store.editor.setText("hello");
  t.check(store.get(), {
    text: "hello",
    images: [],
    pendingImages: 0,
    files: [],
    selections: [],
    uploadBatch: null,
  });

  t.check(notifications, 1);

  // Setting the same value again does not notify — the same guard `input-store.ts`
  // always had, now living in the shared editor:

  store.editor.setText("hello");
  t.check(notifications, 1);

  // An updater function works too, and does notify (the resolved value differs):

  store.editor.setText((prev) => prev + " world");
  t.check(store.get(), {
    text: "hello world",
    images: [],
    pendingImages: 0,
    files: [],
    selections: [],
    uploadBatch: null,
  });

  t.check(notifications, 2);
});

// ## Images: pendingImages accounting, addImage decrements, floor at 0
void test("Images: pendingImages accounting, addImage decrements, floor at 0", async (t) => {
  const store = createEmissionStore();
  store.editor.setText("check [image#1] and [image#2] out");
  store.editor.bumpPendingImages(2);
  t.check(store.get(), {
    text: "check [image#1] and [image#2] out",
    images: [],
    pendingImages: 2,
    files: [],
    selections: [],
    uploadBatch: null,
  });

  const id1 = store.editor.nextImageId();
  store.editor.addImage({ id: id1, mimeType: "image/png", dataBase64: "aGk=", objectUrl: "blob:1", byteLength: 100, original: { status: "uploading", progress: 0 } });
  t.check(store.get(), {
    text: "check [image#1] and [image#2] out",
    images: [
      {
        id: 1,
        mimeType: "image/png",
        dataBase64: "aGk=",
        objectUrl: "blob:1",
        byteLength: 100,
        original: {
          status: "uploading",
          progress: 0,
        },
      },
    ],
    pendingImages: 1,
    files: [],
    selections: [],
    uploadBatch: null,
  });

  const id2 = store.editor.nextImageId();
  store.editor.addImage({ id: id2, mimeType: "image/png", dataBase64: "aGk=", objectUrl: "blob:2", byteLength: 100, original: { status: "uploading", progress: 0 } });
  t.check(store.get(), {
    text: "check [image#1] and [image#2] out",
    images: [
      {
        id: 1,
        mimeType: "image/png",
        dataBase64: "aGk=",
        objectUrl: "blob:1",
        byteLength: 100,
        original: {
          status: "uploading",
          progress: 0,
        },
      },
      {
        id: 2,
        mimeType: "image/png",
        dataBase64: "aGk=",
        objectUrl: "blob:2",
        byteLength: 100,
        original: {
          status: "uploading",
          progress: 0,
        },
      },
    ],
    pendingImages: 0,
    files: [],
    selections: [],
    uploadBatch: null,
  });

  // A failed encode (no `addImage` call — nothing to add) is the caller's job to
  // decrement directly; the editor still floors at 0 rather than going negative
  // on an unmatched decrement:

  store.editor.bumpPendingImages(-5);
  t.check(store.get().pendingImages, 0);
});

// ## removeImage strips the token — including the bounding whitespace
//
// Only the matching id's token is removed; another image's token, and the
// words around it, are left alone:
void test("removeImage strips only the matching id's token", async (t) => {
  const store = createEmissionStore();
  store.editor.setText("check [image#1] and [image#2] out");
  const id1 = store.editor.nextImageId();
  store.editor.addImage({ id: id1, mimeType: "image/png", dataBase64: "aGk=", objectUrl: "blob:1", byteLength: 100, original: { status: "uploading", progress: 0 } });
  const id2 = store.editor.nextImageId();
  store.editor.addImage({ id: id2, mimeType: "image/png", dataBase64: "aGk=", objectUrl: "blob:2", byteLength: 100, original: { status: "uploading", progress: 0 } });

  store.editor.removeImage(id1);
  t.check(store.get(), {
    text: "check and [image#2] out",
    images: [
      {
        id: 2,
        mimeType: "image/png",
        dataBase64: "aGk=",
        objectUrl: "blob:2",
        byteLength: 100,
        original: {
          status: "uploading",
          progress: 0,
        },
      },
    ],
    pendingImages: 0,
    files: [],
    selections: [],
    uploadBatch: null,
  });
});

// ## Files: same token-strip shape, independent id sequence
void test("Files: same token-strip shape, independent id sequence", async (t) => {
  const store = createEmissionStore();
  store.editor.setText("see [file#1] please");
  const fid = store.editor.nextFileId();
  store.editor.addFile({ id: fid, originalName: "report.pdf", size: 10, mimetype: "application/pdf", state: { status: "uploaded", path: "_tmp/report.pdf" } });
  t.check(store.get(), {
    text: "see [file#1] please",
    images: [],
    pendingImages: 0,
    files: [
      {
        id: 1,
        originalName: "report.pdf",
        size: 10,
        mimetype: "application/pdf",
        state: {
          status: "uploaded",
          path: "_tmp/report.pdf",
        },
      },
    ],
    selections: [],
    uploadBatch: null,
  });

  store.editor.removeFile(fid);
  t.check(store.get(), {
    text: "see please",
    images: [],
    pendingImages: 0,
    files: [],
    selections: [],
    uploadBatch: null,
  });
});

// ## Selections: same token-strip shape
void test("Selections: same token-strip shape", async (t) => {
  const store = createEmissionStore();
  store.editor.setText("compare [selection#1] with the doc");
  const sid = store.editor.nextSelectionId();
  store.editor.addSelection({ id: sid, ref: "/_content/notes/Bread.doc.card", text: "let it rise", position: "body" });
  t.check(store.get(), {
    text: "compare [selection#1] with the doc",
    images: [],
    pendingImages: 0,
    files: [],
    selections: [
      {
        id: 1,
        ref: "/_content/notes/Bread.doc.card",
        text: "let it rise",
        position: "body",
      },
    ],
    uploadBatch: null,
  });

  store.editor.removeSelection(sid);
  t.check(store.get(), {
    text: "compare with the doc",
    images: [],
    pendingImages: 0,
    files: [],
    selections: [],
    uploadBatch: null,
  });
});

// ## reset("attachments"): clears images+files+pendingImages, id counters restart at 1, hands back object URLs to revoke
//
// Text is untouched by `reset` — the send site clears it itself (today's
// `handleSend` does `resetAttachments(); resetSelections(); inputStore.set("")`
// as three separate calls):
void test("Text is untouched by reset — the send site clears it itself (today's handleSe...", async (t) => {
  const store = createEmissionStore();
  store.editor.setText("two photos");
  store.editor.bumpPendingImages(1);
  const a = store.editor.nextImageId();
  store.editor.addImage({ id: a, mimeType: "image/png", dataBase64: "x", objectUrl: "blob:a", byteLength: 1, original: { status: "uploading", progress: 0 } });
  const b = store.editor.nextImageId();
  store.editor.addImage({ id: b, mimeType: "image/png", dataBase64: "x", objectUrl: "blob:b", byteLength: 1, original: { status: "uploading", progress: 0 } });
  const f = store.editor.nextFileId();
  store.editor.addFile({ id: f, originalName: "x.txt", size: 1, mimetype: "text/plain", state: { status: "uploaded", path: "_tmp/x.txt" } });

  const result = store.editor.reset("attachments");
  t.check(result.removedImageObjectUrls, [
    "blob:a",
    "blob:b",
  ]);

  t.check(store.get(), {
    text: "two photos",
    images: [],
    pendingImages: 0,
    files: [],
    selections: [],
    uploadBatch: null,
  });

  // Counters restart at 1 — matching today's `resetAttachments`, which resets
  // both id refs (`nextAttachmentIdRef.current = 1`,
  // `nextFileAttachmentIdRef.current = 1`):

  t.check(store.editor.nextImageId(), 1);

  t.check(store.editor.nextFileId(), 1);
});

// `reset("selections")` is the independent counterpart — it never touches
// images/files/pendingImages, and hands back no object URLs (there's nothing
// to revoke):
void test("reset(\"selections\") is the independent counterpart — it never touches images/...", async (t) => {
  const store = createEmissionStore();
  const s1 = store.editor.nextSelectionId();
  store.editor.addSelection({ id: s1, ref: "/a", text: "one", position: "" });
  const result = store.editor.reset("selections");
  t.check(result.removedImageObjectUrls, []);

  t.check(store.get(), {
    text: "",
    images: [],
    pendingImages: 0,
    files: [],
    selections: [],
    uploadBatch: null,
  });

  t.check(store.editor.nextSelectionId(), 1);
});

// ## Id counters are monotonic within a session — never reused except across a reset
void test("Id counters are monotonic within a session — never reused except across a reset", async (t) => {
  const store = createEmissionStore();
  t.check(store.editor.nextImageId(), 1);

  t.check(store.editor.nextImageId(), 2);

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
  const store = createEmissionStore();
  store.editor.addImage({ id: 5, mimeType: "image/png", dataBase64: "x", objectUrl: "data:x", byteLength: 1, original: { status: "uploading", progress: 0 } });
  store.editor.reserveIds({ image: 5 });
  t.check(store.editor.nextImageId(), 6);

  // A lower reservation than the current counter is a no-op — it never rewinds:

  store.editor.reserveIds({ image: 2 });
  t.check(store.editor.nextImageId(), 7);
});

// Files and selections reserve independently, and an absent field in the input
// leaves that counter untouched:
void test("Files and selections reserve independently, and an absent field in the input...", async (t) => {
  const store = createEmissionStore();
  store.editor.reserveIds({ file: 3, selection: 10 });
  t.check(store.editor.nextFileId(), 4);

  t.check(store.editor.nextSelectionId(), 11);

  t.check(store.editor.nextImageId(), 1);
});

// ## Unrelated slices keep their reference across a mutation
//
// The keystroke-isolation invariant (components/chat/AGENTS.md) depends on a
// selector-based subscriber bailing out of a re-render when its slice didn't
// change; that only works if unrelated fields keep the same reference across
// a `patch`:
void test("The keystroke-isolation invariant (components/chat/AGENTS.md) depends on a se...", async (t) => {
  const store = createEmissionStore();
  const imagesBefore = store.get().images;
  const filesBefore = store.get().files;
  store.editor.setText("hi");
  t.check(store.get().images, is(imagesBefore));

  t.check(store.get().files, is(filesBefore));
});

// ## Removal strips the pre-rename token form too
//
// A composition persisted before 2026-08-25 comes back saying `[image1]`. Taking
// that attachment out has to strip the token the text actually holds, or the
// message ships a reference to a photo that is no longer attached.
void test("A composition persisted before 2026-08-25 comes back saying [image1].", async (t) => {
  const store = createEmissionStore();
  store.editor.setText("look at [image1] here");
  store.editor.addImage({ id: 1, mimeType: "image/png", dataBase64: "aGk=", objectUrl: "blob:1", byteLength: 100, original: { status: "uploading", progress: 0 } });
  store.editor.removeImage(1);
  t.check(store.get(), {
    text: "look at here",
    images: [],
    pendingImages: 0,
    files: [],
    selections: [],
    uploadBatch: null,
  });
});

// ## An image's original file has its own upload state
//
// The inline copy is what the agent sees; the original goes up beside it and
// its state lives on the image (`ImageItem.original`). `setImageOriginal`
// follows `setFileState`'s rule: a result for an image that was removed is a
// no-op, never a resurrection.
void test("The inline copy is what the agent sees; the original goes up beside it and it...", async (t) => {
  const store = createEmissionStore();
  store.editor.bumpPendingImages(1);
  const id = store.editor.nextImageId();
  store.editor.addImage({ id, mimeType: "image/jpeg", dataBase64: "x", objectUrl: "blob:o", byteLength: 1, original: { status: "uploading", progress: 0 } });
  store.editor.setImageOriginal({ id, state: { status: "uploading", progress: 0.5 } });
  t.check(store.get(), {
    text: "",
    images: [
      {
        id: 1,
        mimeType: "image/jpeg",
        dataBase64: "x",
        objectUrl: "blob:o",
        byteLength: 1,
        original: {
          status: "uploading",
          progress: 0.5,
        },
      },
    ],
    pendingImages: 0,
    files: [],
    selections: [],
    uploadBatch: null,
  });

  store.editor.setImageOriginal({ id, state: { status: "uploaded", path: "_tmp/2026-09-16T10-00-00.000Z_IMG_0001.jpg" } });
  t.check(store.get().images.map((image) => image.original), [
    {
      status: "uploaded",
      path: "_tmp/2026-09-16T10-00-00.000Z_IMG_0001.jpg",
    },
  ]);

  store.editor.removeImage(id);
  store.editor.setImageOriginal({ id, state: { status: "failed", message: "late" } });
  t.check(store.get(), {
    text: "",
    images: [],
    pendingImages: 0,
    files: [],
    selections: [],
    uploadBatch: null,
  });
});

// The emission projection carries the path only once the original landed — a
// failed or in-flight original is an image with pixels and no file.
void test("The emission projection carries the path only once the original landed — a fa...", async (t) => {
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
  const store = createEmissionStore();
  const first = store.editor.uploadBatch();
  t.check(first, any(String).matches(/^[\w-]{8,64}$/));
  t.check(store.editor.uploadBatch(), first);
  t.check(store.get().uploadBatch, first);

  store.editor.reset("attachments");
  t.check(store.get().uploadBatch, null);
  t.check(store.editor.uploadBatch(), not(first));

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
  const store = createEmissionStore();
  const first = store.editor.nextImageId();
  const second = store.editor.nextImageId();
  store.editor.bumpPendingImages(2);
  store.editor.addImage({ id: second, mimeType: "image/jpeg", dataBase64: "x", objectUrl: "blob:small", byteLength: 1, original: { status: "uploading", progress: 0 } });
  store.editor.addImage({ id: first, mimeType: "image/jpeg", dataBase64: "x", objectUrl: "blob:large", byteLength: 1, original: { status: "uploading", progress: 0 } });
  t.check(store.get(), {
    text: "",
    images: [
      {
        id: 1,
        mimeType: "image/jpeg",
        dataBase64: "x",
        objectUrl: "blob:large",
        byteLength: 1,
        original: {
          status: "uploading",
          progress: 0,
        },
      },
      {
        id: 2,
        mimeType: "image/jpeg",
        dataBase64: "x",
        objectUrl: "blob:small",
        byteLength: 1,
        original: {
          status: "uploading",
          progress: 0,
        },
      },
    ],
    pendingImages: 0,
    files: [],
    selections: [],
    uploadBatch: null,
  });
});
