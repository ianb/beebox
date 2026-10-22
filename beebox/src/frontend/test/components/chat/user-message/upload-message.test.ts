// # Upload wrapper parsing
//
// `parseUploadWrapper` is a single-wrapper compatibility helper over the shared
// ordered-parts parser. Production transcript rendering consumes the shared
// parser directly. The wrapper is built server-side by
// `core/bulk-upload/deliver.ts` `buildUploadWrapper` — these cases are written
// against that exact output, so generation and parsing cannot drift silently.
//
// Without this parser the wrapper fell through to the plain-text renderer and the
// boxholder saw literal markup in their own chat log (prod, 2026-08-01). That
// mattered more than the usual raw-markup annoyance because their own introduction
// rides *inside* the body, so their words were wrapped in angle brackets too.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import assert from "node:assert/strict";
import { parseUploadWrapper } from "../../../../src/components/chat/user-message/upload-message.js";

// ## An introduced batch: the note is the user's words, the summary is the machine's
//
// This is the real wrapper shape from a box's second batch.
void test("This is the real wrapper shape from a box's second batch.", async (t) => {
  const model = parseUploadWrapper(`<upload doc="_content/documents/property/shop/tmp-upload/upload-20260801T0035-a56e0530/Batch.upload-batch.card" files="16" bytes="135 MB">
Shop exterior

16 files uploaded (135 MB).
</upload>`);
  assert.ok(model);
  t.check({ files: model.files, bytes: model.bytes, note: model.note, summary: model.summary, failed: model.failed }, {
    files: 16,
    bytes: "135 MB",
    note: "Shop exterior",
    summary: "16 files uploaded (135 MB).",
    failed: 0,
  });
});

// ## A batch with no introduction has an empty note, not a blank first line
//
// The server omits the note entirely rather than sending an empty one, so the body
// is the summary alone.
void test("The server omits the note entirely rather than sending an empty one, so the b...", async (t) => {
  const model = parseUploadWrapper(`<upload doc="tmp-upload/b/Batch.upload-batch.card" files="3" bytes="2 KB">
3 files uploaded (2 KB).
</upload>`);
  assert.ok(model);
  t.check({ note: model.note, summary: model.summary }, {
    note: "",
    summary: "3 files uploaded (2 KB).",
  });
});

// ## A multi-paragraph introduction stays intact
//
// Splitting on the LAST blank line keeps the whole introduction together — a user
// who writes two paragraphs shouldn't have the first silently become the summary.
void test("Splitting on the LAST blank line keeps the whole introduction together — a us...", async (t) => {
  const model = parseUploadWrapper(`<upload doc="tmp-upload/c/Batch.upload-batch.card" files="2" bytes="1 KB">
Receipts from the Tokyo trip.

File them under 2026 travel.

2 files uploaded (1 KB).
</upload>`);
  assert.ok(model);
  t.check({ note: model.note, summary: model.summary }, {
    note: `Receipts from the Tokyo trip.

File them under 2026 travel.`,
    summary: "2 files uploaded (1 KB).",
  });
});

// ## Failures are surfaced
void test("Failures are surfaced", async (t) => {
  const model = parseUploadWrapper(`<upload doc="tmp-upload/d/Batch.upload-batch.card" files="31" bytes="4.2 KB" failed="3">
31 files uploaded (4.2 KB); 3 failed.
</upload>`);
  assert.ok(model);
  t.check({ files: model.files, failed: model.failed }, {
    files: 31,
    failed: 3,
  });
});

// ## Anything that isn't an upload wrapper parses as null
//
// Ordinary text, and a sibling `<capture>` wrapper, must both fall through to
// their own renderers.
void test("Ordinary text, and a sibling <capture> wrapper, must both fall through to the...", async (t) => {
  t.check(
    {
      plain: parseUploadWrapper("just a message"),
      capture: parseUploadWrapper("<capture doc=\"x.capture-session.card\" images=\"3\">3 photos</capture>"),
      noDoc: parseUploadWrapper("<upload files=\"2\">2 files uploaded.</upload>"),
    },
    {
    plain: null,
    capture: null,
    noDoc: null,
  },
  );
});
