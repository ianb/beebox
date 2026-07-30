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

## Abandonment: a batch with nothing to report is discarded; anything else is surfaced

An `open` batch idle past the window is surfaced (never auto-finalized). Only a
batch with **nothing to report at all** is discarded — no received files, no
reported failures, no registered items, no note. A batch that registered items
and never uploaded them is NOT empty: it is wholly missing, and the registry
exists so that case still produces a report. `makeBulk` registers one item, so
both aged batches below are surfaced as abandoned rather than discarded. A recent
open batch is left alone.

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
=> {"discarded":[],"abandoned":["«*»","«*»"],"emptyGone":false,"recentKept":true}
```

Both aged batches are surfaced, and both are still on disk — the sweep reports
them for the uploader to finish, it never finalizes or deletes them:

```ts continue
JSON.stringify({
  bothAbandoned: [emptyOld.id, nonEmptyOld.id].every((id) => result.abandoned.includes(id)),
  registeredKept: (await readStagingSession({ boxRoot: box.root, id: emptyOld.id })) !== null,
  nonEmptyKept: (await readStagingSession({ boxRoot: box.root, id: nonEmptyOld.id })) !== null,
})
=> {"bothAbandoned":true,"registeredKept":true,"nonEmptyKept":true}
```

```ts cleanup
await box.cleanup();
```

## A `delivered` batch with leaked staging is torn down

Delivery cleans up staging, but if that teardown was swallowed the session sits
on disk in state `delivered`. The sweep revisits it and retries the delete
(logging + retrying next cycle if it fails again), so staging never leaks:

```ts
const box = await makeTmpBox();
const delivered = await makeBulk(box.root, { state: "delivered", withFile: true });

const result = await sweepBulkBatches({ boxRoot: box.root });
JSON.stringify({
  cleaned: result.cleaned,
  gone: (await readStagingSession({ boxRoot: box.root, id: delivered.id })) === null,
})
=> {"cleaned":["«*»"],"gone":true}
```

```ts continue
JSON.stringify({ cleanedIsDelivered: result.cleaned[0] === delivered.id })
=> {"cleanedIsDelivered":true}
```

```ts cleanup
await box.cleanup();
```

## Unfiled ≥7-day batches are surfaced to their target chat via self-note, once

A `delivered` upload-batch card still under a `tmp-upload/` past the stale age is
handed to `notifyUnfiled` with the ORIGINAL target session persisted on the card
(`target-session`, written at prepare time — not reconstructed from the context
dir's history); a recent one is not.

```ts
const box = await makeTmpBox({ git: true });

async function writeBatchCard(relDir, startedAt) {
  const card = createUploadBatchTemplate({
    batchId: "upload-x", targetSessionId: "s-target", startedAt, registered: 1, totalBytes: 6,
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
=> {"count":1,"path":"store/x/tmp-upload/upload-old/Batch.upload-batch.card","session":"s-target","aged":true}
```

The batch is marked `sweep-notified` (committed), so a SECOND sweep does not
re-fire the self-note — it notifies at most once ever, not every cycle:

```ts continue
const notified2 = [];
await sweepBulkBatches({ boxRoot: box.root, notifyUnfiled: (b) => notified2.push(b) });
const marked = (await box.read("store/x/tmp-upload/upload-old/Batch.upload-batch.card")).includes("sweep-notified:");
JSON.stringify({ secondSweep: notified2.length, marked })
=> {"secondSweep":0,"marked":true}
```

```ts cleanup
await box.cleanup();
```


## The sweep never discards a batch that has something to report

A batch that registered items but committed no bytes is not empty — it is wholly
*missing*, and the point of the predeclared registry is that such a batch still
produces its report. The emptiness test is shared with the prepare→deliver worker
(`bulkBatchHasNothingToReport`) precisely so the two cannot drift: they each
carried their own copy, the worker's was corrected to count `expectedItems` and
the sweep's was not, so the sweep went on silently deleting registered batches.

`makeBulk` registers one item, so an aged open batch with no bytes is exactly
that case:

```ts
const box = await makeTmpBox();
const registered = await makeBulk(box.root, { state: "open", aged: true });
const result = await sweepBulkBatches({ boxRoot: box.root });
JSON.stringify({
  discarded: result.discarded.includes(registered.id),
  abandoned: result.abandoned.includes(registered.id),
})
=> {"discarded":false,"abandoned":true}
```

A batch with a note is kept too — the boxholder typed it and pressed send:

```ts continue
const noted = await createStagingSession({
  boxRoot: box.root, targetSessionId: null, createdBy: null, kind: "bulk", expectedItems: [],
});
const session = await readStagingSession({ boxRoot: box.root, id: noted.id });
session.note = "these are the receipts";
session.lastActivityAt = OLD;
await writeStagingSession({ boxRoot: box.root, session });

const second = await sweepBulkBatches({ boxRoot: box.root });
second.discarded.includes(noted.id)
=> false
```

A genuinely empty batch — nothing registered, nothing uploaded, nothing said — is
still discarded:

```ts continue
const empty = await createStagingSession({
  boxRoot: box.root, targetSessionId: null, createdBy: null, kind: "bulk", expectedItems: [],
});
const emptySession = await readStagingSession({ boxRoot: box.root, id: empty.id });
emptySession.lastActivityAt = OLD;
await writeStagingSession({ boxRoot: box.root, session: emptySession });

const third = await sweepBulkBatches({ boxRoot: box.root });
third.discarded.includes(empty.id)
=> true
```

A sealed batch is never discarded by the sweep, even if it looks empty — the
worker owns it, and the locked discard refuses:

```ts continue
const sealed = await createStagingSession({
  boxRoot: box.root, targetSessionId: null, createdBy: null, kind: "bulk", expectedItems: [],
});
const sealedSession = await readStagingSession({ boxRoot: box.root, id: sealed.id });
sealedSession.lastActivityAt = OLD;
await writeStagingSession({ boxRoot: box.root, session: sealedSession });
await setStagingState({ boxRoot: box.root, id: sealed.id, state: "sealed" });

const fourth = await sweepBulkBatches({ boxRoot: box.root });
JSON.stringify({
  discarded: fourth.discarded.includes(sealed.id),
  stillOnDisk: (await readStagingSession({ boxRoot: box.root, id: sealed.id })) !== null,
})
=> {"discarded":false,"stillOnDisk":true}
```

```ts cleanup
await box.cleanup();
```
