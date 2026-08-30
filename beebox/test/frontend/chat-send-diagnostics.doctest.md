# Chat send diagnostics — bounded, private anomaly timelines

The send diagnostic keeps routine lifecycle events in memory and emits only
when the receipt is rejected or slow, or a transport anomaly occurs. Its public
event API accepts enumerated metadata, not message content.

```ts setup
import {
  beginChatSendDiagnostic,
  chatSendReasonKind,
  inspectChatSendDiagnostic,
  observeChatSendHistory,
  observeChatSendReceipt,
  recordChatSendEvent,
  recordChatSendEnvironmentEvent,
  resetChatSendDiagnostics,
} from "../../src/frontend/src/lib/chat-send-diagnostics.js";

resetChatSendDiagnostics();
const warnings: string[] = [];
const originalWarn = console.warn;
console.warn = (value: unknown) => warnings.push(String(value));
```

## A routine send stays silent and records hop ordering

```ts
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

warnings.length
=> 0

inspectChatSendDiagnostic("msg-ok").map((entry) => entry.event).join(",")
=> dispatch,post-issued,post-response,receipt-observed,durable-history-observed
```

## A rejection flushes one content-free timeline

```ts
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

warnings.length
=> 1

const payload = JSON.parse(warnings[0].replace("[chat-send-diagnostic] ", ""));
[payload.trigger, payload.emissionId, payload.events[0].detail.textLength].join("|")
=> receipt-rejected|msg-timeout|321

JSON.stringify(payload).includes("diagnostic transport test")
=> false

chatSendReasonKind("request contained diagnostic transport test at https://secret.invalid")
=> other
```

## A transport anomaly flushes even after a fast accepted receipt

```ts
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

warnings.length
=> 2

const streamPayload = JSON.parse(warnings[1].replace("[chat-send-diagnostic] ", ""));
[streamPayload.trigger, streamPayload.events.find((entry) => entry.event === "turn-stream-progress").detail.frameCount].join("|")
=> turn-stream-error|100

warnings[1].length < 4000
=> true
```

## A retry keeps a separate terminal snapshot and ring pressure preserves dispatch

```ts
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

warnings.slice(2).map((warning) => JSON.parse(warning.replace("[chat-send-diagnostic] ", "")).trigger).join(",")
=> post-retry-scheduled,post-error

inspectChatSendDiagnostic("msg-retry")[0].event
=> dispatch

console.warn = originalWarn;
resetChatSendDiagnostics();
```
