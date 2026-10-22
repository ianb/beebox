// # Chat send diagnostics — bounded, private anomaly timelines
//
// The send diagnostic keeps routine lifecycle events in memory and emits only
// when the receipt is rejected or slow, or a transport anomaly occurs. Its public
// event API accepts enumerated metadata, not message content.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
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
  version: number;
  emissionId: string;
  trigger: string;
  phase: string;
  elapsedMs: number;
  events: { event: string; tMs: number; visibility: string; detail: Record<string, unknown> }[];
}

/** Parse one captured warning line; a missing line fails the example. */
function parseWarning(line: string | undefined): DiagnosticPayload {
  assert.ok(line, "expected a captured warning");
  return JSON.parse(line.replace("[chat-send-diagnostic] ", ""));
}

resetChatSendDiagnostics();
const warnings: string[] = [];
const originalWarn = console.warn;
const originalNow = Date.now;
// A fixed clock makes every elapsed time in a timeline 0.
Date.now = () => 1_000_000;
console.warn = (value: unknown) => warnings.push(String(value));

// ## A routine send stays silent and records hop ordering
void test("A routine send stays silent and records hop ordering", async (t) => {
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

  t.check(warnings, []);

  t.check(inspectChatSendDiagnostic("msg-ok").map((entry) => entry.event), ["dispatch", "post-issued", "post-response", "receipt-observed", "durable-history-observed"]);
});

// ## A rejection flushes one content-free timeline
void test("A rejection flushes one content-free timeline", async (t) => {
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

  t.check(warnings.map(parseWarning), [
    {
      version: 1,
      emissionId: "msg-timeout",
      trigger: "receipt-rejected",
      phase: "terminal",
      elapsedMs: 0,
      events: [
        { event: "dispatch", tMs: 0, visibility: "unavailable", detail: { origin: "voice", textLength: 321, imageCount: 1, fileCount: 2, selectionCount: 3 } },
        { event: "post-issued", tMs: 0, visibility: "unavailable", detail: { attempt: 1 } },
        { event: "receipt-observed", tMs: 0, visibility: "unavailable", detail: { disposition: "rejected", reasonKind: "timeout" } },
      ],
    },
  ]);

  t.check(
    chatSendReasonKind("request contained diagnostic transport test at https://secret.invalid")
    ,
    "other",
  );
});

// ## A transport anomaly flushes even after a fast accepted receipt
void test("A transport anomaly flushes even after a fast accepted receipt", async (t) => {
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

  t.check(warnings.slice(1).map(parseWarning), [
    {
      version: 1,
      emissionId: "msg-stream",
      trigger: "turn-stream-error",
      phase: "terminal",
      elapsedMs: 0,
      events: [
        { event: "dispatch", tMs: 0, visibility: "unavailable", detail: { origin: "typed", textLength: 10, imageCount: 0, fileCount: 0, selectionCount: 0 } },
        { event: "receipt-observed", tMs: 0, visibility: "unavailable", detail: { disposition: "sent" } },
        { event: "turn-stream-progress", tMs: 0, visibility: "unavailable", detail: { frameCount: 100, lastFrame: "msg", lastFrameAtMs: 0 } },
        { event: "turn-stream-error", tMs: 0, visibility: "unavailable", detail: { errorLength: 120 } },
      ],
    },
  ]);

  t.check(warnings[1], any(String).matches(/^.{0,3999}$/s));
});

// ## A retry keeps a separate terminal snapshot and ring pressure preserves dispatch
void test("A retry keeps a separate terminal snapshot and ring pressure preserves dispatch", async (t) => {
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

  t.check(warnings.slice(2).map((warning) => parseWarning(warning).trigger), ["post-retry-scheduled", "post-error"]);

  // `online` is left out: Node's `navigator.onLine` is undefined, which the
  // event's `boolean | null` type does not allow.
  const first = inspectChatSendDiagnostic("msg-retry")[0];
  t.check(first && { event: first.event, tMs: first.tMs, visibility: first.visibility, detail: first.detail }, {
    event: "dispatch",
    tMs: 0,
    visibility: "unavailable",
    detail: { origin: "typed", textLength: 42, imageCount: 0, fileCount: 0, selectionCount: 0 },
  });

  console.warn = originalWarn;
  Date.now = originalNow;
  resetChatSendDiagnostics();
});
