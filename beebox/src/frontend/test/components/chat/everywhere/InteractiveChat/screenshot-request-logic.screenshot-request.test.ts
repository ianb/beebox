// # Agent-initiated screenshot — request logic
//
// The browser side of `bbx chat screenshot` (Track B) decides four things purely,
// extracted into `screenshot-request-logic.ts` (the React hook + DOM/network live
// in `screenshot-request-handler.ts`, which can't run under the Node tier):
//
// 1. does a broadcast `screenshot-request` target *this* view's session,
// 2. is it already past its deadline,
// 3. what answer does a capture outcome map to, and
// 4. how the FIFO popup queue + ephemeral indicators fold.

import { test } from "tap";
import "agent-doctest/tap";
import assert from "node:assert/strict";
import type { ScreenshotRequest, ScreenshotState } from "../../../../../src/components/chat/everywhere/InteractiveChat/screenshot-request-logic.js";
import {
  matchesRequestSession,
  isRequestExpired,
  captureOutcomeToAnswer,
  classifyUploadResponse,
  screenshotReducer,
} from "../../../../../src/components/chat/everywhere/InteractiveChat/screenshot-request-logic.js";

const req = (requestId: string, extra?: Partial<ScreenshotRequest>): ScreenshotRequest => ({ requestId, session: "s1", expiresAt: "2999-01-01T00:00:00Z", ...extra });

// ## Session match is EXACT, never a null wildcard
//
// Unlike the `forSession` chat helper (null on either side = wildcard), a capture
// request matches only when the ids are equal and this view actually has a
// session. An idle `?session=new` tab (`viewSession === null`) must NOT answer an
// established session's request.
void test("Unlike the forSession chat helper (null on either side = wildcard), a capture...", async (t) => {
  // doctest:L34
  t.check(matchesRequestSession("s1", "s1"), true);

  // doctest:L37
  t.check(matchesRequestSession("s1", "s2"), false);

  // doctest:L40
  t.check(matchesRequestSession("s1", null), false);
});

// ## Expiry is a loose clock hint
//
// A request past its ISO deadline is dropped; before it, kept. An unparseable
// deadline is treated as not-expired rather than silently discarding the request
// on a bad hint.
void test("A request past its ISO deadline is dropped; before it, kept.", async (t) => {
  // doctest:L51
  t.check(isRequestExpired("2000-01-01T00:00:00Z", Date.parse("2020-01-01T00:00:00Z")), true);

  // doctest:L54
  t.check(isRequestExpired("2999-01-01T00:00:00Z", Date.parse("2020-01-01T00:00:00Z")), false);

  // doctest:L57
  t.check(isRequestExpired("not-a-date", Date.now()), false);
});

// ## Capture outcome → answer
//
// An image becomes an `upload`; a dismissed picker a `declined`; an unsupported
// client the plan's named `unsupported-client` failure; any other error carries
// its own message. Every degraded path is named — never a silent blank.
void test("An image becomes an upload; a dismissed picker a declined; an unsupported cli...", async (t) => {
  // doctest:L68
  const image = captureOutcomeToAnswer({ kind: "image", blob: new Blob([]), viewport: { cssWidth: 800, cssHeight: 600, dpr: 2 } });
  assert.ok(image.kind === "upload");
  t.check({ kind: image.kind, viewport: image.viewport }, {
    kind: "upload",
    viewport: {
      cssWidth: 800,
      cssHeight: 600,
      dpr: 2,
    },
  });

  // doctest:L73
  t.check(captureOutcomeToAnswer({ kind: "declined" }), {
    kind: "declined",
  });

  // doctest:L76
  t.check(captureOutcomeToAnswer({ kind: "unsupported" }), {
    kind: "failed",
    reason: "unsupported-client",
  });

  // doctest:L79
  t.check(captureOutcomeToAnswer({ kind: "error", message: "canvas 2D context unavailable" }), {
    kind: "failed",
    reason: "canvas 2D context unavailable",
  });
});

// ## Upload response → resolution
//
// The PNG POST to the answer route settles four ways (finding 2). A 2xx shows the
// "shared" indicator. A 404 is the quiet multi-tab/expired case — another tab won
// or the request already settled, so no post, no toast, no indicator. Any other
// HTTP status means the capture happened but the *server* rejected it, so post a
// named `failed` (the server's `error` field, else a generic `upload-rejected`) so
// the agent's command settles as `failed:` instead of hanging to `timeout`. A
// thrown fetch means the channel is down — nothing can be posted, so toast locally
// rather than falsely claim it was shared.
void test("The PNG POST to the answer route settles four ways (finding 2).", async (t) => {
  // doctest:L95
  t.check(classifyUploadResponse({ kind: "ok" }), {
    kind: "indicator",
  });

  // doctest:L98
  t.check(classifyUploadResponse({ kind: "http", status: 404, errorField: null }), {
    kind: "quiet",
  });

  // doctest:L101
  t.check(classifyUploadResponse({ kind: "http", status: 400, errorField: "bad-viewport" }), {
    kind: "failed",
    reason: "bad-viewport",
  });

  // doctest:L104
  t.check(classifyUploadResponse({ kind: "http", status: 502, errorField: null }), {
    kind: "failed",
    reason: "upload-rejected",
  });

  // doctest:L107
  t.check(classifyUploadResponse({ kind: "network" }), {
    kind: "toast",
  });
});

// The object-URL revoke timing (thumbnail freed on the non-indicator paths and on
// row unmount-before-timer) is DOM-lifecycle and stays manual-verify — it can't run
// under the Node tier.
//
// ## The queue is FIFO, one popup at a time
//
// Two requests enqueue in order; the head is the active popup. Resolving the head
// pops it so the next promotes — never two popups stacked.
void test("The object-URL revoke timing (thumbnail freed on the non-indicator paths and...", async (t) => {
  // doctest:L121
  let state: ScreenshotState = { queue: [], indicators: [] };
  state = screenshotReducer(state, { type: "enqueue", request: req("a") });
  state = screenshotReducer(state, { type: "enqueue", request: req("b") });
  t.check(state.queue.map((r) => r.requestId).join(","), "a,b");

  // doctest:L127
  state = screenshotReducer(state, { type: "resolveHead", indicator: null });
  t.check(state.queue.map((r) => r.requestId).join(","), "b");

  // A redelivered request (same `requestId`) never stacks a second popup.

  // doctest:L135
  state = screenshotReducer(state, { type: "enqueue", request: req("b") });
  await t.checkText(state.queue.length, "1");
});

// ## Resolving with an indicator records the ephemeral row; dismiss removes it
//
// `resolveHead` with an indicator both pops the queue and appends the "shared with
// the agent" row; the relay path adds one without ever queuing a popup; dismiss
// ages it out.
void test("resolveHead with an indicator both pops the queue and appends the \"shared wit...", async (t) => {
  // doctest:L147
  let s: ScreenshotState = { queue: [req("x")], indicators: [] };
  s = screenshotReducer(s, { type: "resolveHead", indicator: { requestId: "x", thumbnailUrl: "blob:x" } });
  t.check({ queue: s.queue.length, indicators: s.indicators.map((i) => i.requestId) }, {
    queue: 0,
    indicators: [
      "x",
    ],
  });

  // doctest:L152
  s = screenshotReducer(s, { type: "addIndicator", indicator: { requestId: "y", thumbnailUrl: "blob:y" } });
  t.check(s.indicators.map((i) => i.requestId).join(","), "x,y");

  // doctest:L156
  s = screenshotReducer(s, { type: "dismissIndicator", requestId: "x" });
  t.check(s.indicators.map((i) => i.requestId).join(","), "y");
});
