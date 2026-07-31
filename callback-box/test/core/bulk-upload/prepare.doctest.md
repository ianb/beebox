# Bulk-upload preparation worker

`prepareBulkBatch` turns a bulk staging session into a committed
`upload-batch` document under a chat's `tmp-upload/`: it copies the staged
files into the batch's attach scope, writes that scope's asset `manifest.json`,
writes the summary card, and commits the card + manifest (blobs stay out of
git). Staging is not deleted. Everything runs at the `makeTmpBox()` filesystem
tier — no chat runtime, no delivery (that is a later chunk).

```ts setup
import { execFileSync } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { splitCardContent } from "../../../src/cards/index.js";
import {
  createStagingSession,
  addFile,
  registerBulkItems,
  readStagingSession,
  stagingSessionDir,
} from "../../../src/core/capture/staging-store.js";
import { selectPendingCaptures, selectResumableCaptures } from "../../../src/core/capture/pending.js";
import { prepareBulkBatch } from "../../../src/core/bulk-upload/prepare.js";

async function pathExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function catchName(promise) {
  try { await promise; return "no-throw"; } catch (e) { return e.name; }
}

function trackedFiles(boxRoot) {
  return execFileSync("git", ["ls-files"], { cwd: boxRoot }).toString().trim().split("\n");
}

// Stage a bulk session with a predeclared item registry, then upload some of
// the registered items' bytes. `filename` is the on-disk staged name; the
// client-claimed `originalName` is what the batch sanitizes/dedupes to.
async function stageBulk(boxRoot, opts) {
  const staged = await createStagingSession({
    boxRoot, targetSessionId: null, createdBy: null, kind: "bulk", expectedItems: opts.expectedItems,
  });
  for (const f of opts.files) {
    await addFile({
      boxRoot, id: staged.id, filename: f.filename, uploadedAt: f.uploadedAt,
      originalName: f.originalName, mimeType: f.mimeType, itemId: f.itemId, buffer: Buffer.from(f.content),
    });
  }
  return staged.id;
}
```

## Happy path: card + attach manifest + commit, blobs untracked

Two registered items, both uploaded. The batch lands as a card + attach scope;
the manifest records each blob's server-computed size + sha256; the card + the
manifest commit, and the blobs themselves are never staged.

```ts
const box = await makeTmpBox({ git: true });
const id = await stageBulk(box.root, {
  expectedItems: [
    { id: "a", name: "report.pdf", size: 6, mimetype: "application/pdf" },
    { id: "b", name: "photo.png", size: 5, mimetype: "image/png" },
  ],
  files: [
    { filename: "staged-0.bin", uploadedAt: "2026-07-27T14:00:00.000Z", originalName: "report.pdf", mimeType: "application/pdf", itemId: "a", content: "PDFPDF" },
    { filename: "staged-1.bin", uploadedAt: "2026-07-27T14:00:05.000Z", originalName: "photo.png", mimeType: "image/png", itemId: "b", content: "PNGPN" },
  ],
});

const batch = await prepareBulkBatch({ boxRoot: box.root, id, contextDir: "" });
JSON.stringify(batch.counts)
=> {"registered":2,"received":2,"missing":0,"failed":0}
```

The card carries the batch summary: status `new`, the counts, total bytes, and
a received list with server-computed sizes and client-claimed mimetypes:

```ts continue
const card = await box.read(batch.cardRelPath);
JSON.stringify({
  status: card.includes("status: new"),
  batchId: card.includes(`batch-id: ${batch.batchSlug}`),
  totalBytes: batch.totalBytes,
  body: splitCardContent(card).body.trim(),
})
=> {"status":true,"batchId":true,"totalBytes":11,"body":"2 files uploaded (11 B)."}
```

The attach manifest inventories both blobs with a size + sha256 each:

```ts continue
const manifest = JSON.parse(await box.read(`${batch.attachRelDir}/manifest.json`));
JSON.stringify({
  names: Object.keys(manifest.files).sort(),
  reportSize: manifest.files["report.pdf"].size,
  hasHash: typeof manifest.files["photo.png"].sha256 === "string" && manifest.files["photo.png"].sha256.length === 64,
})
=> {"names":["photo.png","report.pdf"],"reportSize":6,"hasHash":true}
```

The card, manifest, **and the blobs** are committed, with the
`Created-By: bulk-upload` trailer.

This previously staged an explicit `[card, manifest, .gitignore]` list and
asserted `blobTracked: false` — correct under the manifest model, where the
bytes were gitignored on purpose. Under git-annex it is a silent data-loss bug:
`git annex pre-commit` cannot annex a path that was never passed to `git add`,
so the batch would commit a card describing content that exists in no
repository, and the staging copy is cleaned up after delivery. The batch-local
`.gitattributes` routes the blobs into the annex; the assertion below is what
proves they were actually handed to git at all.

```ts continue
const subjects = execFileSync("git", ["log", "--format=%s"], { cwd: box.root }).toString().trim().split("\n");
const tracked = trackedFiles(box.root);
JSON.stringify({
  committed: subjects.includes(`Upload batch: ${batch.batchSlug}`),
  trailer: execFileSync("git", ["log", "--format=%(trailers:key=Created-By,valueonly)"], { cwd: box.root }).toString().includes("bulk-upload"),
  cardTracked: tracked.includes(batch.cardRelPath),
  manifestTracked: tracked.includes(`${batch.attachRelDir}/manifest.json`),
  blobTracked: tracked.some((f) => f.endsWith("report.pdf")),
  blobOnDisk: await pathExists(box.path(`${batch.attachRelDir}/report.pdf`)),
})
=> {"committed":true,"trailer":true,"cardTracked":true,"manifestTracked":true,"blobTracked":true,"blobOnDisk":true}
```

Staging is retained (not deleted at prepare time):

```ts continue
(await readStagingSession({ boxRoot: box.root, id })) !== null
=> true
```

```ts cleanup
await box.cleanup();
```

## Missing items are computed from the registry, failed from the caller

A registered item whose bytes never arrived is `missing`; an item the caller
reports failing is `failed` (with its reason); the rest are `received`.

```ts
const box = await makeTmpBox({ git: true });
// Register the first item up front, then append the rest (as the picker would
// stream them in) via registerBulkItems.
const id = await stageBulk(box.root, {
  expectedItems: [{ id: "a", name: "arrived.pdf" }],
  files: [
    { filename: "s0.bin", uploadedAt: "2026-07-27T14:00:00.000Z", originalName: "arrived.pdf", mimeType: "application/pdf", itemId: "a", content: "HERE" },
  ],
});
await registerBulkItems({ boxRoot: box.root, id, items: [{ id: "b", name: "never.pdf" }, { id: "c", name: "broke.mov" }] });

const batch = await prepareBulkBatch({
  boxRoot: box.root, id, contextDir: "",
  failedItems: [{ id: "c", name: "broke.mov", reason: "upload timed out" }],
});
JSON.stringify(batch.counts)
=> {"registered":3,"received":1,"missing":1,"failed":1}
```

The card names the missing item (registered but never arrived) and the failed
item with its reason:

```ts continue
const card = await box.read(batch.cardRelPath);
JSON.stringify({
  missing: card.includes("never.pdf"),
  failedName: card.includes("broke.mov"),
  failedReason: card.includes("upload timed out"),
  body: splitCardContent(card).body.trim(),
})
=> {"missing":true,"failedName":true,"failedReason":true,"body":"1 file uploaded (4 B); 1 missing; 1 failed."}
```

```ts cleanup
await box.cleanup();
```

## Filename collisions dedupe with a numeric suffix (extension preserved)

Two uploads with the same original name land as distinct files; the manifest
records both, and the card's received list carries both stored names.

```ts
const box = await makeTmpBox({ git: true });
const id = await stageBulk(box.root, {
  expectedItems: [{ id: "a", name: "IMG_1234.jpg" }, { id: "b", name: "IMG_1234.jpg" }],
  files: [
    { filename: "s0.bin", uploadedAt: "2026-07-27T14:00:00.000Z", originalName: "IMG_1234.jpg", mimeType: "image/jpeg", itemId: "a", content: "AAAA" },
    { filename: "s1.bin", uploadedAt: "2026-07-27T14:00:01.000Z", originalName: "IMG_1234.jpg", mimeType: "image/jpeg", itemId: "b", content: "BBBBBB" },
  ],
});

const batch = await prepareBulkBatch({ boxRoot: box.root, id, contextDir: "" });
const manifest = JSON.parse(await box.read(`${batch.attachRelDir}/manifest.json`));
JSON.stringify(Object.keys(manifest.files).sort())
=> ["IMG_1234-2.jpg","IMG_1234.jpg"]
```

Both stored files exist on disk with their own bytes, and both appear in the
card's received list:

```ts continue
const card = await box.read(batch.cardRelPath);
JSON.stringify({
  first: await pathExists(box.path(`${batch.attachRelDir}/IMG_1234.jpg`)),
  second: await pathExists(box.path(`${batch.attachRelDir}/IMG_1234-2.jpg`)),
  received: batch.counts.received,
  bothNamed: card.includes("IMG_1234.jpg") && card.includes("IMG_1234-2.jpg"),
})
=> {"first":true,"second":true,"received":2,"bothNamed":true}
```

An unsafe original name is sanitized (path parts stripped, spaces/odd chars
collapsed), keeping the extension:

```ts continue
const box2 = await makeTmpBox({ git: true });
const id2 = await stageBulk(box2.root, {
  expectedItems: [{ id: "a", name: "../../etc/My Report (final).pdf" }],
  files: [{ filename: "s0.bin", uploadedAt: "2026-07-27T14:00:00.000Z", originalName: "../../etc/My Report (final).pdf", mimeType: "application/pdf", itemId: "a", content: "X" }],
});
const b2 = await prepareBulkBatch({ boxRoot: box2.root, id: id2, contextDir: "" });
JSON.stringify(Object.keys(JSON.parse(await box2.read(`${b2.attachRelDir}/manifest.json`)).files))
=> ["My-Report-final.pdf"]
```

```ts cleanup
await box.cleanup();
```

## Re-run is idempotent: no second batch, no second commit

A crash after prepare committed leaves the batch in place; re-running targets
the same slug (derived from the stable session `createdAt` + id), skips the
copy/rewrite, and commits nothing new.

```ts
const box = await makeTmpBox({ git: true });
const id = await stageBulk(box.root, {
  expectedItems: [{ id: "a", name: "doc.pdf" }],
  files: [{ filename: "s0.bin", uploadedAt: "2026-07-27T14:00:00.000Z", originalName: "doc.pdf", mimeType: "application/pdf", itemId: "a", content: "DOC" }],
});

const first = await prepareBulkBatch({ boxRoot: box.root, id, contextDir: "" });
const cardAfterFirst = await box.read(first.cardRelPath);
const commitsAfterFirst = execFileSync("git", ["log", "--format=%s"], { cwd: box.root }).toString().trim().split("\n").filter((s) => s.startsWith("Upload batch:")).length;
commitsAfterFirst
=> 1
```

Re-running produces the same slug, an unchanged card, and still one commit:

```ts continue
const second = await prepareBulkBatch({ boxRoot: box.root, id, contextDir: "" });
JSON.stringify({
  sameSlug: second.batchSlug === first.batchSlug,
  sameCounts: JSON.stringify(second.counts) === JSON.stringify(first.counts),
  cardUnchanged: (await box.read(second.cardRelPath)) === cardAfterFirst,
  commits: execFileSync("git", ["log", "--format=%s"], { cwd: box.root }).toString().trim().split("\n").filter((s) => s.startsWith("Upload batch:")).length,
})
=> {"sameSlug":true,"sameCounts":true,"cardUnchanged":true,"commits":1}
```

```ts cleanup
await box.cleanup();
```

## A bulk session is not a capture session

`prepareBulkBatch` refuses a capture (non-bulk) session, and the capture
enumerators skip bulk sessions. A fresh capture session defaults `kind` to
`"capture"`; a legacy manifest with no `kind` reads back the same way.

```ts
const box = await makeTmpBox({ git: true });
const capture = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null });
const bulk = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null, kind: "bulk", expectedItems: [] });

capture.kind
=> capture

bulk.kind
=> bulk
```

An old manifest predating the field parses as `capture` (additive default):

```ts continue
const legacy = {
  id: "legacy-1", createdAt: "2026-07-27T14:00:00.000Z", lastActivityAt: "2026-07-27T14:00:00.000Z",
  targetSessionId: "chat-1", state: "open", segments: [], photos: [], files: [],
};
await mkdir(stagingSessionDir(box.root, "legacy-1"), { recursive: true });
await writeFile(`${stagingSessionDir(box.root, "legacy-1")}/session.json`, JSON.stringify(legacy));
(await readStagingSession({ boxRoot: box.root, id: "legacy-1" })).kind
=> capture
```

`prepareBulkBatch` throws on the capture session:

```ts continue
await catchName(prepareBulkBatch({ boxRoot: box.root, id: capture.id, contextDir: "" }))
=> NotABulkSessionError
```

Both capture selectors exclude the bulk session — a pending (sealed) capture is
surfaced but the bulk one isn't; a resumable (open, non-empty) capture is
surfaced but the bulk one isn't:

```ts continue
const nonEmpty = [{ filename: "x", uploadedAt: "t", originalName: "x", mimeType: "" }];
const pending = selectPendingCaptures({
  sessions: [{ ...capture, state: "sealed" }, { ...bulk, state: "sealed" }],
  sessionId: "chat-1",
}).map((p) => p.id);
const resumable = selectResumableCaptures({
  sessions: [{ ...capture, state: "open", files: nonEmpty }, { ...bulk, state: "open", files: nonEmpty }],
  targetSessionId: "chat-1", clientSessionId: null, requestingUser: null,
}).map((r) => r.id);
JSON.stringify({
  pendingOnlyCapture: pending.length === 1 && pending[0] === capture.id,
  resumableOnlyCapture: resumable.length === 1 && resumable[0] === capture.id,
})
=> {"pendingOnlyCapture":true,"resumableOnlyCapture":true}
```

```ts cleanup
await box.cleanup();
```
