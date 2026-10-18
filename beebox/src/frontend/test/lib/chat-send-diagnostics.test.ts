// # Chat send diagnostics — bounded, private anomaly timelines
//
// The send diagnostic keeps routine lifecycle events in memory and emits only
// when the receipt is rejected or slow, or a transport anomaly occurs. Its public
// event API accepts enumerated metadata, not message content.

import { test } from "tap";
import "agent-doctest/tap";
import assert from "node:assert/strict";
import {
  beginChatSendDiagnostic,
  chatSendReasonKind,
  inspectChatSendDiagnostic,
  observeChatSendHistory,
  observeChatSendReceipt,
  recordChatSendEvent,
  recordChatSendEnvironmentEvent,
  resetChatSendDiagnostics,
} from "../../src/lib/chat-send-diagnostics.js";

/** The JSON a diagnostic warning carries after its prefix. */
interface DiagnosticPayload {
  trigger: string;
  emissionId: string;
  events: { event: string; detail: Record<string, unknown> }[];
}

/** Parse one captured warning line; a missing line fails the example. */
function parseWarning(line: string | undefined): DiagnosticPayload {
  assert.ok(line, "expected a captured warning");
  return JSON.parse(line.replace("[chat-send-diagnostic] ", ""));
}

resetChatSendDiagnostics();
const warnings: string[] = [];
const originalWarn = console.warn;
console.warn = (value: unknown) => warnings.push(String(value));

// ## A routine send stays silent and records hop ordering
void test("A routine send stays silent and records hop ordering", async (t) => {
  // doctest:L42
  beginChatSendDiagnostic({
    emissionId: "msg-ok",
    origin: "typed",
    textLength: 12,
    imageCount: 0,
    fileCount: 0,
    selectionCount: 0,
  });
  recordChatSendEvent("msg-ok", { event: "post-issued", detail: { attempt: 1 } });
  recordChatSendEvent("msg-ok", { event: "post-response", detail: { outcome: "turn-started" } });
  observeChatSendReceipt({ emissionId: "msg-ok", disposition: "sent" });
  observeChatSendHistory(["msg-ok"]);

  // doctest:L55
  await t.checkText(warnings.length, "0");

  // doctest:L58
  t.check(inspectChatSendDiagnostic("msg-ok").map((entry) => entry.event).join(","), "dispatch,post-issued,post-response,receipt-observed,durable-history-observed");
});

// ## A rejection flushes one content-free timeline
void test("A rejection flushes one content-free timeline", async (t) => {
  // doctest:L65
  beginChatSendDiagnostic({
    emissionId: "msg-timeout",
    origin: "voice",
    textLength: 321,
    imageCount: 1,
    fileCount: 2,
    selectionCount: 3,
  });
  recordChatSendEvent("msg-timeout", { event: "post-issued", detail: { attempt: 1 } });
  observeChatSendReceipt({ emissionId: "msg-timeout", disposition: "rejected", reasonKind: "timeout" });

  // doctest:L76
  await t.checkText(warnings.length, "1");

  // doctest:L79
  const payload = parseWarning(warnings[0]);
  t.check([payload.trigger, payload.emissionId, payload.events[0]?.detail.textLength].join("|"), "receipt-rejected|msg-timeout|321");

  // doctest:L83
  await t.checkText(JSON.stringify(payload).includes("diagnostic transport test"), "false");

  // doctest:L86
  t.check(
    chatSendReasonKind("request contained diagnostic transport test at https://secret.invalid")
    ,
    "other",
  );
});

// ## A transport anomaly flushes even after a fast accepted receipt
void test("A transport anomaly flushes even after a fast accepted receipt", async (t) => {
  // doctest:L93
  beginChatSendDiagnostic({
    emissionId: "msg-stream",
    origin: "typed",
    textLength: 10,
    imageCount: 0,
    fileCount: 0,
    selectionCount: 0,
  });
  observeChatSendReceipt({ emissionId: "msg-stream", disposition: "sent" });
  for (let frameNumber = 1; frameNumber <= 100; frameNumber++) {
    recordChatSendEvent("msg-stream", { event: "turn-stream-frame", detail: { frame: "msg", frameNumber } });
  }
  recordChatSendEvent("msg-stream", { event: "turn-stream-error", detail: { errorLength: 120 } });

  // doctest:L107
  await t.checkText(warnings.length, "2");

  // doctest:L110
  const streamPayload = parseWarning(warnings[1]);
  t.check([streamPayload.trigger, streamPayload.events.find((entry) => entry.event === "turn-stream-progress")?.detail.frameCount].join("|"), "turn-stream-error|100");

  // doctest:L114
  await t.checkText((warnings[1]?.length ?? Infinity) < 4000, "true");
});

// ## A retry keeps a separate terminal snapshot and ring pressure preserves dispatch
void test("A retry keeps a separate terminal snapshot and ring pressure preserves dispatch", async (t) => {
  // doctest:L121
  beginChatSendDiagnostic({
    emissionId: "msg-retry",
    origin: "typed",
    textLength: 42,
    imageCount: 0,
    fileCount: 0,
    selectionCount: 0,
  });
  recordChatSendEvent("msg-retry", { event: "post-retry-scheduled", detail: { reasonKind: "network", delayMs: 2000 } });
  for (let i = 0; i < 30; i++) recordChatSendEnvironmentEvent("bus-ws-connect");
  recordChatSendEvent("msg-retry", { event: "post-error", detail: { reasonKind: "network" } });

  // doctest:L133
  t.check(warnings.slice(2).map((warning) => parseWarning(warning).trigger).join(","), "post-retry-scheduled,post-error");

  // doctest:L136
  t.check(inspectChatSendDiagnostic("msg-retry")[0]?.event, "dispatch");

  // doctest:L139
  console.warn = originalWarn;
  resetChatSendDiagnostics();
});
