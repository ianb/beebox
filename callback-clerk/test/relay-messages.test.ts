import { test } from "tap";
import {
  captureResponse,
  isRelayCaptureMessage,
  parseRelayPageMessage,
  relayReady,
  RELAY_APP_SOURCE,
  RELAY_CAPTURE,
  RELAY_SOURCE,
  isRelayTabArrangementMessage,
  RELAY_TAB_ARRANGEMENT,
  tabArrangementResponse,
} from "../src/domain/relay-messages.js";

test("parseRelayPageMessage: accepts a well-formed ping", async (t) => {
  t.same(parseRelayPageMessage({ source: RELAY_APP_SOURCE, type: "relay-ping" }), {
    source: RELAY_APP_SOURCE,
    type: "relay-ping",
  });
});

test("parseRelayPageMessage: accepts a capture-request with a string correlationId", async (t) => {
  t.same(
    parseRelayPageMessage({ source: RELAY_APP_SOURCE, type: "capture-request", correlationId: "abc" }),
    { source: RELAY_APP_SOURCE, type: "capture-request", correlationId: "abc" },
  );
});

test("parseRelayPageMessage: rejects a foreign source marker", async (t) => {
  t.equal(parseRelayPageMessage({ source: "someone-else", type: "relay-ping" }), null);
  // A relay-ready echoed back from the page must not be treated as an inbound request.
  t.equal(parseRelayPageMessage({ source: RELAY_SOURCE, type: "relay-ready" }), null);
});

test("parseRelayPageMessage: rejects capture-request without a string correlationId", async (t) => {
  t.equal(parseRelayPageMessage({ source: RELAY_APP_SOURCE, type: "capture-request" }), null);
  t.equal(
    parseRelayPageMessage({ source: RELAY_APP_SOURCE, type: "capture-request", correlationId: 7 }),
    null,
  );
});

test("parseRelayPageMessage: rejects unknown types and non-records", async (t) => {
  t.equal(parseRelayPageMessage({ source: RELAY_APP_SOURCE, type: "nope" }), null);
  t.equal(parseRelayPageMessage(null), null);
  t.equal(parseRelayPageMessage("relay-ping"), null);
  t.equal(parseRelayPageMessage([RELAY_APP_SOURCE]), null);
});

test("relayReady / captureResponse builders carry the relay source marker", async (t) => {
  t.same(relayReady(), { source: RELAY_SOURCE, type: "relay-ready" });
  t.same(captureResponse("cid", { ok: true, dataUrl: "data:image/png;base64,AAAA" }), {
    source: RELAY_SOURCE,
    type: "capture-response",
    correlationId: "cid",
    result: { ok: true, dataUrl: "data:image/png;base64,AAAA" },
  });
  t.same(captureResponse("cid", { ok: false, reason: "not-capturable" }), {
    source: RELAY_SOURCE,
    type: "capture-response",
    correlationId: "cid",
    result: { ok: false, reason: "not-capturable" },
  });
});

test("isRelayCaptureMessage: accepts the runtime message, rejects others", async (t) => {
  t.equal(isRelayCaptureMessage({ type: RELAY_CAPTURE, correlationId: "abc" }), true);
  t.equal(isRelayCaptureMessage({ type: RELAY_CAPTURE }), false);
  t.equal(isRelayCaptureMessage({ type: RELAY_CAPTURE, correlationId: 1 }), false);
  t.equal(isRelayCaptureMessage({ type: "commentOnPage", tabId: 1 }), false);
  t.equal(isRelayCaptureMessage(null), false);
});

test("tab arrangement relay validates apply payloads on both hops", async (t) => {
  const proposal = { windows: [{ id: "w", tabs: ["a"] }], close: ["b"] };
  t.same(parseRelayPageMessage({
    source: RELAY_APP_SOURCE,
    type: "tab-arrangement-apply-request",
    correlationId: "cid",
    transferId: "tid",
    proposal,
  }), {
    source: RELAY_APP_SOURCE,
    type: "tab-arrangement-apply-request",
    correlationId: "cid",
    transferId: "tid",
    proposal,
  });
  t.equal(isRelayTabArrangementMessage({
    type: RELAY_TAB_ARRANGEMENT,
    action: "apply",
    transferId: "tid",
    proposal,
    confirmed: true,
  }), true);
  t.equal(isRelayTabArrangementMessage({
    type: RELAY_TAB_ARRANGEMENT,
    action: "apply",
    transferId: "tid",
    proposal,
  }), false, "page-shaped apply without Clerk confirmation is rejected");
  t.equal(isRelayTabArrangementMessage({
    type: RELAY_TAB_ARRANGEMENT,
    action: "apply",
    transferId: "tid",
    proposal: { windows: [{ id: "w", tabs: [3] }], close: [] },
    confirmed: true,
  }), false);
  t.same(tabArrangementResponse("cid", {
    ok: false,
    reason: "stale",
    message: "Nothing changed",
  }), {
    source: RELAY_SOURCE,
    type: "tab-arrangement-response",
    correlationId: "cid",
    result: { ok: false, reason: "stale", message: "Nothing changed" },
  });
});
