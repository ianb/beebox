import { test } from "tap";
import { isClerkMessage } from "../../src/domain/messages.js";

test("isClerkMessage accepts the send messages", async (t) => {
  t.ok(isClerkMessage({ type: "sendToBox", tabId: 3, note: "" }));
  t.ok(isClerkMessage({ type: "retrySend", id: "abc" }));
  t.ok(isClerkMessage({ type: "chooseSend", id: "abc", candidateId: "c1" }));
});

test("isClerkMessage rejects malformed send messages", async (t) => {
  t.notOk(isClerkMessage({ type: "sendToBox", tabId: 3 }), "no note");
  t.notOk(isClerkMessage({ type: "sendToBox", tabId: "3", note: "" }), "tab id not a number");
  t.notOk(isClerkMessage({ type: "retrySend" }), "no id");
  t.notOk(isClerkMessage({ type: "chooseSend", id: "abc" }), "no candidate");
  t.notOk(isClerkMessage({ type: "chooseSend", id: 1, candidateId: "c1" }), "id not a string");
});

test("isClerkMessage still accepts the existing messages", async (t) => {
  t.ok(isClerkMessage({ type: "commentOnPage", tabId: 1 }));
  t.ok(isClerkMessage({ type: "shareTabs", scope: "all-windows", sourceWindowId: 2 }));
  t.ok(isClerkMessage({ type: "openTabOrganizer", transferId: "x" }));
  t.ok(isClerkMessage({ type: "getLatestTabTransfer" }));
  t.notOk(isClerkMessage({ type: "unknown" }));
  t.notOk(isClerkMessage("sendToBox"));
});
