// # The voice-staging queue's pure decision core
//
// `nextDrainStep` (`lib/audio/voice-staging-queue-core.ts`) is the drainer's
// brain, reachable with no storage and no network: given the ops still queued
// and what happened last time, it says what to do next — send an op, wait, drop
// a recording as terminally failed, or sit idle.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { anything } from "@ianbicking/tap-check/check";
import { nextDrainStep, type VoiceOp, type LastOutcome } from "../../../src/lib/audio/voice-staging-queue-core.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const BOUND_MS = 7 * DAY_MS;

function op(overrides: Partial<VoiceOp> & Pick<VoiceOp, "recordingId" | "seq">): VoiceOp {
  const { recordingId, seq, payload, createdAt, attempts } = overrides;
  return {
    recordingId,
    seq,
    payload: payload ?? { kind: "chunk", chunkIndex: seq, bytes: new ArrayBuffer(0) },
    createdAt: createdAt ?? 0,
    attempts: attempts ?? 0,
  };
}

/** The op as `step` reports it. An ArrayBuffer cannot be compared, so its slot is `anything()`. */
function sentOp(fields: { recordingId: string; seq: number; createdAt: number; attempts: number }) {
  const { recordingId, seq, createdAt, attempts } = fields;
  return { recordingId, seq, payload: { kind: "chunk" as const, chunkIndex: seq, bytes: anything() }, createdAt, attempts };
}

function step(ops: VoiceOp[], opts: { now: number; lastOutcome?: LastOutcome | null }) {
  const lastOutcomes = new Map<string, LastOutcome>();
  if (opts.lastOutcome) lastOutcomes.set(opts.lastOutcome.recordingId, opts.lastOutcome);
  return nextDrainStep(ops, { now: opts.now, lastOutcomes, boundMs: BOUND_MS });
}

// ## Idle: nothing queued
void test("Idle: nothing queued", async (t) => {
  t.check(step([], { now: 1000 }), {
    type: "idle",
  });
});

// ## Ordered ops: the lowest `seq` goes first, and stays first until it's gone
void test("Ordered ops: the lowest `seq` goes first, and stays first until it's gone", async (t) => {
  const ops = [
    op({ recordingId: "r1", seq: 0, createdAt: 100 }),
    op({ recordingId: "r1", seq: 1, createdAt: 200 }),
    op({ recordingId: "r1", seq: 2, createdAt: 300 }),
  ];
  t.check(step(ops, { now: 1000 }), { type: "send", op: sentOp({ recordingId: "r1", seq: 0, createdAt: 100, attempts: 0 }) });

  // Once seq 0 is removed (the shell deletes an op on success), seq 1 is next —
  // never seq 2 out of order:

  const afterFirstSucceeds = ops.slice(1);
  t.check(step(afterFirstSucceeds, { now: 1000 }), { type: "send", op: sentOp({ recordingId: "r1", seq: 1, createdAt: 200, attempts: 0 }) });
});

// ## Recordings drain oldest-first
//
// Two recordings interleave; the one whose earliest pending op is older goes
// first, regardless of how the ops happen to be ordered in the array.
void test("Two recordings interleave; the one whose earliest pending op is older goes fi...", async (t) => {
  const interleaved = [
    op({ recordingId: "newer", seq: 0, createdAt: 500 }),
    op({ recordingId: "older", seq: 0, createdAt: 100 }),
    op({ recordingId: "newer", seq: 1, createdAt: 600 }),
  ];
  t.check(step(interleaved, { now: 1000 }), { type: "send", op: sentOp({ recordingId: "older", seq: 0, createdAt: 100, attempts: 0 }) });

  const olderDone = interleaved.filter((o) => o.recordingId !== "older");
  t.check(step(olderDone, { now: 1000 }), { type: "send", op: sentOp({ recordingId: "newer", seq: 0, createdAt: 500, attempts: 0 }) });
});

// ## A transient failure waits, then retries
//
// A 502 (or any transient error) on attempt 1 waits `retryDelayMs(1)` = 1000ms
// from when it failed. Before that elapses, the drainer waits; after, it sends
// again — with `attempts` already bumped by the shell to 1.
void test("A 502 (or any transient error) on attempt 1 waits retryDelayMs(1) = 1000ms fr...", async (t) => {
  const failedOnce = op({ recordingId: "r1", seq: 0, createdAt: 100, attempts: 1 });
  const lastOutcome: LastOutcome = { recordingId: "r1", seq: 0, at: 5000, kind: "transient" };

  t.check(step([failedOnce], { now: 5500, lastOutcome }), {
    type: "wait",
    ms: 500,
  });

  t.check(step([failedOnce], { now: 6000, lastOutcome }), { type: "send", op: sentOp({ recordingId: "r1", seq: 0, createdAt: 100, attempts: 1 }) });
});

// ## Steady-state delay once the backoff schedule runs out
//
// `MAX_RETRIES` is 11; past that, the wait is a steady 30s rather than the
// schedule's last (30s-capped) entry running out immediately.
void test("MAXRETRIES is 11; past that, the wait is a steady 30s rather than the schedul...", async (t) => {
  const exhausted = op({ recordingId: "r1", seq: 0, createdAt: 100, attempts: 12 });
  const justFailed: LastOutcome = { recordingId: "r1", seq: 0, at: 5000, kind: "transient" };

  t.check(step([exhausted], { now: 34_000, lastOutcome: justFailed }), {
    type: "wait",
    ms: 1000,
  });

  t.check(step([exhausted], { now: 35_000, lastOutcome: justFailed }), { type: "send", op: sentOp({ recordingId: "r1", seq: 0, createdAt: 100, attempts: 12 }) });
});

// ## A terminal failure (a 4xx) drops the whole recording
void test("A terminal failure (a 4xx) drops the whole recording", async (t) => {
  const rejected = op({ recordingId: "r1", seq: 0, createdAt: 100 });
  const conflict: LastOutcome = { recordingId: "r1", seq: 0, at: 5000, kind: "terminal" };

  t.check(step([rejected], { now: 5001, lastOutcome: conflict }), {
    type: "terminal",
    recordingId: "r1",
    op: sentOp({ recordingId: "r1", seq: 0, createdAt: 100, attempts: 0 }),
    reason: "rejected",
  });
});

// ## An op older than the 7-day bound is terminal regardless of its own history
//
// Even an op that has never failed goes terminal once it's too old — the bound
// is about the op's age, not its attempt count.
void test("Even an op that has never failed goes terminal once it's too old — the bound...", async (t) => {
  const ancient = op({ recordingId: "r1", seq: 0, createdAt: 0 });
  t.check(step([ancient], { now: BOUND_MS }), {
    type: "terminal",
    recordingId: "r1",
    op: sentOp({ recordingId: "r1", seq: 0, createdAt: 0, attempts: 0 }),
    reason: "expired",
  });

  t.check(step([ancient], { now: BOUND_MS - 1 }), { type: "send", op: sentOp({ recordingId: "r1", seq: 0, createdAt: 0, attempts: 0 }) });
});

// ## A `lastOutcome` for a different op doesn't apply
//
// If the recording's earliest op changed (the prior one succeeded and was
// removed), a stale `lastOutcome` for the old op is simply ignored.
void test("If the recording's earliest op changed (the prior one succeeded and was remov...", async (t) => {
  const next = op({ recordingId: "r1", seq: 1, createdAt: 100 });
  const staleOutcome: LastOutcome = { recordingId: "r1", seq: 0, at: 5000, kind: "terminal" };
  t.check(step([next], { now: 5001, lastOutcome: staleOutcome }), { type: "send", op: sentOp({ recordingId: "r1", seq: 1, createdAt: 100, attempts: 0 }) });
});

// ## Two recordings backing off at once don't clobber each other's wait
//
// `lastOutcomes` is keyed by `recordingId` precisely so one recording's outcome
// can't wipe another's still-active backoff. `older` is mid-retry-wait; `newer`
// (which only exists because ops from a second tab were just merged in) has no
// outcome yet and sends immediately — and `older`'s wait is unaffected by that.
void test("lastOutcomes is keyed by recordingId precisely so one recording's outcome can...", async (t) => {
  const olderOp = op({ recordingId: "older", seq: 0, createdAt: 0, attempts: 1 });
  const newerOp = op({ recordingId: "newer", seq: 0, createdAt: 50 });
  const lastOutcomes = new Map<string, LastOutcome>([
    ["older", { recordingId: "older", seq: 0, at: 5000, kind: "transient" }],
  ]);

  t.check(nextDrainStep([olderOp, newerOp], { now: 5100, lastOutcomes, boundMs: BOUND_MS }), {
    type: "wait",
    ms: 900,
  });

  // Once `older`'s op is removed from the array (the shell only calls
  // `nextDrainStep` again after handling the previous result — a "wait" step is
  // never followed by sending a different recording out of turn), `newer` is
  // next, with `older`'s backoff entry left untouched in the map:

  t.check(nextDrainStep([newerOp], { now: 5100, lastOutcomes, boundMs: BOUND_MS }), { type: "send", op: sentOp({ recordingId: "newer", seq: 0, createdAt: 50, attempts: 0 }) });

  t.check(lastOutcomes.get("older"), { recordingId: "older", seq: 0, at: 5000, kind: "transient" });
});
