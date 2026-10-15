import { test } from "tap";
import {
  CAPTURE_REQUEST_GLOBAL,
  CAPTURE_RESULT,
  captureResultMatches,
  isCaptureResultMessage,
  takeCaptureRequestId,
} from "../../src/domain/capture-messages.js";

const page = { title: "T", siteName: null, byline: null, excerpt: null, markdown: "m", url: "https://example.com/" };
const result = (requestId: string) => ({ type: CAPTURE_RESULT, requestId, capture: { page, frozenHtml: null } });

test("isCaptureResultMessage requires the type and a request id", async (t) => {
  t.ok(isCaptureResultMessage(result("a")));
  t.ok(isCaptureResultMessage({ type: CAPTURE_RESULT, requestId: "a", error: "boom" }));
  t.notOk(isCaptureResultMessage({ type: CAPTURE_RESULT, capture: { page, frozenHtml: null } }), "no request id");
  t.notOk(isCaptureResultMessage({ type: "other", requestId: "a" }));
  t.notOk(isCaptureResultMessage(null));
});

test("captureResultMatches accepts only this request's id from this tab", async (t) => {
  const expected = { requestId: "a", tabId: 7, senderTabId: 7 };
  t.ok(captureResultMatches(result("a"), expected));
  t.notOk(captureResultMatches(result("b"), expected), "another request in the same tab");
  t.notOk(captureResultMatches(result("a"), { ...expected, senderTabId: 8 }), "same id from another tab");
  t.notOk(captureResultMatches(result("a"), { ...expected, senderTabId: undefined }), "not from a tab");
  t.notOk(captureResultMatches(result(""), { ...expected, requestId: "" }), "an empty id never matches");
});

test("a late result from an earlier timed-out capture does not match the next one", async (t) => {
  t.notOk(captureResultMatches(result("first"), { requestId: "second", tabId: 7, senderTabId: 7 }));
});

test("takeCaptureRequestId reads the id once and removes the global", async (t) => {
  const scope: Record<string, unknown> = { [CAPTURE_REQUEST_GLOBAL]: "abc" };
  t.equal(takeCaptureRequestId(scope), "abc");
  t.notOk(CAPTURE_REQUEST_GLOBAL in scope);
  t.equal(takeCaptureRequestId(scope), "", "a second read finds nothing");
  t.equal(takeCaptureRequestId({ [CAPTURE_REQUEST_GLOBAL]: 5 }), "", "a non-string is ignored");
});
