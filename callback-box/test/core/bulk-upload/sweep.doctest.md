# Bulk-upload sweep

`sweepBulkBatches` reconciles stuck batches, surfaces abandoned staging, and
turns a ≥7-day unfiled `tmp-upload/` batch into a self-note to its target chat.
It runs at the filesystem tier — the reconciliation `firePreparation` and the
`notifyUnfiled` self-note injection are passed in as callbacks so the sweep's
decisions are inspected directly, without a chat runtime.

```ts setup
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { appendHistory, resolveSessionLogPath } from "../../../src/core/chat/session/history.js";
import {
  createStagingSession,
  addFile,
  setStagingState,
  setBulkFailedItems,
  readStagingSession,
  writeStagingSession,
} from "../../../src/core/capture/staging-store.js";
import { bulkBatchCardRelPath } from "../../../src/core/bulk-upload/prepare.js";
import { createUploadBatchTemplate } from "../../../src/schemas/upload-batch.js";
import { sweepBulkBatches } from "../../../src/core/bulk-upload/sweep.js";

const OLD = "2020-01-01T00:00:00.000Z";

// Create a bulk session in a given state, optionally aged + with a file.
async function makeBulk(boxRoot, opts) {
  const staged = await createStagingSession({
    boxRoot, targetSessionId: opts.target ?? null, createdBy: null, kind: "bulk",
    contextDir: opts.contextDir ?? "", expectedItems: [{ id: "a", name: "a.pdf" }],
  });
  if (opts.withFile) {
    await addFile({
      boxRoot, id: staged.id, filename: "s0.bin", uploadedAt: "2026-07-27T14:00:00.000Z",
      originalName: "a.pdf", mimeType: "application/pdf", itemId: "a", buffer: Buffer.from("PDFPDF"),
    });
  }
  await setStagingState({ boxRoot, id: staged.id, state: opts.state });
  if (opts.aged) {
    const s = await readStagingSession({ boxRoot, id: staged.id });
    s.lastActivityAt = OLD;
    await writeStagingSession({ boxRoot, session: s });
  }
  return staged;
}

async function seedTranscript(boxRoot, sessionId, text) {
  await appendHistory(boxRoot, { sessionId });
  const logPath = await resolveSessionLogPath(boxRoot, sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, text);
}
```

## Reconciliation re-fires stuck batches; a not-yet-landed delivering one is left

`sealed`/`preparing` batches are always re-fired. A `delivering` batch is
re-fired only once its `<upload>` message is confirmed in the transcript (so the
re-fire just finishes cleanup) — one whose message hasn't landed is left for the
next startup, never re-sent live (which could double-deliver).

```ts
const box = await makeTmpBox();
const sealed = await makeBulk(box.root, { state: "sealed" });
const preparing = await makeBulk(box.root, { state: "preparing" });

// A delivering batch whose <upload> already landed in the target transcript.
const landedTarget = "s-landed";
const delivering1 = await makeBulk(box.root, { state: "delivering", target: landedTarget });
const doc = bulkBatchCardRelPath({ startedAt: delivering1.createdAt, id: delivering1.id, contextDir: "" });
await seedTranscript(box.root, landedTarget, JSON.stringify({ type: "user", text: `<upload doc="${doc}">` }) + "\n");

// A delivering batch whose message never landed (empty transcript).
const delivering2 = await makeBulk(box.root, { state: "delivering", target: "s-lost" });
await seedTranscript(box.root, "s-lost", "");

const fired = [];
const result = await sweepBulkBatches({ boxRoot: box.root, firePreparation: (id) => fired.push(id) });
JSON.stringify({
  refired: fired.slice().sort(),
  landedRefired: fired.includes(delivering1.id),
  lostSkipped: !fired.includes(delivering2.id),
})
=> {"refired":["«*»","«*»","«*»"],"landedRefired":true,"lostSkipped":true}
```

The re-fired set is exactly {sealed, preparing, delivering-landed}:

```ts continue
JSON.stringify({
  sealed: fired.includes(sealed.id),
  preparing: fired.includes(preparing.id),
  count: fired.length,
})
=> {"sealed":true,"preparing":true,"count":3}
```

```ts cleanup
await box.cleanup();
```

## Abandonment: an empty open batch is discarded; a non-empty one is surfaced

An `open` batch idle past the window is surfaced (never auto-finalized). Empty
staging is discarded; a batch with received files is reported as abandoned. A
recent open batch is left alone.

```ts
const box = await makeTmpBox();
const emptyOld = await makeBulk(box.root, { state: "open", aged: true });
const nonEmptyOld = await makeBulk(box.root, { state: "open", aged: true, withFile: true });
const recent = await makeBulk(box.root, { state: "open", withFile: true });

const result = await sweepBulkBatches({ boxRoot: box.root });
JSON.stringify({
  discarded: result.discarded,
  abandoned: result.abandoned,
  emptyGone: (await readStagingSession({ boxRoot: box.root, id: emptyOld.id })) === null,
  recentKept: (await readStagingSession({ boxRoot: box.root, id: recent.id })) !== null,
})
=> {"discarded":["«*»"],"abandoned":["«*»"],"emptyGone":true,"recentKept":true}
```

```ts continue
JSON.stringify({ discardedIsEmpty: result.discarded[0] === emptyOld.id, abandonedIsNonEmpty: result.abandoned[0] === nonEmptyOld.id })
=> {"discardedIsEmpty":true,"abandonedIsNonEmpty":true}
```

```ts cleanup
await box.cleanup();
```

## Unfiled ≥7-day batches are surfaced to their target chat via self-note

A `delivered` upload-batch card still under a `tmp-upload/` past the stale age is
handed to `notifyUnfiled` with its resolved target session (mapped from the
enclosing context dir); a recent one is not.

```ts
const box = await makeTmpBox();
await appendHistory(box.root, { sessionId: "s-x", contextDir: "store/x" });

async function writeBatchCard(relDir, startedAt) {
  const card = createUploadBatchTemplate({
    batchId: "upload-x", startedAt, registered: 1, totalBytes: 6,
    received: [{ name: "a.pdf", size: 6 }], missing: [], failed: [], summary: "1 file uploaded (6 B).",
  }).replace("status: new", "status: delivered");
  await mkdir(box.path(relDir), { recursive: true });
  await writeFile(box.path(`${relDir}/Batch.upload-batch.card`), card);
}

await writeBatchCard("store/x/tmp-upload/upload-old", OLD);
await writeBatchCard("store/x/tmp-upload/upload-new", "2026-07-27T00:00:00.000Z");

const notified = [];
const result = await sweepBulkBatches({ boxRoot: box.root, notifyUnfiled: (b) => notified.push(b) });
JSON.stringify({
  count: notified.length,
  path: notified[0]?.cardRelPath,
  session: notified[0]?.sessionId,
  aged: (notified[0]?.ageDays ?? 0) > 1000,
})
=> {"count":1,"path":"store/x/tmp-upload/upload-old/Batch.upload-batch.card","session":"s-x","aged":true}
```

```ts cleanup
await box.cleanup();
```
