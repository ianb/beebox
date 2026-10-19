// # Coalescing identical history reads
//
// `loadSessionHistory` is the one door every request-driven transcript read goes
// through (`chat.history`, `chat.bootstrap`, `ChatSession.getHistory`). A phone
// reconnecting fires those in a burst — with retries and no backoff — and each one
// used to re-parse the whole JSONL: ~50 MB of transient heap per request on prod's
// 15.5 MB session, stacking linearly to the 1.9 GB V8 cap. That killed `bbx serve`
// four times on 2026-08-03/04
// (`issues/bugs/2026-08-04-chat-history-parse-transient-oom.md`).
//
// Concurrent callers asking for the *same* read now share one parse.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { is, not } from "@ianbicking/tap-check/check";
import { loadSessionHistory, sessionHistoryReadStats } from "../../../../src/core/chat/session/load-history.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { clearBoxConfigCache } from "../../../../src/core/box/config.js";
import { recordSessionStart } from "../../../../src/core/chat/session/registry/start-record.js";
import type { SessionLogSlice } from "../../../../src/cli/lib/session.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

const SESSION = "11111111-2222-3333-4444-555555555555";
const TAIL: SessionLogSlice = { mode: "tail", tail: 200, minRealUserMessages: 2 };

function line(i: number) {
  return JSON.stringify({
    type: "user",
    uuid: `u${i}`,
    timestamp: `2026-01-01T00:0${i}:00Z`,
    message: { role: "user", content: [{ type: "text", text: `<typed>Message ${i}</typed>` }] },
  });
}

/** The parsed form of the entry `line(i)` writes. */
function entry(i: number) {
  return {
    uuid: `u${String(i)}`,
    type: "user" as const,
    timestamp: `2026-01-01T00:0${String(i)}:00Z`,
    content: [{ type: "text" as const, text: `<typed>Message ${String(i)}</typed>` }],
  };
}

/** What a read of `count` seeded lines answers, `from` onward. */
function history(read: { sessionId: string; indexes: number[]; total: number }) {
  return { sessionId: read.sessionId, entries: read.indexes.map(entry), total: read.total };
}

const OTHER = "99999999-8888-7777-6666-555555555555";

// Write the transcript where `resolveSessionLogPath` will look for it.
async function seed(boxRoot: string, count: number) {
  const logPath = getSessionLogPath(boxRoot, SESSION);
  await mkdir(dirname(logPath), { recursive: true });
  const lines: string[] = [];
  for (let i = 0; i < count; i++) lines.push(line(i));
  await writeFile(logPath, lines.join("\n") + "\n");
  return logPath;
}

// Reads performed since a marker — the seam coalescing is visible through.
function readsSince(before: number) {
  return sessionHistoryReadStats().reads - before;
}

async function configure(boxRoot: string, config: Record<string, unknown>) {
  await mkdir(join(boxRoot, "_config"), { recursive: true });
  await writeFile(join(boxRoot, "_config/box.json"), JSON.stringify(config));
  clearBoxConfigCache(boxRoot);
}

// ## Ten concurrent identical reads, one parse
void test("Ten concurrent identical reads, one parse", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
  await seed(box.root, 6);

  const before = sessionHistoryReadStats().reads;
  const results = await Promise.all(
    Array.from({ length: 10 }, () => loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL })),
  );
  t.check(readsSince(before), 1);
  const [first] = results;
  assert.ok(first);
  t.check(first, history({ sessionId: SESSION, indexes: [0, 1, 2, 3, 4, 5], total: 6 }));
  t.check(results.map((r) => r.entries), results.map(() => is(first.entries)));

  // The window is shared, so it is frozen — a caller that starts mutating its
  // answer would be corrupting every peer's:

  t.check(Object.isFrozen(first.entries), true);

  // The map empties as soon as the read settles. It is a coalescing window, not a
  // cache:

  t.check(sessionHistoryReadStats().inFlight, 0);

  // So a caller arriving *after* the resolution reads the file again:

  const after = sessionHistoryReadStats().reads;
  await loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL });
  t.check(readsSince(after), 1);

  // ## Different reads never share an answer
  //
  // The key is `(logPath, slice)`, not the session. A page-mode request and the chat
  // page's tail request read the same file into different windows, so they must not
  // coalesce with each other — nor with a different session's read:

  const mixed = sessionHistoryReadStats().reads;
  const [tail, page, other] = await Promise.all([
    loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL }),
    loadSessionHistory(box.root, { sessionId: SESSION, slice: { mode: "page", offset: 0, limit: 2 } }),
    loadSessionHistory(box.root, { sessionId: OTHER, slice: TAIL }),
  ]);
  t.check({ parses: readsSince(mixed), tail, page, other }, {
    parses: 3,
    tail: history({ sessionId: SESSION, indexes: [0, 1, 2, 3, 4, 5], total: 6 }),
    page: history({ sessionId: SESSION, indexes: [0, 1], total: 6 }),
    other: history({ sessionId: OTHER, indexes: [], total: 0 }),
  });

  // A tail that differs only in `minRealUserMessages` is a different window too:

  const widened = sessionHistoryReadStats().reads;
  await Promise.all([
    loadSessionHistory(box.root, { sessionId: SESSION, slice: { mode: "tail", tail: 200 } }),
    loadSessionHistory(box.root, { sessionId: SESSION, slice: { mode: "tail", tail: 200, minRealUserMessages: 2 } }),
  ]);
  t.check(readsSince(widened), 2);
});

// ## An id the box has no record of never reaches an engine
//
// Which store holds a transcript is a question about a specific session, and for an
// id with no husk stamp, no history row and no reservation there is no answer —
// nothing recorded the session. The loader used to fill that gap with the box
// default, and the two branches punish a wrong guess very differently: a missing
// transcript FILE is an empty conversation (the section above), while a Codex read
// for a thread that never existed is an RPC error. So on a codex-default box the
// gap became `Codex history request failed` in a chat error banner — which is what
// a `git reset --hard` produced on 2026-09-03 by rewinding a box's chat registry
// and husk card out from under an open session.
//
// Only a RECORDED `codex` reaches the RPC now. `BBX_CODEX_BINARY` points at a stub
// that exits immediately, so this asserts that no engine is consulted rather than
// only checking the answer — and it asserts it in milliseconds. Letting the real
// Codex answer would not do: it holds an unknown-thread read open until the
// client's own 3-minute timeout, so the guess this replaces did not merely produce
// the wrong error, it could hang a history request.
void test("Which store holds a transcript is a question about a specific session, and fo...", async (t) => {
  // A native Codex thread is the case this does NOT cover, and that is a deliberate
  // trade rather than an oversight. Codex threads live outside the box, so records
  // can be rewound while the thread survives — and for such an id the box default
  // used to be right, so a codex-default box would have loaded it. It now reads
  // empty. The trade: probing Codex for every unrecorded id would restore that
  // recovery, but Codex holds an unknown-thread read open until the client's own
  // 3-minute timeout, so the incident case would become a hung history request
  // instead of a fast wrong one. Fast and empty beats slow and eventually-empty for
  // the common case; recovering an orphaned Codex thread is a deliberate action, not
  // something a history poll should discover.
  t.teardown(async () => {
    try {
      delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
      delete process.env["BBX_CODEX_BINARY"];
      await codexBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const codexBox = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = codexBox.path("claude-projects");
  const stub = codexBox.path("codex-stub");
  await writeFile(stub, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  process.env["BBX_CODEX_BINARY"] = stub;
  await configure(codexBox.root, { agentEngine: "codex", engines: { claude: true, codex: true } });

  const unrecorded = await loadSessionHistory(codexBox.root, { sessionId: SESSION, slice: TAIL });
  t.check(unrecorded, history({ sessionId: SESSION, indexes: [], total: 0 }));

  // A RECORDED codex id, on the same box in the same state, does go to the stub and
  // fails there. That is the other half of the assertion above: the RPC path is live,
  // so the unrecorded read answering empty means it did not take that path, not that
  // the path happens to be broken for everyone.

  const recordedCodex = randomUUID();
  await recordSessionStart(codexBox.root, { sessionId: recordedCodex, engine: "codex" });
  const reached = await loadSessionHistory(codexBox.root, { sessionId: recordedCodex, slice: TAIL })
    .then(() => "resolved", () => "went to the engine");
  t.check(reached, "went to the engine");

  // The fallback is not "assume Claude" — it is "read what is on this disk". A
  // transcript FILE under an unrecorded id is still served:

  await seed(codexBox.root, 4);
  const stillServed = await loadSessionHistory(codexBox.root, { sessionId: SESSION, slice: TAIL });
  t.check(stillServed, history({ sessionId: SESSION, indexes: [0, 1, 2, 3], total: 4 }));
});

// ## `fresh: true` never joins an in-flight scan
//
// A caller reading BECAUSE it knows the transcript just changed (the
// post-turn-completion broadcast in `chat-schedule-fire.ts`) must get its own
// read, not the answer of a scan that started before the change: it neither
// joins nor registers itself in the coalescing map.
void test("A caller reading BECAUSE it knows the transcript just changed (the post-turn-...", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
  await seed(box.root, 6);

  const before = sessionHistoryReadStats().reads;
  const [ordinary, fresh] = await Promise.all([
    loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL }),
    loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL, fresh: true }),
  ]);
  t.check(readsSince(before), 2);
  t.check(fresh.entries, not(is(ordinary.entries)));

  // A `fresh` read also isn't visible to *other* callers to join — it never
  // occupies the `inFlight` slot:

  const beforeOrdinary = sessionHistoryReadStats().reads;
  const [_freshAlone, twoOrdinary] = await Promise.all([
    loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL, fresh: true }),
    Promise.all([
      loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL }),
      loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL }),
    ]),
  ]);
  t.check(readsSince(beforeOrdinary), 2);
  t.check(twoOrdinary[0].entries, is(twoOrdinary[1].entries));
});

// ## A transcript that appears later is picked up
//
// A missing JSONL is a normal state (a brand-new chat), and it answers empty. That
// answer is *not* remembered: the next call re-reads, so the file the session is
// about to write is visible as soon as it exists. This is why the in-flight entry
// is dropped on settle rather than kept.
void test("A missing JSONL is a normal state (a brand-new chat), and it answers empty.", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  const empty = await loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL });
  t.check(empty, history({ sessionId: SESSION, indexes: [], total: 0 }));

  await seed(box.root, 3);
  const found = await loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL });
  t.check(found, history({ sessionId: SESSION, indexes: [0, 1, 2], total: 3 }));

  // A failed read is dropped from the map too — it is never handed to a later
  // caller. Pointing the session at a *directory* makes the read fail with EISDIR
  // (not the ENOENT that legitimately means "no transcript yet"), and the loader
  // rethrows rather than reporting an empty conversation:

  const logPath = getSessionLogPath(box.root, SESSION);
  await rm(logPath);
  await mkdir(logPath);

  const before = sessionHistoryReadStats().reads;
  const failures = await Promise.allSettled(
    Array.from({ length: 3 }, () => loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL })),
  );
  t.check(readsSince(before), 1);
  const eisdir = { name: "Error", message: "EISDIR: illegal operation on a directory, read", errno: -21, code: "EISDIR", syscall: "read" };
  t.check(failures, [
    { status: "rejected", reason: eisdir },
    { status: "rejected", reason: eisdir },
    { status: "rejected", reason: eisdir },
  ]);
  t.check(sessionHistoryReadStats().inFlight, 0);
});
