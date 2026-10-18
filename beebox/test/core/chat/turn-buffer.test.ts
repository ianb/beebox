// # TurnBuffer
//
// The resumable per-turn output buffer behind `events.turnStream`. It captures a
// chat turn's messages with monotonic `seq` numbers so a reconnecting client can
// replay from its last-seen seq, then stream live. Bounded (a long turn evicts its
// head) with the durable transcript as the floor: a resume past evicted frames is
// reported as a gap so the client refetches history instead of silently losing
// text.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
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
  const out = printed();
  const print = out.print;
  // doctest:L32
  const b = new TurnBuffer("t1");
  b.push(msg("system"));
  b.push(msg("assistant"));
  b.push(msg("result"));
  print(`all: ${b.framesAfter(0).map((f) => f.seq).join(",")}`);
  print(`types: ${b.framesAfter(0).map((f) => f.msg.type).join(",")}`);
  print(`after 1: ${b.framesAfter(1).map((f) => f.seq).join(",")}`);
  await t.checkText(out.with(print(`after 3: ${b.framesAfter(3).length}`)), `all: 1,2,3
types: system,assistant,result
after 1: 2,3
after 3: 0`);
});

// ## A fresh buffer has no gap and isn't complete
void test("A fresh buffer has no gap and isn't complete", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L50
  const b = new TurnBuffer("t2");
  b.push(msg("assistant"));
  print(`gap after 0: ${b.hasGapAfter(0)}`);
  print(`complete: ${b.complete}`);
  await t.checkText(out.with(print(`errored: ${b.errored}`)), `gap after 0: false
complete: false
errored: null`);
});

// ## finish marks the turn complete
void test("finish marks the turn complete", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L64
  const b = new TurnBuffer("t3");
  b.push(msg("result"));
  b.finish();
  print(`complete: ${b.complete}`);
  await t.checkText(out.with(print(`errored: ${b.errored}`)), `complete: true
errored: null`);
});

// ## fail records a terminal error and completes
void test("fail records a terminal error and completes", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L77
  const b = new TurnBuffer("t4");
  b.fail("subprocess crashed");
  print(`complete: ${b.complete}`);
  await t.checkText(out.with(print(`errored: ${b.errored}`)), `complete: true
errored: subprocess crashed`);
});

// ## The frame-count cap retains 4,000 small frames, then evicts the head
//
// Small frames do not trip the byte budget. Once the count cap is exceeded, the
// oldest frame is evicted and a resume from before it reports a gap (→ the client
// resyncs from history).
void test("Small frames do not trip the byte budget.", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L93
  const b = new TurnBuffer("t5");
  for (let i = 0; i < 4000; i++) b.push(msg("stream_event"));
  print(`at limit: ${b.framesAfter(0).length}`);
  print(`gap at limit: ${b.hasGapAfter(0)}`);
  b.push(msg("stream_event"));
  print(`retained: ${b.framesAfter(0).length}`);
  print(`first seq: ${b.framesAfter(0)[0]?.seq}`);
  print(`gap after 0: ${b.hasGapAfter(0)}`);
  print(`gap after 1: ${b.hasGapAfter(1)}`);
  await t.checkText(out.with(print(`gap after 4001: ${b.hasGapAfter(4001)}`)), `at limit: 4000
gap at limit: false
retained: 4000
first seq: 2
gap after 0: true
gap after 1: false
gap after 4001: false`);
});

// ## The byte cap evicts large frames before the count cap
//
// Three roughly 3 MiB messages exceed the 8 MiB budget. The oldest is evicted,
// leaving the two newest messages and reporting the resulting replay gap.
void test("Three roughly 3 MiB messages exceed the 8 MiB budget.", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L119
  const b = new TurnBuffer("t6");
  b.push(msgWithPayload(3 * 1024 * 1024));
  b.push(msgWithPayload(3 * 1024 * 1024));
  b.push(msgWithPayload(3 * 1024 * 1024));
  print(`retained: ${b.framesAfter(0).length}`);
  print(`first seq: ${b.framesAfter(0)[0]?.seq}`);
  print(`gap after 0: ${b.hasGapAfter(0)}`);
  await t.checkText(out.with(print(`gap after 1: ${b.hasGapAfter(1)}`)), `retained: 2
first seq: 2
gap after 0: true
gap after 1: false`);
});

// ## waitForChange resolves immediately when the version moved (no missed wakeup)
//
// A reader snapshots the version before draining; a push during the drain bumps it,
// so the subsequent `waitForChange` returns at once rather than sleeping on a frame
// that's already buffered.
void test("A reader snapshots the version before draining; a push during the drain bumps...", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L141
  const b = new TurnBuffer("t7");
  const v = b.versionSnapshot();
  b.push(msg("assistant")); // happens "during" a drain
  await b.waitForChange(undefined, v);
  await t.checkText(out.with(print("resolved-on-change")), "resolved-on-change");
});

// ## waitForChange resolves immediately once complete
void test("waitForChange resolves immediately once complete", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L153
  const b = new TurnBuffer("t8");
  const v = b.versionSnapshot();
  b.finish();
  await b.waitForChange(undefined, v);
  await t.checkText(out.with(print("resolved-on-complete")), "resolved-on-complete");
});
