// # Pending browser-request rendezvous
//
// Tests for `createPendingBrowserRequests` — the generic primitive behind
// CLI-long-poll → browser-tab round-trips (last-audio is one specialization;
// the agent screenshot flow is another). Covers the ack phase, first-wins
// fulfillment, and the `reportNone` window.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
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
  const out = printed();
  const print = out.print;
  // doctest:L26
  const reg = createPendingBrowserRequests<ScreenshotAnswer>();
  const { requestId, outcome } = reg.create({ timeoutMs: 5000, ackGraceMs: 5000 });
  print(`ack: ${reg.ack(requestId)}`);
  print(`fulfill: ${reg.fulfill(requestId, { kind: "image", bytes: "PNGdata" })}`);
  const result = await outcome;
  print(`status: ${result.status}`);
  print(`kind: ${result.status === "fulfilled" ? result.fulfillment.kind : "?"}`);
  await t.checkText(out.with(print(`pending left: ${reg.size()}`)), `ack: true
fulfill: true
status: fulfilled
kind: image
pending left: 0`);
});

// ## Ack phase: no ack resolves `no-client`
//
// When `ackGraceMs` is set and no ack arrives within it, the request resolves
// `no-client` — nothing was listening (tab closed, event dropped, user on
// mobile). This is distinct from `timeout` below.
void test("When ackGraceMs is set and no ack arrives within it, the request resolves no-...", async (t) => {
  // doctest:L49
  const reg = createPendingBrowserRequests<ScreenshotAnswer>();
  const { outcome } = reg.create({ timeoutMs: 5000, ackGraceMs: 20 });
  const result = await outcome;
  t.check(result.status, "no-client");
});

// ## Ack phase: acked but never answered resolves `timeout`
//
// Once acked, the `no-client` window is cancelled and only the overall timeout
// applies — a client saw the request but never answered (e.g. the user ignored
// the popup).
void test("Once acked, the no-client window is cancelled and only the overall timeout ap...", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L63
  const reg = createPendingBrowserRequests<ScreenshotAnswer>();
  const { requestId, outcome } = reg.create({ timeoutMs: 20, ackGraceMs: 5000 });
  print(`ack: ${reg.ack(requestId)}`);
  const result = await outcome;
  await t.checkText(out.with(print(`status: ${result.status}`)), `ack: true
status: timeout`);
});

// ## First fulfill wins; later answers are refused
//
// The multi-tab contract: the first answer settles the request; a second tab's
// answer (and any answer to an unknown id) is refused.
void test("The multi-tab contract:", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L79
  const reg = createPendingBrowserRequests<ScreenshotAnswer>();
  print(`unknown fulfill: ${reg.fulfill("nope", { kind: "declined" })}`);
  const { requestId, outcome } = reg.create({ timeoutMs: 5000 });
  print(`first: ${reg.fulfill(requestId, { kind: "image", bytes: "first" })}`);
  print(`second: ${reg.fulfill(requestId, { kind: "image", bytes: "second" })}`);
  const result = await outcome;
  await t.checkText(out.with(print(`winner: ${result.status === "fulfilled" && result.fulfillment.kind === "image" ? result.fulfillment.bytes : "?"}`)), `unknown fulfill: false
first: true
second: false
winner: first`);
});

// ## Without an ack phase: no answer times out
//
// A request created without `ackGraceMs` (the last-audio shape) has no ack
// window — it can never resolve `no-client`, only `timeout` when nothing
// answers.
void test("A request created without ackGraceMs (the last-audio shape) has no ack window...", async (t) => {
  // doctest:L100
  const reg = createPendingBrowserRequests<ScreenshotAnswer>();
  const { outcome } = reg.create({ timeoutMs: 20 });
  const result = await outcome;
  t.check(result.status, "timeout");
});

// ## `reportNone` resolves `none` after the wait window
//
// A tab reporting "nothing here" doesn't settle immediately — another tab might
// still answer — but once the wait window passes it resolves `none`. An ack
// window, if any, is cancelled too (the reporting client clearly received the
// request).
void test("A tab reporting \"nothing here\" doesn't settle immediately — another tab might...", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L115
  const reg = createPendingBrowserRequests<ScreenshotAnswer>({ graceMs: 20 });
  const { requestId, outcome } = reg.create({ timeoutMs: 5000, ackGraceMs: 5000 });
  print(`reported: ${reg.reportNone(requestId)}`);
  const result = await outcome;
  await t.checkText(out.with(print(`status: ${result.status}`)), `reported: true
status: none`);
});

// ## An answer within the wait window still wins over `none`
void test("An answer within the wait window still wins over `none`", async (t) => {
  // doctest:L128
  const reg = createPendingBrowserRequests<ScreenshotAnswer>({ graceMs: 1000 });
  const { requestId, outcome } = reg.create({ timeoutMs: 5000 });
  reg.reportNone(requestId);
  reg.fulfill(requestId, { kind: "image", bytes: "late" });
  const result = await outcome;
  t.check(result.status, "fulfilled");
});

// ## Ack and reportNone on unknown ids are refused
void test("Ack and reportNone on unknown ids are refused", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L140
  const reg = createPendingBrowserRequests<ScreenshotAnswer>();
  print(`unknown ack: ${reg.ack("nope")}`);
  await t.checkText(out.with(print(`unknown none: ${reg.reportNone("nope")}`)), `unknown ack: false
unknown none: false`);
});

// ## `cancel` abandons a request; a late answer is refused
//
// `cancel` is for a long-poll whose caller vanished (CLI killed / connection
// dropped). It removes the entry and clears its timers WITHOUT resolving the
// outcome — so the abandoned promise never settles (don't await it) — and a
// browser answering afterwards settles nothing, which the route maps to 404.
// Idempotent: a second cancel (or one on an unknown id) returns `false`.
void test("cancel is for a long-poll whose caller vanished (CLI killed / connection drop...", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L157
  const reg = createPendingBrowserRequests<ScreenshotAnswer>();
  const { requestId } = reg.create({ timeoutMs: 5000, ackGraceMs: 5000 });
  print(`cancel: ${reg.cancel(requestId)}`);
  print(`size after cancel: ${reg.size()}`);
  print(`late fulfill: ${reg.fulfill(requestId, { kind: "image", bytes: "late" })}`);
  print(`late ack: ${reg.ack(requestId)}`);
  print(`cancel again: ${reg.cancel(requestId)}`);
  await t.checkText(out.with(print(`unknown cancel: ${reg.cancel("nope")}`)), `cancel: true
size after cancel: 0
late fulfill: false
late ack: false
cancel again: false
unknown cancel: false`);
});
