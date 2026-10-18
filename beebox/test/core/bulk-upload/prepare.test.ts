// # Bulk-upload preparation worker
//
// `prepareBulkBatch` turns a bulk staging session into a committed
// `upload-batch` document under a chat's `tmp-upload/`: it copies the staged
// files into the batch's attach scope, writes the summary card, and commits the
// card and the blobs.
// Staging is not deleted. Everything runs at the `makeTmpBox()` filesystem
// tier — no chat runtime, no delivery (that is a later chunk).

import { test } from "tap";
import "agent-doctest/tap";
import { containing, isoDate } from "agent-doctest/check";
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { splitCardContent } from "../../../src/exports/cards.js";
import {
  createStagingSession,
  addFile,
  registerBulkItems,
  readStagingSession,
  writeStagingSession,
  stagingSessionDir,
  type AddFileParams,
} from "../../../src/core/capture/staging-store/core.js";
import type { StagingBulkItem } from "../../../src/core/capture/staging-schema.js";
import { selectPendingCaptures, selectResumableCaptures } from "../../../src/core/capture/pending.js";
import { prepareBulkBatch } from "../../../src/core/bulk-upload/prepare.js";
import { checkBoxRoot } from "../../../src/lib/box-root-check.js";
import { parseUploadBatch } from "../../../src/schemas/upload-batch.js";
import { attachDirFor } from "../../../src/shared/attach-path.js";

/** Blob basenames in a batch attach scope — the control files are not blobs. */
function blobNames(listing: string): string[] {
  return listing
    .split("\n")
    .map((l) => l.split("/").pop() ?? "")
    .filter((n) => n !== "" && n !== ".gitattributes" && !n.endsWith(".card"))
    .toSorted();
}


async function pathExists(p: string) {
  try { await access(p); return true; } catch (_e) { return false; }
}

async function catchName(promise: Promise<unknown>) {
  try { await promise; return "no-throw"; } catch (e) { return e instanceof Error ? e.name : String(e); }
}

function trackedFiles(boxRoot: string) {
  return execFileSync("git", ["ls-files"], { cwd: boxRoot }).toString().trim().split("\n");
}

// Stage a bulk session with a predeclared item registry, then upload some of
// the registered items' bytes. `filename` is the on-disk staged name; the
// client-claimed `originalName` is what the batch sanitizes/dedupes to.
async function stageBulk(
  boxRoot: string,
  opts: {
    expectedItems: StagingBulkItem[];
    files: (Omit<AddFileParams, "boxRoot" | "id" | "buffer"> & { content: string })[];
  },
) {
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

// ## Happy path: card + commit, blobs staged
//
// Two registered items, both uploaded. The batch lands as a card + attach scope;
// the card records each blob's server-computed size; the card and the blobs both
// commit. Whether the blobs land as annex pointers
// rather than bytes is what `prepare-annex.doctest.md` covers — this tier runs on
// a plain git box and cannot tell the two apart.
void test("Two registered items, both uploaded.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L86
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

  // doctest:L98
  const batch = await prepareBulkBatch({ boxRoot: box.root, id, contextDir: "" });
  assert.ok(batch);
  t.check(batch.counts, {
    registered: 2,
    received: 2,
    missing: 0,
    failed: 0,
  });

  // The card carries the batch summary: not yet `delivered`, the counts, total bytes, and
  // a received list with server-computed sizes and client-claimed mimetypes:
  const card = await box.read(batch.cardRelPath);
  t.checkText(card, `---
batch-id: ${batch.batchSlug}
time:
  start: «date»
  end: 2026-07-27T14:00:05.000Z
counts:
  registered: 2
  received: 2
  missing: 0
  failed: 0
total-bytes: 11
received:
  - name: report.pdf
    size: 6
    mimetype: application/pdf
  - name: photo.png
    size: 5
    mimetype: image/png
---
2 files uploaded (11 B).`);

  // The attach scope holds both blobs, and no `manifest.json` is written:
  // git-annex records the content hash itself, so a hand-maintained inventory
  // beside it was a second record of the same fact.
  t.checkText(await box.list(batch.attachRelDir), `${batch.attachRelDir}/.gitattributes
${batch.attachRelDir}/photo.png
${batch.attachRelDir}/report.pdf`);

  // The card **and the blobs** are committed, with the
  // `Created-By: bulk-upload` trailer.
  //
  // This previously staged an explicit `[card, manifest, .gitignore]` list and
  // asserted `blobTracked: false` — correct under the manifest model, where the
  // bytes were gitignored on purpose. Under git-annex it is a silent data-loss bug:
  // `git annex pre-commit` cannot annex a path that was never passed to `git add`,
  // so the batch would commit a card describing content that exists in no
  // repository, and the staging copy is cleaned up after delivery. The batch-local
  // `.gitattributes` routes the blobs into the annex; the assertion below is what
  // proves they were actually handed to git at all.
  t.check(execFileSync("git", ["log", "--format=%s"], { cwd: box.root }).toString().trim().split("\n"), [
    `Upload batch: ${batch.batchSlug}`,
    "init",
  ]);
  t.check(execFileSync("git", ["log", "--format=%(trailers:key=Created-By,valueonly)"], { cwd: box.root }).toString(), "bulk-upload\n\n\n");
  // The box scaffold tracks dozens of files; the batch's card and blobs are the contract.
  t.check(trackedFiles(box.root), containing([
    batch.cardRelPath,
    `${batch.attachRelDir}/.gitattributes`,
    `${batch.attachRelDir}/photo.png`,
    `${batch.attachRelDir}/report.pdf`,
  ]));
  t.check(await pathExists(box.path(`${batch.attachRelDir}/report.pdf`)), true);

  // Staging is retained (not deleted at prepare time):

  // doctest:L159
  t.check(await readStagingSession({ boxRoot: box.root, id }), {
    id,
    createdAt: isoDate(),
    lastActivityAt: isoDate(),
    targetSessionId: null,
    createdBy: null,
    kind: "bulk",
    state: "open",
    segments: [],
    photos: [],
    files: [
      { filename: "staged-0.bin", uploadedAt: "2026-07-27T14:00:00.000Z", originalName: "report.pdf", mimeType: "application/pdf", itemId: "a" },
      { filename: "staged-1.bin", uploadedAt: "2026-07-27T14:00:05.000Z", originalName: "photo.png", mimeType: "image/png", itemId: "b" },
    ],
    expectedItems: [
      { id: "a", name: "report.pdf", size: 6, mimetype: "application/pdf" },
      { id: "b", name: "photo.png", size: 5, mimetype: "image/png" },
    ],
    totalBytes: 11,
  });
});

// ## Where a batch lands: the chat's context dir, `_content/` at the root scope
//
// A chat scoped to a landmark lands its batch under that landmark's directory. A
// chat scoped to the whole box (`contextDir` `""`) lands under `_content/`, which
// is where the root scope lives on disk. The box root itself is a closed
// vocabulary: a bare `tmp-upload/` there made the commit hook refuse every batch,
// so the batch never committed and its `<upload>` message never went out.
void test("A chat scoped to a landmark lands its batch under that landmark's directory.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L176
  const box = await makeTmpBox({ git: true });
  const file = { filename: "s0.bin", uploadedAt: "2026-07-27T14:00:00.000Z", originalName: "a.jpg", mimeType: "image/jpeg", itemId: "a", content: "JPG" };
  const rootId = await stageBulk(box.root, { expectedItems: [{ id: "a", name: "a.jpg" }], files: [file] });
  const scopedId = await stageBulk(box.root, { expectedItems: [{ id: "a", name: "a.jpg" }], files: [file] });

  // doctest:L181
  const atRoot = await prepareBulkBatch({ boxRoot: box.root, id: rootId, contextDir: "" });
  assert.ok(atRoot);
  const scoped = await prepareBulkBatch({ boxRoot: box.root, id: scopedId, contextDir: "_content/projects/garden" });
  assert.ok(scoped);
  t.check([atRoot.cardRelPath, scoped.cardRelPath], [
    `_content/tmp-upload/${atRoot.batchSlug}/${atRoot.batchSlug}.upload-batch.card`,
    `_content/projects/garden/tmp-upload/${scoped.batchSlug}/${scoped.batchSlug}.upload-batch.card`,
  ]);

  // The card is named after the batch, so its attach scope is the one every
  // attach-aware tool derives from the card (`<basename>.attach`). `bbx rm` and
  // `bbx mv` carry the files with the card; the former fixed name,
  // `Batch.upload-batch.attach`, matched no tool and was left behind.

  // doctest:L196
  t.check(atRoot.attachRelDir, `_content/tmp-upload/${atRoot.batchSlug}/${atRoot.batchSlug}.attach`);
  t.check(attachDirFor(atRoot.cardRelPath), `_content/tmp-upload/${atRoot.batchSlug}/${atRoot.batchSlug}.attach`);

  // Neither batch leaves anything at the box root for the root check to refuse:

  // doctest:L203
  t.check(await checkBoxRoot(box.root), []);
});

// ## A batch prepared under the old fixed names keeps them
//
// Before 2026-10 every batch was `Batch.upload-batch.card` beside
// `Batch.upload-batch.attach/`. A batch the old code had written but not yet
// delivered (an agent was busy, then the server restarted for a deploy) resumes
// under those names. Deriving the new name instead would find no card, prepare
// the batch a second time, and deliver a second `<upload>` message.
void test("Before 2026-10 every batch was Batch.upload-batch.card beside Batch.upload-ba...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L220
  const box = await makeTmpBox({ git: true });
  const id = await stageBulk(box.root, {
    expectedItems: [{ id: "a", name: "a.jpg" }],
    files: [{ filename: "s0.bin", uploadedAt: "2026-07-27T14:00:00.000Z", originalName: "a.jpg", mimeType: "image/jpeg", itemId: "a", content: "JPG" }],
  });
  // What the old code left: the batch prepared and committed under the fixed names.
  const fresh = await prepareBulkBatch({ boxRoot: box.root, id, contextDir: "" });
  assert.ok(fresh);
  const dir = fresh.cardRelPath.slice(0, fresh.cardRelPath.lastIndexOf("/"));
  execFileSync("git", ["mv", fresh.cardRelPath, `${dir}/Batch.upload-batch.card`], { cwd: box.root });
  execFileSync("git", ["mv", fresh.attachRelDir, `${dir}/Batch.upload-batch.attach`], { cwd: box.root });
  execFileSync("git", ["commit", "-qm", "old names"], { cwd: box.root });

  // doctest:L233
  const resumed = await prepareBulkBatch({ boxRoot: box.root, id, contextDir: "" });
  assert.ok(resumed);
  t.check(
    ({
      card: resumed.cardRelPath.slice(dir.length + 1),
      scope: resumed.attachRelDir.slice(dir.length + 1),
      entries: (await readdir(box.path(dir))).toSorted(),
      received: resumed.counts.received,
    }),
    {
    card: "Batch.upload-batch.card",
    scope: "Batch.upload-batch.attach",
    entries: [
      "Batch.upload-batch.attach",
      "Batch.upload-batch.card",
    ],
    received: 1,
  },
  );
});

// ## A reported failure whose bytes arrived counts as received
//
// The uploader's failed list is its claim; the staged bytes are the fact. A phone
// can give up on an upload that timed out on its side after the box had already
// received every byte. That item is received, and the card must not report it
// as lost.
void test("The uploader's failed list is its claim; the staged bytes are the fact.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L256
  const box = await makeTmpBox({ git: true });
  const id = await stageBulk(box.root, {
    expectedItems: [{ id: "a", name: "photo-009.jpg" }, { id: "b", name: "photo-010.jpg" }],
    files: [
      { filename: "s0.bin", uploadedAt: "2026-07-27T14:00:00.000Z", originalName: "photo-009.jpg", mimeType: "image/jpeg", itemId: "a", content: "JPEG" },
    ],
  });
  const batch = await prepareBulkBatch({
    boxRoot: box.root, id, contextDir: "",
    failedItems: [
      { id: "a", name: "photo-009.jpg", reason: "The request timed out" },
      { id: "b", name: "photo-010.jpg", reason: "The request timed out" },
    ],
  });
  assert.ok(batch);
  const card = await box.read(batch.cardRelPath);
  t.check(({ counts: batch.counts, body: splitCardContent(card).body.trim() }), {
    counts: {
      registered: 2,
      received: 1,
      missing: 0,
      failed: 1,
    },
    body: "1 file uploaded (4 B); 1 failed.",
  });

  // Only `photo-010.jpg`, whose bytes never arrived, stays in `failed`:

  // doctest:L279
  const fm = parseUploadBatch(card)?.frontmatter;
  t.check(fm?.failed, [{ name: "photo-010.jpg", reason: "The request timed out" }]);
  t.check(fm?.received, [{ name: "photo-009.jpg", size: 4, mimetype: "image/jpeg" }]);
});

// ## Missing items are computed from the registry, failed from the caller
//
// A registered item whose bytes never arrived is `missing`; an item the caller
// reports failing is `failed` (with its reason); the rest are `received`.
void test("A registered item whose bytes never arrived is missing; an item the caller re...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L294
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

  // doctest:L305
  const batch = await prepareBulkBatch({
    boxRoot: box.root, id, contextDir: "",
    failedItems: [{ id: "c", name: "broke.mov", reason: "upload timed out" }],
  });
  assert.ok(batch);
  t.check(batch.counts, {
    registered: 3,
    received: 1,
    missing: 1,
    failed: 1,
  });

  // The card names the missing item (registered but never arrived) and the failed
  // item with its reason:

  // doctest:L318
  const card = await box.read(batch.cardRelPath);
  t.checkText(card, `---
batch-id: ${batch.batchSlug}
time:
  start: «date»
  end: 2026-07-27T14:00:00.000Z
counts:
  registered: 3
  received: 1
  missing: 1
  failed: 1
total-bytes: 4
received:
  - name: arrived.pdf
    size: 4
    mimetype: application/pdf
missing:
  - name: never.pdf
failed:
  - name: broke.mov
    reason: upload timed out
---
1 file uploaded (4 B); 1 missing; 1 failed.`);
});

// ## Filename collisions dedupe with a numeric suffix (extension preserved)
//
// Two uploads with the same original name land as distinct files; the card
// records both, and the card's received list carries both stored names.
void test("Two uploads with the same original name land as distinct files; the card reco...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L338
  const box = await makeTmpBox({ git: true });
  const id = await stageBulk(box.root, {
    expectedItems: [{ id: "a", name: "IMG_1234.jpg" }, { id: "b", name: "IMG_1234.jpg" }],
    files: [
      { filename: "s0.bin", uploadedAt: "2026-07-27T14:00:00.000Z", originalName: "IMG_1234.jpg", mimeType: "image/jpeg", itemId: "a", content: "AAAA" },
      { filename: "s1.bin", uploadedAt: "2026-07-27T14:00:01.000Z", originalName: "IMG_1234.jpg", mimeType: "image/jpeg", itemId: "b", content: "BBBBBB" },
    ],
  });

  // doctest:L347
  const batch = await prepareBulkBatch({ boxRoot: box.root, id, contextDir: "" });
  assert.ok(batch);
  t.check(blobNames(await box.list(batch.attachRelDir)), [
    "IMG_1234-2.jpg",
    "IMG_1234.jpg",
  ]);

  // Both stored names appear in the card's received list:

  // doctest:L356
  const card = await box.read(batch.cardRelPath);
  t.checkText(card, `---
batch-id: ${batch.batchSlug}
time:
  start: «date»
  end: 2026-07-27T14:00:01.000Z
counts:
  registered: 2
  received: 2
  missing: 0
  failed: 0
total-bytes: 10
received:
  - name: IMG_1234.jpg
    size: 4
    mimetype: image/jpeg
  - name: IMG_1234-2.jpg
    size: 6
    mimetype: image/jpeg
---
2 files uploaded (10 B).`);
  t.check(batch.counts, { registered: 2, received: 2, missing: 0, failed: 0 });

  // An unsafe original name is sanitized (path parts stripped, spaces/odd chars
  // collapsed), keeping the extension:

  // doctest:L368
  const box2 = await makeTmpBox({ git: true });
  const id2 = await stageBulk(box2.root, {
    expectedItems: [{ id: "a", name: "../../etc/My Report (final).pdf" }],
    files: [{ filename: "s0.bin", uploadedAt: "2026-07-27T14:00:00.000Z", originalName: "../../etc/My Report (final).pdf", mimeType: "application/pdf", itemId: "a", content: "X" }],
  });
  const b2 = await prepareBulkBatch({ boxRoot: box2.root, id: id2, contextDir: "" });
  assert.ok(b2);
  t.check(blobNames(await box2.list(b2.attachRelDir)), [
    "My-Report-final.pdf",
  ]);
});

// ## Re-run is idempotent: no second batch, no second commit
//
// A crash after prepare committed leaves the batch in place; re-running targets
// the same slug (derived from the stable session `createdAt` + id), skips the
// copy/rewrite, and commits nothing new.
void test("A crash after prepare committed leaves the batch in place; re-running targets...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L390
  const box = await makeTmpBox({ git: true });
  const id = await stageBulk(box.root, {
    expectedItems: [{ id: "a", name: "doc.pdf" }],
    files: [{ filename: "s0.bin", uploadedAt: "2026-07-27T14:00:00.000Z", originalName: "doc.pdf", mimeType: "application/pdf", itemId: "a", content: "DOC" }],
  });

  // doctest:L396
  const first = await prepareBulkBatch({ boxRoot: box.root, id, contextDir: "" });
  assert.ok(first);
  const cardAfterFirst = await box.read(first.cardRelPath);
  const uploadSubjects = () => execFileSync("git", ["log", "--format=%s"], { cwd: box.root }).toString().trim().split("\n").filter((s) => s.startsWith("Upload batch:"));
  t.check(uploadSubjects(), [`Upload batch: ${first.batchSlug}`]);

  // Re-running produces the same slug, an unchanged card, and still one commit:
  const second = await prepareBulkBatch({ boxRoot: box.root, id, contextDir: "" });
  assert.ok(second);
  t.check(second.batchSlug, first.batchSlug);
  t.check(second.counts, first.counts);
  t.check(await box.read(second.cardRelPath), cardAfterFirst);
  t.check(uploadSubjects(), [`Upload batch: ${first.batchSlug}`]);
});

// ## A bulk session is not a capture session
//
// `prepareBulkBatch` refuses a capture (non-bulk) session, and the capture
// enumerators skip bulk sessions. A fresh capture session defaults `kind` to
// `"capture"`; a legacy manifest with no `kind` reads back the same way.
void test("prepareBulkBatch refuses a capture (non-bulk) session, and the capture enumer...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L429
  const box = await makeTmpBox({ git: true });
  const capture = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null });
  const bulk = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null, kind: "bulk", expectedItems: [] });

  // doctest:L433
  t.check(capture.kind, "capture");

  // An old manifest predating the field parses as `capture` (additive default):

  // doctest:L440
  const legacy = {
    id: "legacy-1", createdAt: "2026-07-27T14:00:00.000Z", lastActivityAt: "2026-07-27T14:00:00.000Z",
    targetSessionId: "chat-1", state: "open", segments: [], photos: [], files: [],
  };
  await mkdir(stagingSessionDir(box.root, "legacy-1"), { recursive: true });
  await writeFile(`${stagingSessionDir(box.root, "legacy-1")}/session.json`, JSON.stringify(legacy));
  t.check((await readStagingSession({ boxRoot: box.root, id: "legacy-1" }))?.kind, "capture");

  // `prepareBulkBatch` throws on the capture session:

  // doctest:L453
  t.check(await catchName(prepareBulkBatch({ boxRoot: box.root, id: capture.id, contextDir: "" })), "NotABulkSessionError");

  // Both capture selectors exclude the bulk session — a pending (sealed) capture is
  // surfaced but the bulk one isn't; a resumable (open, non-empty) capture is
  // surfaced but the bulk one isn't:

  // doctest:L462
  const nonEmpty = [{ filename: "x", uploadedAt: "t", originalName: "x", mimeType: "" }];
  const pending = selectPendingCaptures({
    sessions: [{ ...capture, state: "sealed" }, { ...bulk, state: "sealed" }],
    sessionId: "chat-1",
  }).map((p) => p.id);
  const resumable = selectResumableCaptures({
    sessions: [{ ...capture, state: "open", files: nonEmpty }, { ...bulk, state: "open", files: nonEmpty }],
    targetSessionId: "chat-1", clientSessionId: null, requestingUser: null,
  }).map((r) => r.id);
  t.check(pending, [capture.id]);
  t.check(resumable, [capture.id]);
});

// ## The batch's introduction lands in the card and survives a re-run
//
// The boxholder's composer text is recorded on the sealed session, and prepare
// carries it into the card's `note` frontmatter — that is what tells the agent the
// batch is introduced, so it files against the note instead of asking what the
// files are.
void test("The boxholder's composer text is recorded on the sealed session, and prepare...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L490
  const box = await makeTmpBox({ git: true });
  const id = await stageBulk(box.root, {
    expectedItems: [{ id: "a", name: "IMG_0001.jpg", size: 4, mimetype: "image/jpeg" }],
    files: [
      { filename: "staged-0.bin", uploadedAt: "2026-07-30T19:12:00.000Z", originalName: "IMG_0001.jpg", mimeType: "image/jpeg", itemId: "a", content: "JPEG" },
    ],
  });
  // The seal is what records the note; stage it directly here (the route-tier
  // test covers the seal itself).
  const session = await readStagingSession({ boxRoot: box.root, id });
  assert.ok(session);
  session.note = "Receipts from the Tokyo trip";
  await writeStagingSession({ boxRoot: box.root, session });

  // doctest:L504
  const prepared = await prepareBulkBatch({ boxRoot: box.root, id, contextDir: "" });
  assert.ok(prepared);
  t.check(prepared.note, "Receipts from the Tokyo trip");

  // The card records it as frontmatter, labelled as the boxholder's own words rather
  // than anything server-computed or client-guessed:

  // doctest:L514
  const card = await readFile(join(box.root, prepared.cardRelPath), "utf-8");
  t.checkText(splitCardContent(card).frontmatterText, `batch-id: ${prepared.batchSlug}
time:
  start: «date»
  end: 2026-07-30T19:12:00.000Z
counts:
  registered: 1
  received: 1
  missing: 0
  failed: 0
total-bytes: 4
received:
  - name: IMG_0001.jpg
    size: 4
    mimetype: image/jpeg
note: Receipts from the Tokyo trip`);

  // A re-run is idempotent: the card already exists, so the summary — including the
  // note — is recovered from it rather than rebuilt, and the `<upload>` message a
  // resumed delivery builds is identical to the first one's.

  // doctest:L524
  const rerun = await prepareBulkBatch({ boxRoot: box.root, id, contextDir: "" });
  assert.ok(rerun);
  t.check(rerun.note, "Receipts from the Tokyo trip");
  t.check(rerun.cardRelPath, prepared.cardRelPath);

  // A batch with no introduction reports none — the case the agent's "ask first"
  // duty exists for:

  // doctest:L534
  const plainId = await stageBulk(box.root, {
    expectedItems: [{ id: "z", name: "IMG_9999.jpg", size: 4, mimetype: "image/jpeg" }],
    files: [
      { filename: "staged-0.bin", uploadedAt: "2026-07-30T19:20:00.000Z", originalName: "IMG_9999.jpg", mimeType: "image/jpeg", itemId: "z", content: "JPEG" },
    ],
  });
  const plain = await prepareBulkBatch({ boxRoot: box.root, id: plainId, contextDir: "" });
  assert.ok(plain);
  t.check({ note: plain.note ?? null }, {
    note: null,
  });
});

// ## A failed item never masks a same-named item that simply never arrived
//
// Failures are keyed by registry id when the uploader knows it, and by name only
// as the fallback for one that doesn't. Keying by both would let a single failure
// swallow every other registry entry sharing that name, so `registered` would stop
// reconciling with `received + failed + missing` — which is the one thing the
// predeclared registry exists to guarantee.
//
// Two picks are both called `image.png`. Item `a` is reported failed; item `b`
// never arrives. `b` must still show up as missing.
void test("Failures are keyed by registry id when the uploader knows it, and by name onl...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L562
  const box = await makeTmpBox({ git: true });
  const id = await stageBulk(box.root, {
    expectedItems: [
      { id: "a", name: "image.png", size: 4, mimetype: "image/png" },
      { id: "b", name: "image.png", size: 4, mimetype: "image/png" },
    ],
    files: [],
  });
  const prepared = await prepareBulkBatch({
    boxRoot: box.root,
    id,
    contextDir: "",
    failedItems: [{ id: "a", name: "image.png", reason: "network error" }],
  });
  assert.ok(prepared);
  t.check(prepared.counts, {
    registered: 2,
    received: 0,
    missing: 1,
    failed: 1,
  });
});
