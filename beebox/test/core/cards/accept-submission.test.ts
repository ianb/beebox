// # `acceptSubmission` — batch intake for `submissions`-enabled cards
//
// `acceptSubmission` (`src/core/cards/accept-submission.ts`) is the locked
// read-through-write span behind `POST /api/cards/submit`: it looks up the
// target card's schema, runs the schema's own `submissions.validate`, sniffs
// and lands the uploaded files, writes `records.json`, sets the card's
// `last-upload`, and commits the whole batch as one unit.

import { test, type TestBase } from "tap";
import "@ianbicking/tap-check/tap";
import { any, capture, not, str, unordered } from "@ianbicking/tap-check/check";
import { mkdtemp, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { createEventBus, type EventBus } from "../../../src/core/event-bus/core.js";
import { createBrowserTaskTemplate } from "../../../src/schemas/browser-task.js";
import { acceptSubmission } from "../../../src/core/cards/accept-submission.js";

// A well-formed 1x1 transparent PNG — real magic bytes so file-type sniffing
// reports image/png rather than falling back to octet-stream.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

const RECORD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    permalink: { type: "string" },
    text: { type: "string" },
    photo: { type: "string", format: "attachment" },
  },
  required: ["permalink", "text"],
};

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "submit-"));
}

const box = await makeTmpBox({ git: true });
const eventBus: EventBus = createEventBus(box.root);

await box.write(
  "_content/tasks/Task.browser-task.card",
  createBrowserTaskTemplate({
    title: "Pottery Scan",
    start: "https://example.com/feed",
    prompt: "Scan the feed for show announcements.",
  })
);
await box.write("_content/tasks/Task.attach/schema.json", JSON.stringify(RECORD_SCHEMA, null, 2));
box.commitAll("seed task");

const firstBatch = capture(str`20260912-100000-${any(String)}`);

// ## A well-formed batch is accepted, filed, and committed
void test("A well-formed batch is accepted, filed, and committed", async (t) => {
  t.teardown(async () => {
    try {
      eventBus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L59
  const validTemp = await makeTempDir();
  await writeFile(join(validTemp, "photo.png"), PNG_BYTES);
  const validManifest = {
    coverage: { scanned: 1, stoppedAt: "https://example.com/feed/post-1", reason: "end-of-feed" },
    records: [{ permalink: "https://example.com/feed/post-1", text: "Show announcement", photo: "photo.png" }],
    notes: "this key is not part of the manifest shape",
  };

  // doctest:L67
  const accepted = await acceptSubmission({
    boxRoot: box.root,
    cardRel: "_content/tasks/Task.browser-task.card",
    tempDir: validTemp,
    fileNames: ["photo.png"],
    manifest: validManifest,
    eventBus,
    now: () => new Date("2026-09-12T10:00:00.000Z"),
  });
  t.check(accepted, { ok: true, batch: firstBatch, count: 1, dir: any(String) });
  t.check(accepted, {
    ok: true,
    batch: firstBatch.value,
    count: 1,
    dir: `_content/tasks/Task.attach/inbox/${firstBatch.value}`,
  });

  // The batch dir holds the uploaded file and a `records.json` with a sniffed
  // `files` array; nothing is left under the temp dir:

  // doctest:L84
  const batchDir = accepted.ok ? accepted.dir : "";
  t.check((await readdir(box.path(batchDir))).toSorted(), ["photo.png", "records.json"]);

  // doctest:L88
  const recordsOut = JSON.parse(await box.read(join(batchDir, "records.json")));
  t.check(recordsOut, {
    coverage: { scanned: 1, stoppedAt: "https://example.com/feed/post-1", reason: "end-of-feed" },
    records: [{ permalink: "https://example.com/feed/post-1", text: "Show announcement", photo: "photo.png" }],
    files: [{ name: "photo.png", size: 68, mimetype: "image/png" }],
  });

  // Only the validated shape is persisted, plus the server's `files`; a stray
  // top-level key in the request manifest does not reach disk:

  // doctest:L100

  // The card's `last-upload` is set, and the commit carries both paths under
  // the `card-submission` trailer:

  // doctest:L108
  const cardText = await box.read("_content/tasks/Task.browser-task.card");
  t.checkText(cardText, `---
type: browser-task
title: Pottery Scan
start:
  href: https://example.com/feed
last-upload: 2026-09-12T10:00:00.000Z
---
Scan the feed for show announcements.`);

  // doctest:L112
  const commitBody = execSync("git log -1 --format=%B", { cwd: box.root }).toString();
  t.checkText(commitBody, `Accept submission ${firstBatch.value} for _content/tasks/Task.browser-task.card

Created-By: card-submission`);

  // ## A schema-invalid batch is refused as a unit; nothing is filed

  // doctest:L120
  const invalidTemp = await makeTempDir();
  const invalidManifest = {
    coverage: { scanned: 1, stoppedAt: "https://example.com/feed/post-2", reason: "end-of-feed" },
    records: [{ permalink: "https://example.com/feed/post-2" }], // missing required "text"
  };

  // doctest:L126
  const invalid = await acceptSubmission({
    boxRoot: box.root,
    cardRel: "_content/tasks/Task.browser-task.card",
    tempDir: invalidTemp,
    fileNames: [],
    manifest: invalidManifest,
    eventBus,
    now: () => new Date("2026-09-12T10:05:00.000Z"),
  });
  t.check(invalid, {
    ok: false,
    status: 400,
    message: "submission failed validation",
    issues: [{ path: "records[0].text", message: "Invalid input: expected string, received undefined" }],
  });

  // The temp dir is gone, and the inbox still holds only the one batch from the
  // valid submission above:

  // doctest:L149
  t.check(await readdir(invalidTemp).catch((e) => e.code), "ENOENT");

  // doctest:L152
  t.check(await readdir(box.path("_content/tasks/Task.attach/inbox")), [firstBatch.value]);

  // ## An uploaded file no record references is also refused

  // doctest:L159
  const strayTemp = await makeTempDir();
  const strayManifest = {
    coverage: { scanned: 1, stoppedAt: "https://example.com/feed/post-3", reason: "end-of-feed" },
    records: [{ permalink: "https://example.com/feed/post-3", text: "no photo here" }],
  };

  // doctest:L165
  const stray = await acceptSubmission({
    boxRoot: box.root,
    cardRel: "_content/tasks/Task.browser-task.card",
    tempDir: strayTemp,
    fileNames: ["stray.png"],
    manifest: strayManifest,
    eventBus,
    now: () => new Date("2026-09-12T10:10:00.000Z"),
  });
  t.check(stray, {
    ok: false,
    status: 400,
    message: "submission failed validation",
    issues: [{ path: "files/stray.png", message: "\"stray.png\" is not referenced by any record" }],
  });

  await closedTaskRefused(t);

  // ## A card type that never opted in refuses with 404

  // doctest:L204
  await box.write(
    "_content/notes/Note.doc.card",
    "---\ntitle: Note\n---\nA doc body.\n"
  );
  box.commitAll("seed doc");

  // doctest:L210
  const docTemp = await makeTempDir();
  const docResult = await acceptSubmission({
    boxRoot: box.root,
    cardRel: "_content/notes/Note.doc.card",
    tempDir: docTemp,
    fileNames: [],
    manifest: {},
    eventBus,
    now: () => new Date("2026-09-12T10:20:00.000Z"),
  });
  t.check(docResult, { ok: false, status: 404, message: "this card type does not accept submissions" });

  // A path that leaves the box, or that is not a card, is refused as 404 before any
  // lock is taken, and the temp dir is removed:

  // doctest:L228
  const escapeTemp = await makeTempDir();
  const escaped = await acceptSubmission({
    boxRoot: box.root,
    cardRel: "../../etc/passwd.browser-task.card",
    tempDir: escapeTemp,
    fileNames: [],
    manifest: {},
    eventBus,
    now: () => new Date("2026-09-12T10:00:00Z"),
  });
  t.check(escaped, { ok: false, status: 404, message: "card not found: ../../etc/passwd.browser-task.card" });
  t.check(await readdir(escapeTemp).catch((e) => e.code), "ENOENT");

  // A missing card is also a 404:

  // doctest:L245
  const missingTemp = await makeTempDir();
  const missing = await acceptSubmission({
    boxRoot: box.root,
    cardRel: "_content/tasks/Nope.browser-task.card",
    tempDir: missingTemp,
    fileNames: [],
    manifest: {},
    eventBus,
    now: () => new Date("2026-09-12T10:21:00.000Z"),
  });
  t.check(missing, { ok: false, status: 404, message: "card not found: _content/tasks/Nope.browser-task.card" });

  await concurrentSubmissionsLand(t);
});

// ## A closed task refuses with 409, before any validation runs
async function closedTaskRefused(t: TestBase) {
  // doctest:L181
  await box.write(
    "_content/tasks/Closed.browser-task.card",
    "---\ntype: browser-task\ntitle: Closed Task\nclosed: true\nstart:\n  href: https://example.com/closed\n---\nDone scanning.\n"
  );
  box.commitAll("seed closed task");

  // doctest:L187
  const closedTemp = await makeTempDir();
  const closed = await acceptSubmission({
    boxRoot: box.root,
    cardRel: "_content/tasks/Closed.browser-task.card",
    tempDir: closedTemp,
    fileNames: [],
    manifest: { coverage: { scanned: 0, stoppedAt: "n/a", reason: "end-of-feed" }, records: [] },
    eventBus,
    now: () => new Date("2026-09-12T10:15:00.000Z"),
  });
  t.check(closed, { ok: false, status: 409, message: "this task is closed and no longer accepts submissions" });
}

// ## Two concurrent submissions to the same card both land, with distinct batch ids
//
// `withCardLock` serializes the two read-modify-write spans, so both batches
// are filed — never a lost `last-upload` update.
async function concurrentSubmissionsLand(t: TestBase) {
  // doctest:L265
  const concurrentManifest = (post: string) => ({
    coverage: { scanned: 1, stoppedAt: post, reason: "end-of-feed" },
    records: [{ permalink: post, text: "concurrent" }],
  });
  const tempA = await makeTempDir();
  const tempB = await makeTempDir();

  // doctest:L272
  const [resultA, resultB] = await Promise.all([
    acceptSubmission({
      boxRoot: box.root,
      cardRel: "_content/tasks/Task.browser-task.card",
      tempDir: tempA,
      fileNames: [],
      manifest: concurrentManifest("https://example.com/feed/post-a"),
      eventBus,
      now: () => new Date("2026-09-12T11:00:00.000Z"),
    }),
    acceptSubmission({
      boxRoot: box.root,
      cardRel: "_content/tasks/Task.browser-task.card",
      tempDir: tempB,
      fileNames: [],
      manifest: concurrentManifest("https://example.com/feed/post-b"),
      eventBus,
      now: () => new Date("2026-09-12T11:00:00.000Z"),
    }),
  ]);

  // doctest:L293
  const batchA = capture(str`20260912-110000-${any(String)}`);
  const batchB = capture(str`20260912-110000-${any(String)}`);
  t.check([resultA, resultB], [
    { ok: true, batch: batchA, count: 1, dir: any(String) },
    { ok: true, batch: batchB, count: 1, dir: any(String) },
  ]);
  t.check(batchB.value, not(batchA.value));
  t.check([resultA, resultB], [
    { ok: true, batch: batchA.value, count: 1, dir: `_content/tasks/Task.attach/inbox/${batchA.value}` },
    { ok: true, batch: batchB.value, count: 1, dir: `_content/tasks/Task.attach/inbox/${batchB.value}` },
  ]);
  t.check(
    await readdir(box.path("_content/tasks/Task.attach/inbox")),
    unordered([firstBatch.value, batchA.value, batchB.value]),
  );
}
