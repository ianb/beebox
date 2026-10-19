// # Pending browser-request rendezvous
//
// Tests for `createPendingBrowserRequests` — the generic primitive behind
// CLI-long-poll → browser-tab round-trips (last-audio is one specialization;
// the agent screenshot flow is another). Covers the ack phase, first-wins
// fulfillment, and the `reportNone` window.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createPendingBrowserRequests } from "../../src/core/pending-browser-request.js";

// The screenshot consumer's fulfillment payload is a small union:
type ScreenshotAnswer =
  | { kind: "image"; bytes: string }
  | { kind: "declined" };

// ## Ack phase: a client acks, then fulfills
//
// The happy path for a two-phase request: the browser acks (cancelling the
// `no-client` window), then answers with an image.
void test("The happy path for a two-phase request:", async (t) => {
  const reg = createPendingBrowserRequests<ScreenshotAnswer>();
  const { requestId, outcome } = reg.create({ timeoutMs: 5000, ackGraceMs: 5000 });
  const acked = reg.ack(requestId);
  const fulfilled = reg.fulfill(requestId, { kind: "image", bytes: "PNGdata" });
  const result = await outcome;
  t.check(
    { acked, fulfilled, result, pending: reg.size() },
    { acked: true, fulfilled: true, result: { status: "fulfilled", fulfillment: { kind: "image", bytes: "PNGdata" } }, pending: 0 },
  );
});

// ## Ack phase: no ack resolves `no-client`
//
// When `ackGraceMs` is set and no ack arrives within it, the request resolves
// `no-client` — nothing was listening (tab closed, event dropped, user on
// mobile). This is distinct from `timeout` below.
void test("When ackGraceMs is set and no ack arrives within it, the request resolves no-...", async (t) => {
  const reg = createPendingBrowserRequests<ScreenshotAnswer>();
  const { outcome } = reg.create({ timeoutMs: 5000, ackGraceMs: 20 });
  const result = await outcome;
  t.check(result, { status: "no-client" });
});

// ## Ack phase: acked but never answered resolves `timeout`
//
// Once acked, the `no-client` window is cancelled and only the overall timeout
// applies — a client saw the request but never answered (e.g. the user ignored
// the popup).
void test("Once acked, the no-client window is cancelled and only the overall timeout ap...", async (t) => {
  const reg = createPendingBrowserRequests<ScreenshotAnswer>();
  const { requestId, outcome } = reg.create({ timeoutMs: 20, ackGraceMs: 5000 });
  const acked = reg.ack(requestId);
  const result = await outcome;
  t.check({ acked, result }, { acked: true, result: { status: "timeout" } });
});

// ## First fulfill wins; later answers are refused
//
// The multi-tab contract: the first answer settles the request; a second tab's
// answer (and any answer to an unknown id) is refused.
void test("The multi-tab contract:", async (t) => {
  const reg = createPendingBrowserRequests<ScreenshotAnswer>();
  const unknownFulfill = reg.fulfill("nope", { kind: "declined" });
  const { requestId, outcome } = reg.create({ timeoutMs: 5000 });
  const first = reg.fulfill(requestId, { kind: "image", bytes: "first" });
  const second = reg.fulfill(requestId, { kind: "image", bytes: "second" });
  const result = await outcome;
  t.check(
    { unknownFulfill, first, second, result },
    { unknownFulfill: false, first: true, second: false, result: { status: "fulfilled", fulfillment: { kind: "image", bytes: "first" } } },
  );
});

// ## Without an ack phase: no answer times out
//
// A request created without `ackGraceMs` (the last-audio shape) has no ack
// window — it can never resolve `no-client`, only `timeout` when nothing
// answers.
void test("A request created without ackGraceMs (the last-audio shape) has no ack window...", async (t) => {
  const reg = createPendingBrowserRequests<ScreenshotAnswer>();
  const { outcome } = reg.create({ timeoutMs: 20 });
  const result = await outcome;
  t.check(result, { status: "timeout" });
});

// ## `reportNone` resolves `none` after the wait window
//
// A tab reporting "nothing here" doesn't settle immediately — another tab might
// still answer — but once the wait window passes it resolves `none`. An ack
// window, if any, is cancelled too (the reporting client clearly received the
// request).
void test("A tab reporting \"nothing here\" doesn't settle immediately — another tab might...", async (t) => {
  const reg = createPendingBrowserRequests<ScreenshotAnswer>({ graceMs: 20 });
  const { requestId, outcome } = reg.create({ timeoutMs: 5000, ackGraceMs: 5000 });
  const reported = reg.reportNone(requestId);
  const result = await outcome;
  t.check({ reported, result }, { reported: true, result: { status: "none" } });
});

// ## An answer within the wait window still wins over `none`
void test("An answer within the wait window still wins over `none`", async (t) => {
  const reg = createPendingBrowserRequests<ScreenshotAnswer>({ graceMs: 1000 });
  const { requestId, outcome } = reg.create({ timeoutMs: 5000 });
  reg.reportNone(requestId);
  reg.fulfill(requestId, { kind: "image", bytes: "late" });
  const result = await outcome;
  t.check(result, { status: "fulfilled", fulfillment: { kind: "image", bytes: "late" } });
});

// ## Ack and reportNone on unknown ids are refused
void test("Ack and reportNone on unknown ids are refused", async (t) => {
  const reg = createPendingBrowserRequests<ScreenshotAnswer>();
  t.check({ ack: reg.ack("nope"), none: reg.reportNone("nope") }, { ack: false, none: false });
});

// ## `cancel` abandons a request; a late answer is refused
//
// `cancel` is for a long-poll whose caller vanished (CLI killed / connection
// dropped). It removes the entry and clears its timers WITHOUT resolving the
// outcome — so the abandoned promise never settles (don't await it) — and a
// browser answering afterwards settles nothing, which the route maps to 404.
// Idempotent: a second cancel (or one on an unknown id) returns `false`.
void test("cancel is for a long-poll whose caller vanished (CLI killed / connection drop...", async (t) => {
  const reg = createPendingBrowserRequests<ScreenshotAnswer>();
  const { requestId } = reg.create({ timeoutMs: 5000, ackGraceMs: 5000 });
  const cancel = reg.cancel(requestId);
  const sizeAfterCancel = reg.size();
  const lateFulfill = reg.fulfill(requestId, { kind: "image", bytes: "late" });
  const lateAck = reg.ack(requestId);
  const cancelAgain = reg.cancel(requestId);
  t.check(
    { cancel, sizeAfterCancel, lateFulfill, lateAck, cancelAgain, unknownCancel: reg.cancel("nope") },
    { cancel: true, sizeAfterCancel: 0, lateFulfill: false, lateAck: false, cancelAgain: false, unknownCancel: false },
  );
});
