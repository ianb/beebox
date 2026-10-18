// # Bulk-upload prepare→deliver worker
//
// `prepareAndDeliverBulkBatch` prepares a sealed bulk staging session (copy + card
// + manifest + commit, via `prepareBulkBatch`) and then delivers an `<upload>`
// message to the batch's target chat, with capture's retry discipline: a failed
// send leaves the batch retryable, a busy agent leaves it pending for
// reconciliation, and the at-most-once probe never double-delivers. A duck-typed
// registry with a mock chat session stands in for the Claude subprocess so the
// whole worker runs deterministically.

import { test } from "tap";
import "agent-doctest/tap";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile, appendFile, mkdir, access } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox, type TmpBox } from "../../helpers/doctest-helpers.js";
import { createEventBus } from "../../../src/core/event-bus/core.js";
import { appendHistory, resolveSessionLogPath } from "../../../src/core/chat/session/history.js";
import {
  createStagingSession,
  addFile,
  sealStagingSession,
  setStagingState,
  readStagingSession,
} from "../../../src/core/capture/staging-store/core.js";
import type { ChatSendInput, ChatSession } from "../../../src/core/chat/session/run/core.js";
import { ChatSessionRegistry } from "../../../src/core/chat/session/registry/core.js";
import { createFakeChatBackend } from "../../../src/services/claude-chat/core.js";
import { plainTestPrompt } from "../../helpers/chat-session-spawner-helpers.js";
import { prepareAndDeliverBulkBatch, markBulkPreparationFailed } from "../../../src/core/bulk-upload/worker/core.js";
import { readRecent } from "../../../src/core/notification/log.js";
import { writePresence } from "../../../src/core/notification/presence.js";

/** The box's logged notifications, reduced to what the person sees. */
async function notices(boxRoot: string) {
  return (await readRecent(boxRoot, { days: 1 })).map(({ intent }) => {
    const { title, body, target, loudness, source } = intent;
    return { title, body, target, loudness, source };
  });
}

async function pathExists(p: string) {
  try { await access(p); return true; } catch (_e) { return false; }
}

function uploadCommitCount(boxRoot: string) {
  return execFileSync("git", ["log", "--format=%s"], { cwd: boxRoot })
    .toString().split("\n").filter((l) => l.startsWith("Upload batch:")).length;
}

async function batchCardRel(box: TmpBox) {
  const dirs = await readdir(box.path("_content/tmp-upload"));
  return `_content/tmp-upload/${dirs[0]}/${dirs[0]}.upload-batch.card`;
}

// Stage a sealed bulk session bound to `target`, with one uploaded file.
async function stageSealedBulk(
  boxRoot: string,
  opts: { target: string; failedItems?: { id: string; name: string; reason: string }[] },
) {
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

/** A real chat registry over the fake backend plus an event bus; `close()` releases both. */
function chatFor(box: TmpBox) {
  const registry = new ChatSessionRegistry(box.root, {
    backend: createFakeChatBackend(),
    buildSessionOptions: () => ({ systemPrompt: plainTestPrompt, skipBootstrap: true }),
  });
  const eventBus = createEventBus(box.root);
  return { registry, eventBus, close: () => { registry.shutdown(); eventBus.close(); } };
}

/** The session behavior each test scripts; the rest of the session is the real one. */
type SessionScript = Partial<Pick<ChatSession, "isBusy" | "enqueue" | "send">>;

/** A `wireSession` hook that applies `script` to the session each time delivery resolves it. */
function wiring(script: SessionScript) {
  return (session: ChatSession) => {
    Object.assign(session, script);
  };
}

/** The text of a chat input, whichever form it arrives in. */
const textOf = (input: string | ChatSendInput) => (typeof input === "string" ? input : input.text);

// ## Happy path: prepare, deliver the `<upload>` message, clean up staging
//
// The batch lands as a committed card, the `<upload>` wrapper reaches the target
// chat, the card flips to `delivered`, and the staging session is cleaned up.
void test("The batch lands as a committed card, the <upload> wrapper reaches the target...", async (t) => {
  t.teardown(async () => {
    try {
      close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L104
  const box = await makeTmpBox({ git: true });
  await appendHistory(box.root, { sessionId: "s-known" });
  const id = await stageSealedBulk(box.root, { target: "s-known" });

  // doctest:L108
  const sent: string[] = [];
  const { registry, eventBus, close } = chatFor(box);
  const wireSession = wiring({
    isBusy: () => false, enqueue: () => {},
    send: async (input) => { sent.push(textOf(input)); return true; },
  });
  await prepareAndDeliverBulkBatch({ boxRoot: box.root, id, eventBus, registry, wireSession });

  // doctest:L116
  const cardRel = await batchCardRel(box);
  t.check(
    {
      sent: sent.length,
      wrapper: sent[0]?.startsWith(`<upload doc="${cardRel}"`) ?? false,
      delivered: (await box.read(cardRel)).includes("delivered: true"),
      stagingGone: (await readStagingSession({ boxRoot: box.root, id })) === null,
    },
    {
    sent: 1,
    wrapper: true,
    delivered: true,
    stagingGone: true,
  },
  );
});

// ## No most-active fallback: an unknown target fails loudly and stays retryable
//
// A batch whose target chat is not known to the box is a broken invariant —
// delivery fails loudly (`failed:deliver`), nothing is prepared or misdirected,
// and the staging is retained for a retry.
void test("A batch whose target chat is not known to the box is a broken invariant — del...", async (t) => {
  t.teardown(async () => {
    try {
      close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L138
  const box = await makeTmpBox({ git: true });
  // Target "s-missing" is deliberately NOT in history.
  const id = await stageSealedBulk(box.root, { target: "s-missing" });

  // doctest:L142
  const sent: string[] = [];
  const { registry, eventBus, close } = chatFor(box);
  const wireSession = wiring({ isBusy: () => false, enqueue: () => {}, send: async (i) => { sent.push(textOf(i)); return true; } });
  await prepareAndDeliverBulkBatch({ boxRoot: box.root, id, eventBus, registry, wireSession });

  // doctest:L147
  t.check(
    {
      state: (await readStagingSession({ boxRoot: box.root, id }))?.state,
      sent: sent.length,
      noBatchDir: !(await pathExists(box.path("_content/tmp-upload"))),
    },
    {
    state: "failed:deliver",
    sent: 0,
    noBatchDir: true,
  },
  );

  // The person who uploaded is told. They saw finalize succeed and have likely put
  // the phone down, so the box sends one `quiet` notification to the chat the batch
  // was headed for:

  // doctest:L160
  t.check(await notices(box.root), [
    {
      title: "An upload could not be added to the chat",
      body: "1 file reached the box but could not be added to the chat. The chat it was sent to no longer exists. They are kept on the box, and the assistant will be asked to recover them.",
      target: "chat:s-missing",
      loudness: "quiet",
      source: "bulk-upload",
    },
  ]);
});

// ## A preparation that throws is recorded and reported, even with the app open
//
// The finalize route, the startup resume and the sweep all catch a worker that
// threw (a refused commit, say) and record it through `markBulkPreparationFailed`.
// The error text stays in the server log; the person gets a plain sentence.
// Unlike a capture, the notice goes out while someone has the web app open: no
// web UI shows a bulk batch's progress.
void test("The finalize route, the startup resume and the sweep all catch a worker that...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L186
  const box = await makeTmpBox({ git: true });
  const id = await stageSealedBulk(box.root, { target: "s-known" });
  await writePresence(box.root, { activeWeb: 1, now: new Date() });

  // doctest:L190
  await markBulkPreparationFailed({ boxRoot: box.root, id });
  const [notice] = await notices(box.root);
  assert.ok(notice);
  t.check(({ state: (await readStagingSession({ boxRoot: box.root, id }))?.state, body: notice.body }), {
    state: "failed:prepare",
    body: "1 file reached the box but could not be added to the chat. Saving them to the box failed. They are kept on the box, and the assistant will be asked to recover them.",
  });
});

// ## Retry after a failed send: no duplicate card or commit
//
// A send failure leaves the committed batch in place and the session in
// `failed:deliver`; re-running skips straight to delivery without a second card or
// commit. The uploader's `failedItems` report survives the crash.
void test("A send failure leaves the committed batch in place and the session in failed:...", async (t) => {
  t.teardown(async () => {
    try {
      close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L208
  const box = await makeTmpBox({ git: true });
  await appendHistory(box.root, { sessionId: "s-known" });
  const id = await stageSealedBulk(box.root, {
    target: "s-known",
    failedItems: [{ id: "z", name: "broke.mov", reason: "timed out" }],
  });

  // doctest:L215
  let failNext = true;
  const { registry, eventBus, close } = chatFor(box);
  const wireSession = wiring({
    isBusy: () => false, enqueue: () => {},
    send: async () => { if (failNext) { failNext = false; return false; } return true; },
  });
  await prepareAndDeliverBulkBatch({ boxRoot: box.root, id, eventBus, registry, wireSession });

  // doctest:L223
  const cardRel = await batchCardRel(box);
  t.check(
    {
      state: (await readStagingSession({ boxRoot: box.root, id }))?.state,
      failedNamed: (await box.read(cardRel)).includes("broke.mov"),
      commits: uploadCommitCount(box.root),
    },
    {
    state: "failed:deliver",
    failedNamed: true,
    commits: 1,
  },
  );

  // Re-running delivers (send succeeds now), cleans up staging, and adds no new
  // `Upload batch:` commit:

  // doctest:L236
  await prepareAndDeliverBulkBatch({ boxRoot: box.root, id, eventBus, registry, wireSession });
  t.check(
    {
      stagingGone: (await readStagingSession({ boxRoot: box.root, id })) === null,
      delivered: (await box.read(cardRel)).includes("delivered: true"),
      commits: uploadCommitCount(box.root),
    },
    {
    stagingGone: true,
    delivered: true,
    commits: 1,
  },
  );
});

// ## Reconciliation: busy-enqueue then crash re-delivers once, never twice
//
// When the agent is busy the message is enqueued and the session stays
// `delivering` (staging retained). Simulating a crash after the queued message
// reached the transcript, the reconciliation re-fire finds it already landed (the
// at-most-once probe) and finishes without a second `<upload>` — exactly one lands.
void test("When the agent is busy the message is enqueued and the session stays deliveri...", async (t) => {
  t.teardown(async () => {
    try {
      close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L258
  const box = await makeTmpBox({ git: true });
  await appendHistory(box.root, { sessionId: "s-known" });
  const id = await stageSealedBulk(box.root, { target: "s-known" });

  // doctest:L262
  const logPath = await resolveSessionLogPath(box.root, "s-known");
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, "");

  // doctest:L266
  // First run: the agent is busy, so the message is enqueued (and — standing in
  // for the queue draining into the transcript — written to the log). The session
  // stays `delivering`, staging retained.
  let busy = true;
  let enqueued = 0;
  const script: SessionScript = {
    isBusy: () => busy,
    enqueue: async (input) => { enqueued += 1; await appendFile(logPath, JSON.stringify({ type: "user", text: textOf(input) }) + "\n"); },
    send: async () => { throw new Error("send should not be called while busy"); },
  };
  const { registry, eventBus, close } = chatFor(box);
  const wireSession = wiring(script);
  await prepareAndDeliverBulkBatch({ boxRoot: box.root, id, eventBus, registry, wireSession });
  t.check(
    {
      enqueued,
      state: (await readStagingSession({ boxRoot: box.root, id }))?.state,
    },
    {
    enqueued: 1,
    state: "delivering",
  },
  );

  // Reconciliation re-fires the worker: the probe finds the `<upload>` already in the
  // transcript, so no second enqueue/send, and staging is finally cleaned up:

  // doctest:L290
  busy = false;
  let sends = 0;
  script.send = async () => { sends += 1; return true; };
  await prepareAndDeliverBulkBatch({ boxRoot: box.root, id, eventBus, registry, wireSession });

  // doctest:L295
  const cardRel = await batchCardRel(box);
  t.check(
    {
      enqueued,
      sends,
      uploadLines: (await readFile(logPath, "utf-8")).split("\n").filter((l) => l.includes("<upload ")).length,
      stagingGone: (await readStagingSession({ boxRoot: box.root, id })) === null,
      delivered: (await box.read(cardRel)).includes("delivered: true"),
    },
    {
    enqueued: 1,
    sends: 0,
    uploadLines: 1,
    stagingGone: true,
    delivered: true,
  },
  );
});

// ## At-most-once: a crash that reset state to `preparing` after delivery still doesn't re-send
//
// The dangerous window the reorder closes: a resume that already delivered but whose
// state was reset to `preparing` before the transcript probe (a crash mid-prepare).
// Because the probe now runs FIRST — off the deterministic card path, before any
// state mutation — the already-landed message is detected and the batch just
// finishes bookkeeping, never a second `<upload>`.
void test("The dangerous window the reorder closes:", async (t) => {
  t.teardown(async () => {
    try {
      close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L320
  const box = await makeTmpBox({ git: true });
  await appendHistory(box.root, { sessionId: "s-known" });
  const id = await stageSealedBulk(box.root, { target: "s-known" });

  // doctest:L324
  const logPath = await resolveSessionLogPath(box.root, "s-known");
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, "");

  // doctest:L328
  // First run: busy agent enqueues (message drains into the transcript); staging
  // stays retained in `delivering`.
  let busy = true;
  const script: SessionScript = {
    isBusy: () => busy,
    enqueue: async (input) => { await appendFile(logPath, JSON.stringify({ type: "user", text: textOf(input) }) + "\n"); },
    send: async () => { throw new Error("send should not be called"); },
  };
  const { registry, eventBus, close } = chatFor(box);
  const wireSession = wiring(script);
  await prepareAndDeliverBulkBatch({ boxRoot: box.root, id, eventBus, registry, wireSession });
  t.check((await readStagingSession({ boxRoot: box.root, id }))?.state, "delivering");

  // Force the state to `preparing` (exactly what the old reset-then-probe order left
  // behind) and re-fire with a live send counter. The probe finds the `<upload>`
  // already in the transcript, so no send happens and the batch finishes:

  // doctest:L348
  await setStagingState({ boxRoot: box.root, id, state: "preparing" });
  busy = false;
  let sends = 0;
  script.send = async () => { sends += 1; return true; };
  await prepareAndDeliverBulkBatch({ boxRoot: box.root, id, eventBus, registry, wireSession });

  // doctest:L354
  const cardRel = await batchCardRel(box);
  t.check(
    {
      sends,
      uploadLines: (await readFile(logPath, "utf-8")).split("\n").filter((l) => l.includes("<upload ")).length,
      stagingGone: (await readStagingSession({ boxRoot: box.root, id })) === null,
      delivered: (await box.read(cardRel)).includes("delivered: true"),
    },
    {
    sends: 0,
    uploadLines: 1,
    stagingGone: true,
    delivered: true,
  },
  );
});
