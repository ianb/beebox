// # Bulk-upload sweep
//
// `sweepBulkBatches` reconciles stuck batches, surfaces abandoned staging, and
// turns a ≥7-day unfiled `tmp-upload/` batch into a self-note to its target chat.
// It runs at the filesystem tier — the reconciliation `firePreparation` and the
// `notifyUnfiled` self-note injection are passed in as callbacks so the sweep's
// decisions are inspected directly, without a chat runtime.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, not, unordered } from "@ianbicking/tap-check/check";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { appendHistory, resolveSessionLogPath } from "../../../src/core/chat/session/history.js";
import {
  createStagingSession,
  addFile,
  setStagingState,
  readStagingSession,
  writeStagingSession,
} from "../../../src/core/capture/staging-store/core.js";
import { resolveBulkBatchPaths } from "../../../src/core/bulk-upload/prepare.js";
import { createUploadBatchTemplate } from "../../../src/schemas/upload-batch.js";
import { sweepBulkBatches, type StrandedBatch, type UnfiledBatch } from "../../../src/core/bulk-upload/sweep.js";
import type { StagingSessionState } from "../../../src/core/capture/staging-schema.js";
import { getBoxTime } from "../../../src/lib/time.js";

const OLD = "2020-01-01T00:00:00.000Z";

// Create a bulk session in a given state, optionally aged + with a file.
async function makeBulk(
  boxRoot: string,
  opts: { state: StagingSessionState; target?: string; contextDir?: string; withFile?: boolean; aged?: boolean },
) {
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
    assert.ok(s);
    s.lastActivityAt = OLD;
    await writeStagingSession({ boxRoot, session: s });
  }
  return staged;
}

async function seedTranscript({ boxRoot, sessionId, text }: { boxRoot: string; sessionId: string; text: string }) {
  await appendHistory(boxRoot, { sessionId });
  const logPath = await resolveSessionLogPath(boxRoot, sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, text);
}

// ## Reconciliation re-fires stuck batches; a not-yet-landed delivering one is left
//
// `sealed`/`preparing` batches are always re-fired. A `delivering` batch is
// re-fired only once its `<upload>` message is confirmed in the transcript (so the
// re-fire just finishes cleanup) — one whose message hasn't landed is left for the
// next startup, never re-sent live (which could double-deliver).
void test("sealed/preparing batches are always re-fired.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const sealed = await makeBulk(box.root, { state: "sealed" });
  const preparing = await makeBulk(box.root, { state: "preparing" });

  // A delivering batch whose <upload> already landed in the target transcript.
  const landedTarget = "s-landed";
  const delivering1 = await makeBulk(box.root, { state: "delivering", target: landedTarget });
  const doc = (await resolveBulkBatchPaths({ boxRoot: box.root, startedAt: delivering1.createdAt, id: delivering1.id, contextDir: "" })).cardRelPath;
  await seedTranscript({ boxRoot: box.root, sessionId: landedTarget, text: JSON.stringify({ type: "user", text: `<upload doc="${doc}">` }) + "\n" });

  // A delivering batch whose message never landed (empty transcript).
  await makeBulk(box.root, { state: "delivering", target: "s-lost" });
  await seedTranscript({ boxRoot: box.root, sessionId: "s-lost", text: "" });

  const fired: string[] = [];
  await sweepBulkBatches({ boxRoot: box.root, firePreparation: (id) => fired.push(id) });
  // The re-fired set is exactly {sealed, preparing, delivering-landed}:
  t.check(fired.toSorted(), [sealed.id, preparing.id, delivering1.id].toSorted());
});

// ## Abandonment: a batch with nothing to report is discarded; anything else is surfaced
//
// An `open` batch idle past the window is surfaced (never auto-finalized). Only a
// batch with **nothing to report at all** is discarded — no received files, no
// reported failures, no registered items, no note. A batch that registered items
// and never uploaded them is NOT empty: it is wholly missing, and the registry
// exists so that case still produces a report. `makeBulk` registers one item, so
// both aged batches below are surfaced as abandoned rather than discarded. A recent
// open batch is left alone.
void test("An open batch idle past the window is surfaced (never auto-finalized).", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const emptyOld = await makeBulk(box.root, { state: "open", aged: true });
  const nonEmptyOld = await makeBulk(box.root, { state: "open", aged: true, withFile: true });
  const recent = await makeBulk(box.root, { state: "open", withFile: true });

  const result = await sweepBulkBatches({ boxRoot: box.root });
  t.check(result.discarded, []);
  t.check(result.abandoned, unordered([emptyOld.id, nonEmptyOld.id]));
  t.check(await readStagingSession({ boxRoot: box.root, id: recent.id }), not(null));

  // Both aged batches are surfaced, and both are still on disk — the sweep reports
  // them for the uploader to finish, it never finalizes or deletes them:

  t.check(await readStagingSession({ boxRoot: box.root, id: emptyOld.id }), not(null));
  t.check(await readStagingSession({ boxRoot: box.root, id: nonEmptyOld.id }), not(null));
});

// ## A `delivered` batch with leaked staging is torn down
//
// Delivery cleans up staging, but if that teardown was swallowed the session sits
// on disk in state `delivered`. The sweep revisits it and retries the delete
// (logging + retrying next cycle if it fails again), so staging never leaks:
void test("Delivery cleans up staging, but if that teardown was swallowed the session si...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const delivered = await makeBulk(box.root, { state: "delivered", withFile: true });

  const result = await sweepBulkBatches({ boxRoot: box.root });
  t.check(result.cleaned, [delivered.id]);
  t.check(await readStagingSession({ boxRoot: box.root, id: delivered.id }), null);
});

// ## Unfiled ≥7-day batches are surfaced to their target chat via self-note, once
//
// A `delivered` upload-batch card still under a `tmp-upload/` past the stale age is
// handed to `notifyUnfiled` with the ORIGINAL target session persisted on the card
// (`target-session`, written at prepare time — not reconstructed from the context
// dir's history); a recent one is not.
void test("A delivered upload-batch card still under a tmp-upload/ past the stale age is...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });

  async function writeBatchCard(relDir: string, startedAt: string) {
    const card = createUploadBatchTemplate({
      batchId: "upload-x", targetSessionId: "s-target", startedAt, registered: 1, totalBytes: 6,
      received: [{ name: "a.pdf", size: 6 }], missing: [], failed: [], summary: "1 file uploaded (6 B).",
    }).replace("---\n", "---\ndelivered: true\n");
    await mkdir(box.path(relDir), { recursive: true });
    await writeFile(box.path(`${relDir}/Batch.upload-batch.card`), card);
  }

  await writeBatchCard("store/x/tmp-upload/upload-old", OLD);
  // Recent = 1 day ago on the sweep's own clock — a hardcoded "recent" date
  // here is a time bomb that crosses the ≥7-day threshold as real time passes.
  const RECENT = new Date(getBoxTime(box.root).getTime() - 24 * 60 * 60 * 1000).toISOString();
  await writeBatchCard("store/x/tmp-upload/upload-new", RECENT);

  const notified: UnfiledBatch[] = [];
  await sweepBulkBatches({ boxRoot: box.root, notifyUnfiled: (b) => notified.push(b) });
  t.check(notified, [{
    cardRelPath: "store/x/tmp-upload/upload-old/Batch.upload-batch.card",
    sessionId: "s-target",
    ageDays: any(Number).above(1000),
  }]);

  // The batch is marked `sweep-notified` (committed), so a SECOND sweep does not
  // re-fire the self-note — it notifies at most once ever, not every cycle:

  const notified2: UnfiledBatch[] = [];
  await sweepBulkBatches({ boxRoot: box.root, notifyUnfiled: (b) => notified2.push(b) });
  t.check(notified2, []);
  t.checkText(await box.read("store/x/tmp-upload/upload-old/Batch.upload-batch.card"), `---
delivered: true
batch-id: upload-x
target-session: s-target
time:
  start: 2020-01-01T00:00:00.000Z
counts:
  registered: 1
  received: 1
  missing: 0
  failed: 0
total-bytes: 6
received:
  - name: a.pdf
    size: 6
sweep-notified: «date»
---
1 file uploaded (6 B).`);
});

// ## The sweep never discards a batch that has something to report
//
// A batch that registered items but committed no bytes is not empty — it is wholly
// *missing*, and the point of the predeclared registry is that such a batch still
// produces its report. The emptiness test is shared with the prepare→deliver worker
// (`bulkBatchHasNothingToReport`) precisely so the two cannot drift: they each
// carried their own copy, the worker's was corrected to count `expectedItems` and
// the sweep's was not, so the sweep went on silently deleting registered batches.
//
// `makeBulk` registers one item, so an aged open batch with no bytes is exactly
// that case:
void test("A batch that registered items but committed no bytes is not empty — it is who...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const registered = await makeBulk(box.root, { state: "open", aged: true });
  const result = await sweepBulkBatches({ boxRoot: box.root });
  t.check(result.discarded, []);
  t.check(result.abandoned, [registered.id]);

  // A batch with a note is kept too — the boxholder typed it and pressed send:

  const noted = await createStagingSession({
    boxRoot: box.root, targetSessionId: null, createdBy: null, kind: "bulk", expectedItems: [],
  });
  const session = await readStagingSession({ boxRoot: box.root, id: noted.id });
  assert.ok(session);
  session.note = "these are the receipts";
  session.lastActivityAt = OLD;
  await writeStagingSession({ boxRoot: box.root, session });

  const second = await sweepBulkBatches({ boxRoot: box.root });
  t.check(second.discarded, []);

  // A genuinely empty batch — nothing registered, nothing uploaded, nothing said — is
  // still discarded:

  const empty = await createStagingSession({
    boxRoot: box.root, targetSessionId: null, createdBy: null, kind: "bulk", expectedItems: [],
  });
  const emptySession = await readStagingSession({ boxRoot: box.root, id: empty.id });
  assert.ok(emptySession);
  emptySession.lastActivityAt = OLD;
  await writeStagingSession({ boxRoot: box.root, session: emptySession });

  const third = await sweepBulkBatches({ boxRoot: box.root });
  t.check(third.discarded, [empty.id]);

  // A sealed batch is never discarded by the sweep, even if it looks empty — the
  // worker owns it, and the locked discard refuses:

  const sealed = await createStagingSession({
    boxRoot: box.root, targetSessionId: null, createdBy: null, kind: "bulk", expectedItems: [],
  });
  const sealedSession = await readStagingSession({ boxRoot: box.root, id: sealed.id });
  assert.ok(sealedSession);
  sealedSession.lastActivityAt = OLD;
  await writeStagingSession({ boxRoot: box.root, session: sealedSession });
  await setStagingState({ boxRoot: box.root, id: sealed.id, state: "sealed" });

  const fourth = await sweepBulkBatches({ boxRoot: box.root });
  t.check(fourth.discarded, []);
  t.check(await readStagingSession({ boxRoot: box.root, id: sealed.id }), not(null));
});

// ## A sealed-but-undeliverable batch is handed to the chat agent
//
// Once a batch is sealed the box holds the bytes AND the boxholder's introduction,
// so the box owns recovery — the uploader may be a phone that never comes back, and
// a `console.error` reaches nobody. The sweep surfaces a `failed:*` batch to its
// chat agent with enough context to act: what the boxholder said, how much arrived,
// and where the bytes are.
void test("Once a batch is sealed the box holds the bytes AND the boxholder's introducti...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const stranded = await createStagingSession({
    boxRoot: box.root, targetSessionId: "chat-1", createdBy: null, kind: "bulk",
    expectedItems: [{ id: "a", name: "IMG_0001.jpg" }],
  });
  const session = await readStagingSession({ boxRoot: box.root, id: stranded.id });
  assert.ok(session);
  session.note = "Receipts from the Tokyo trip";
  await writeStagingSession({ boxRoot: box.root, session });
  await setStagingState({ boxRoot: box.root, id: stranded.id, state: "failed:deliver" });

  const seen: StrandedBatch[] = [];
  const result = await sweepBulkBatches({ boxRoot: box.root, notifyStranded: (b) => seen.push(b) });
  t.check(result.stranded, [stranded.id]);
  t.check(seen, [{
    sessionId: stranded.id,
    targetSessionId: "chat-1",
    state: "failed:deliver",
    receivedCount: 0,
    failedCount: 0,
    registeredCount: 1,
    note: "Receipts from the Tokyo trip",
  }]);

  // The staging is NOT deleted — the agent may still need the bytes:

  t.check(await readStagingSession({ boxRoot: box.root, id: stranded.id }), not(null));

  // It fires exactly once, not every sweep cycle:

  const again: StrandedBatch[] = [];
  const second = await sweepBulkBatches({ boxRoot: box.root, notifyStranded: (b) => again.push(b) });
  t.check(second.stranded, []);
  t.check(again, []);
});

// ## The sweep re-checks its whole decision under the lock
//
// The discard decision is made on a snapshot, then re-made against the fresh
// session inside the staging lock. Guarding only the lifecycle state is not enough:
// registering and uploading files all leave a batch `open`, so a user who comes back
// between the snapshot and the lock would have their newly-filled batch deleted.
void test("The discard decision is made on a snapshot, then re-made against the fresh se...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const revived = await makeBulk(box.root, { state: "open", aged: true });
  // Simulate the user returning: the batch is no longer idle when the lock is taken.
  const fresh = await readStagingSession({ boxRoot: box.root, id: revived.id });
  assert.ok(fresh);
  fresh.lastActivityAt = new Date().toISOString();
  await writeStagingSession({ boxRoot: box.root, session: fresh });

  const result = await sweepBulkBatches({ boxRoot: box.root });
  t.check(result.discarded, []);
  t.check(await readStagingSession({ boxRoot: box.root, id: revived.id }), not(null));
});
