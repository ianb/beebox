// # TurnBuffer
//
// The resumable per-turn output buffer behind `events.turnStream`. It captures a
// chat turn's messages with monotonic `seq` numbers so a reconnecting client can
// replay from its last-seen seq, then stream live. Bounded (a long turn evicts its
// head) with the durable transcript as the floor: a resume past evicted frames is
// reported as a gap so the client refetches history instead of silently losing
// text.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { TurnBuffer } from "../../../src/core/chat/turn-buffer.js";
import type { ChatMessage } from "../../../src/core/chat/session/messages.js";

/** The smallest valid message of each kind these examples push. */
function msg(type: "system" | "assistant" | "result" | "stream_event"): ChatMessage {
  switch (type) {
    case "system": return { type, subtype: "init", session_id: "s" };
    case "assistant": return { type, session_id: "s", message: { role: "assistant", content: [] } };
    case "result": return { type, subtype: "success", session_id: "s", is_error: false, duration_ms: 0, num_turns: 1 };
    case "stream_event": return { type, session_id: "s", parent_tool_use_id: null };
  }
}

function msgWithPayload(size: number): ChatMessage {
  return Object.assign(msg("assistant"), { payload: "x".repeat(size) });
}

// ## Frames get monotonic seqs; framesAfter resumes from a seq
void test("Frames get monotonic seqs; framesAfter resumes from a seq", async (t) => {
  const b = new TurnBuffer("t1");
  b.push(msg("system"));
  b.push(msg("assistant"));
  b.push(msg("result"));
  t.check(b.framesAfter(0).map((f) => f.seq), [1, 2, 3]);
  t.check(b.framesAfter(0).map((f) => f.msg.type), ["system", "assistant", "result"]);
  t.check(b.framesAfter(1).map((f) => f.seq), [2, 3]);
  t.check(b.framesAfter(3), []);
});

// ## A fresh buffer has no gap and isn't complete
void test("A fresh buffer has no gap and isn't complete", async (t) => {
  const b = new TurnBuffer("t2");
  b.push(msg("assistant"));
  t.check({ gapAfter0: b.hasGapAfter(0), complete: b.complete, errored: b.errored }, {
    gapAfter0: false,
    complete: false,
    errored: null,
  });
});

// ## finish marks the turn complete
void test("finish marks the turn complete", async (t) => {
  const b = new TurnBuffer("t3");
  b.push(msg("result"));
  b.finish();
  t.check({ complete: b.complete, errored: b.errored }, { complete: true, errored: null });
});

// ## fail records a terminal error and completes
void test("fail records a terminal error and completes", async (t) => {
  const b = new TurnBuffer("t4");
  b.fail("subprocess crashed");
  t.check({ complete: b.complete, errored: b.errored }, { complete: true, errored: "subprocess crashed" });
});

// ## The frame-count cap retains 4,000 small frames, then evicts the head
//
// Small frames do not trip the byte budget. Once the count cap is exceeded, the
// oldest frame is evicted and a resume from before it reports a gap (→ the client
// resyncs from history).
void test("Small frames do not trip the byte budget.", async (t) => {
  const b = new TurnBuffer("t5");
  for (let i = 0; i < 4000; i++) b.push(msg("stream_event"));
  t.check(b.framesAfter(0).map((f) => f.seq), Array.from({ length: 4000 }, (_, i) => i + 1));
  t.check(b.hasGapAfter(0), false);
  b.push(msg("stream_event"));
  t.check(b.framesAfter(0).map((f) => f.seq), Array.from({ length: 4000 }, (_, i) => i + 2));
  t.check(
    { gapAfter0: b.hasGapAfter(0), gapAfter1: b.hasGapAfter(1), gapAfter4001: b.hasGapAfter(4001) },
    { gapAfter0: true, gapAfter1: false, gapAfter4001: false },
  );
});

// ## The byte cap evicts large frames before the count cap
//
// Three roughly 3 MiB messages exceed the 8 MiB budget. The oldest is evicted,
// leaving the two newest messages and reporting the resulting replay gap.
void test("Three roughly 3 MiB messages exceed the 8 MiB budget.", async (t) => {
  const b = new TurnBuffer("t6");
  b.push(msgWithPayload(3 * 1024 * 1024));
  b.push(msgWithPayload(3 * 1024 * 1024));
  b.push(msgWithPayload(3 * 1024 * 1024));
  t.check(b.framesAfter(0).map((f) => f.seq), [2, 3]);
  t.check({ gapAfter0: b.hasGapAfter(0), gapAfter1: b.hasGapAfter(1) }, { gapAfter0: true, gapAfter1: false });
});

// ## waitForChange resolves immediately when the version moved (no missed wakeup)
//
// A reader snapshots the version before draining; a push during the drain bumps it,
// so the subsequent `waitForChange` returns at once rather than sleeping on a frame
// that's already buffered.
void test("A reader snapshots the version before draining; a push during the drain bumps...", async (t) => {
  const b = new TurnBuffer("t7");
  const v = b.versionSnapshot();
  b.push(msg("assistant")); // happens "during" a drain
  await b.waitForChange(undefined, v);
  t.pass("resolved on change");
});

// ## waitForChange resolves immediately once complete
void test("waitForChange resolves immediately once complete", async (t) => {
  const b = new TurnBuffer("t8");
  const v = b.versionSnapshot();
  b.finish();
  await b.waitForChange(undefined, v);
  t.pass("resolved on complete");
});

// ## The turn's session id comes from its `system/init` frame
//
// `events.turnSession` reads it, so a new chat whose live view dropped before
// init can still learn its id. It sits outside the ring: eviction keeps it.
void test("The session id is null before init and recorded from it", async (t) => {
  const b = new TurnBuffer("t9");
  b.push(msg("stream_event"));
  t.check(b.sessionId, null);
  b.push({ type: "system", subtype: "init", session_id: "s-init" });
  b.push(msgWithPayload(5 * 1024 * 1024));
  b.push(msgWithPayload(5 * 1024 * 1024));
  t.check({ sessionId: b.sessionId, initEvicted: b.hasGapAfter(2) }, { sessionId: "s-init", initEvicted: true });
});
