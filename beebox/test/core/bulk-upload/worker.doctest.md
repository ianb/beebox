# Bulk-upload prepare→deliver worker

`prepareAndDeliverBulkBatch` prepares a sealed bulk staging session (copy + card
+ manifest + commit, via `prepareBulkBatch`) and then delivers an `<upload>`
message to the batch's target chat, with capture's retry discipline: a failed
send leaves the batch retryable, a busy agent leaves it pending for
reconciliation, and the at-most-once probe never double-delivers. A duck-typed
registry with a mock chat session stands in for the Claude subprocess so the
whole worker runs deterministically.

```ts setup
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile, appendFile, mkdir, access } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { createEventBus } from "../../../src/core/event-bus/core.js";
import { appendHistory, resolveSessionLogPath } from "../../../src/core/chat/session/history.js";
import {
  createStagingSession,
  addFile,
  sealStagingSession,
  setStagingState,
  readStagingSession,
} from "../../../src/core/capture/staging-store/core.js";
import { prepareAndDeliverBulkBatch, markBulkPreparationFailed } from "../../../src/core/bulk-upload/worker/core.js";
import { readRecent } from "../../../src/core/notification/log.js";
import { writePresence } from "../../../src/core/notification/presence.js";

/** The box's logged notifications, reduced to what the person sees. */
async function notices(boxRoot) {
  return (await readRecent(boxRoot, { days: 1 })).map(({ intent }) => {
    const { title, body, target, loudness, source } = intent;
    return { title, body, target, loudness, source };
  });
}

async function pathExists(p) {
  try { await access(p); return true; } catch { return false; }
}

function uploadCommitCount(boxRoot) {
  return execFileSync("git", ["log", "--format=%s"], { cwd: boxRoot })
    .toString().split("\n").filter((l) => l.startsWith("Upload batch:")).length;
}

async function batchCardRel(box) {
  const dirs = await readdir(box.path("_content/tmp-upload"));
  return `_content/tmp-upload/${dirs[0]}/Batch.upload-batch.card`;
}

// Stage a sealed bulk session bound to `target`, with one uploaded file.
async function stageSealedBulk(boxRoot, opts) {
  const staged = await createStagingSession({
    boxRoot, targetSessionId: opts.target, createdBy: null, kind: "bulk",
    contextDir: "", expectedItems: [{ id: "a", name: "report.pdf" }],
  });
  await addFile({
    boxRoot, id: staged.id, filename: "s0.bin", uploadedAt: "2026-07-27T14:00:00.000Z",
    originalName: "report.pdf", mimeType: "application/pdf", itemId: "a", buffer: Buffer.from("PDFPDF"),
  });
  // Seal (carrying any failed-item report in the same atomic write, as finalize does).
  await sealStagingSession({ boxRoot, id: staged.id, failedItems: opts.failedItems });
  return staged.id;
}

// A mock registry whose one session records every send.
function mockRegistry(session) {
  return {
    getOrCreate: () => session, createNew: () => session, get: () => session,
    enforceLiveCap: () => {}, touch: () => {}, markMostActive: async () => {},
    // No chat here was coined and reserved (chat/session/reserve.ts).
    getReservation: () => null,
  };
}
```

## Happy path: prepare, deliver the `<upload>` message, clean up staging

The batch lands as a committed card, the `<upload>` wrapper reaches the target
chat, the card flips to `delivered`, and the staging session is cleaned up.

```ts
const box = await makeTmpBox({ git: true });
await appendHistory(box.root, { sessionId: "s-known" });
const id = await stageSealedBulk(box.root, { target: "s-known" });

const sent = [];
const session = {
  isBusy: () => false, enqueue: () => {}, getSessionId: () => "s-known",
  send: async (input) => { sent.push(input.text); return true; },
};
const eventBus = createEventBus(box.root);
await prepareAndDeliverBulkBatch({ boxRoot: box.root, id, eventBus, registry: mockRegistry(session) });

const cardRel = await batchCardRel(box);
JSON.stringify({
  sent: sent.length,
  wrapper: sent[0]?.startsWith(`<upload doc="${cardRel}"`) ?? false,
  delivered: (await box.read(cardRel)).includes("delivered: true"),
  stagingGone: (await readStagingSession({ boxRoot: box.root, id })) === null,
})
=> {"sent":1,"wrapper":true,"delivered":true,"stagingGone":true}
```

```ts cleanup
eventBus.close();
await box.cleanup();
```

## No most-active fallback: an unknown target fails loudly and stays retryable

A batch whose target chat is not known to the box is a broken invariant —
delivery fails loudly (`failed:deliver`), nothing is prepared or misdirected,
and the staging is retained for a retry.

```ts
const box = await makeTmpBox({ git: true });
// Target "s-missing" is deliberately NOT in history.
const id = await stageSealedBulk(box.root, { target: "s-missing" });

const sent = [];
const session = { isBusy: () => false, enqueue: () => {}, getSessionId: () => "x", send: async (i) => { sent.push(i.text); return true; } };
const eventBus = createEventBus(box.root);
await prepareAndDeliverBulkBatch({ boxRoot: box.root, id, eventBus, registry: mockRegistry(session) });

JSON.stringify({
  state: (await readStagingSession({ boxRoot: box.root, id })).state,
  sent: sent.length,
  noBatchDir: !(await pathExists(box.path("_content/tmp-upload"))),
})
=> {"state":"failed:deliver","sent":0,"noBatchDir":true}
```

The person who uploaded is told. They saw finalize succeed and have likely put
the phone down, so the box sends one `quiet` notification to the chat the batch
was headed for:

```ts continue
JSON.stringify(await notices(box.root), null, 1)
=> [
 {
  "title": "An upload could not be added to the chat",
  "body": "1 file reached the box but could not be added to the chat. The chat it was sent to no longer exists. They are kept on the box, and the assistant will be asked to recover them.",
  "target": "chat:s-missing",
  "loudness": "quiet",
  "source": "bulk-upload"
 }
]
```

```ts cleanup
eventBus.close();
await box.cleanup();
```

## A preparation that throws is recorded and reported, even with the app open

The finalize route, the startup resume and the sweep all catch a worker that
threw (a refused commit, say) and record it through `markBulkPreparationFailed`.
The error text stays in the server log; the person gets a plain sentence.
Unlike a capture, the notice goes out while someone has the web app open: no
web UI shows a bulk batch's progress.

```ts
const box = await makeTmpBox({ git: true });
const id = await stageSealedBulk(box.root, { target: "s-known" });
await writePresence(box.root, { activeWeb: 1, now: new Date() });

await markBulkPreparationFailed({ boxRoot: box.root, id });
const [notice] = await notices(box.root);
JSON.stringify({ state: (await readStagingSession({ boxRoot: box.root, id })).state, body: notice.body })
=> {"state":"failed:prepare","body":"1 file reached the box but could not be added to the chat. Saving them to the box failed. They are kept on the box, and the assistant will be asked to recover them."}
```

```ts cleanup
await box.cleanup();
```

## Retry after a failed send: no duplicate card or commit

A send failure leaves the committed batch in place and the session in
`failed:deliver`; re-running skips straight to delivery without a second card or
commit. The uploader's `failedItems` report survives the crash.

```ts
const box = await makeTmpBox({ git: true });
await appendHistory(box.root, { sessionId: "s-known" });
const id = await stageSealedBulk(box.root, {
  target: "s-known",
  failedItems: [{ id: "z", name: "broke.mov", reason: "timed out" }],
});

let failNext = true;
const session = {
  isBusy: () => false, enqueue: () => {}, getSessionId: () => "s-known",
  send: async () => { if (failNext) { failNext = false; return false; } return true; },
};
const eventBus = createEventBus(box.root);
await prepareAndDeliverBulkBatch({ boxRoot: box.root, id, eventBus, registry: mockRegistry(session) });

const cardRel = await batchCardRel(box);
JSON.stringify({
  state: (await readStagingSession({ boxRoot: box.root, id })).state,
  failedNamed: (await box.read(cardRel)).includes("broke.mov"),
  commits: uploadCommitCount(box.root),
})
=> {"state":"failed:deliver","failedNamed":true,"commits":1}
```

Re-running delivers (send succeeds now), cleans up staging, and adds no new
`Upload batch:` commit:

```ts continue
await prepareAndDeliverBulkBatch({ boxRoot: box.root, id, eventBus, registry: mockRegistry(session) });
JSON.stringify({
  stagingGone: (await readStagingSession({ boxRoot: box.root, id })) === null,
  delivered: (await box.read(cardRel)).includes("delivered: true"),
  commits: uploadCommitCount(box.root),
})
=> {"stagingGone":true,"delivered":true,"commits":1}
```

```ts cleanup
eventBus.close();
await box.cleanup();
```

## Reconciliation: busy-enqueue then crash re-delivers once, never twice

When the agent is busy the message is enqueued and the session stays
`delivering` (staging retained). Simulating a crash after the queued message
reached the transcript, the reconciliation re-fire finds it already landed (the
at-most-once probe) and finishes without a second `<upload>` — exactly one lands.

```ts
const box = await makeTmpBox({ git: true });
await appendHistory(box.root, { sessionId: "s-known" });
const id = await stageSealedBulk(box.root, { target: "s-known" });

const logPath = await resolveSessionLogPath(box.root, "s-known");
await mkdir(dirname(logPath), { recursive: true });
await writeFile(logPath, "");

// First run: the agent is busy, so the message is enqueued (and — standing in
// for the queue draining into the transcript — written to the log). The session
// stays `delivering`, staging retained.
let busy = true;
let enqueued = 0;
const session = {
  isBusy: () => busy,
  enqueue: async (input) => { enqueued += 1; await appendFile(logPath, JSON.stringify({ type: "user", text: input.text }) + "\n"); },
  getSessionId: () => "s-known",
  send: async () => { throw new Error("send should not be called while busy"); },
};
const eventBus = createEventBus(box.root);
await prepareAndDeliverBulkBatch({ boxRoot: box.root, id, eventBus, registry: mockRegistry(session) });
JSON.stringify({
  enqueued,
  state: (await readStagingSession({ boxRoot: box.root, id })).state,
})
=> {"enqueued":1,"state":"delivering"}
```

Reconciliation re-fires the worker: the probe finds the `<upload>` already in the
transcript, so no second enqueue/send, and staging is finally cleaned up:

```ts continue
busy = false;
let sends = 0;
session.send = async () => { sends += 1; return true; };
await prepareAndDeliverBulkBatch({ boxRoot: box.root, id, eventBus, registry: mockRegistry(session) });

const cardRel = await batchCardRel(box);
JSON.stringify({
  enqueued,
  sends,
  uploadLines: (await readFile(logPath, "utf-8")).split("\n").filter((l) => l.includes("<upload ")).length,
  stagingGone: (await readStagingSession({ boxRoot: box.root, id })) === null,
  delivered: (await box.read(cardRel)).includes("delivered: true"),
})
=> {"enqueued":1,"sends":0,"uploadLines":1,"stagingGone":true,"delivered":true}
```

```ts cleanup
eventBus.close();
await box.cleanup();
```

## At-most-once: a crash that reset state to `preparing` after delivery still doesn't re-send

The dangerous window the reorder closes: a resume that already delivered but whose
state was reset to `preparing` before the transcript probe (a crash mid-prepare).
Because the probe now runs FIRST — off the deterministic card path, before any
state mutation — the already-landed message is detected and the batch just
finishes bookkeeping, never a second `<upload>`.

```ts
const box = await makeTmpBox({ git: true });
await appendHistory(box.root, { sessionId: "s-known" });
const id = await stageSealedBulk(box.root, { target: "s-known" });

const logPath = await resolveSessionLogPath(box.root, "s-known");
await mkdir(dirname(logPath), { recursive: true });
await writeFile(logPath, "");

// First run: busy agent enqueues (message drains into the transcript); staging
// stays retained in `delivering`.
let busy = true;
const session = {
  isBusy: () => busy,
  enqueue: async (input) => { await appendFile(logPath, JSON.stringify({ type: "user", text: input.text }) + "\n"); },
  getSessionId: () => "s-known",
  send: async () => { throw new Error("send should not be called"); },
};
const eventBus = createEventBus(box.root);
await prepareAndDeliverBulkBatch({ boxRoot: box.root, id, eventBus, registry: mockRegistry(session) });
(await readStagingSession({ boxRoot: box.root, id })).state
=> delivering
```

Force the state to `preparing` (exactly what the old reset-then-probe order left
behind) and re-fire with a live send counter. The probe finds the `<upload>`
already in the transcript, so no send happens and the batch finishes:

```ts continue
await setStagingState({ boxRoot: box.root, id, state: "preparing" });
busy = false;
let sends = 0;
session.send = async () => { sends += 1; return true; };
await prepareAndDeliverBulkBatch({ boxRoot: box.root, id, eventBus, registry: mockRegistry(session) });

const cardRel = await batchCardRel(box);
JSON.stringify({
  sends,
  uploadLines: (await readFile(logPath, "utf-8")).split("\n").filter((l) => l.includes("<upload ")).length,
  stagingGone: (await readStagingSession({ boxRoot: box.root, id })) === null,
  delivered: (await box.read(cardRel)).includes("delivered: true"),
})
=> {"sends":0,"uploadLines":1,"stagingGone":true,"delivered":true}
```

```ts cleanup
eventBus.close();
await box.cleanup();
```
