# The status line on a voice message sent before its HQ transcript

A voice message sent with `hq="pending"` or `hq="failed"`
(`docs/plans/resilient-voice-recording.md`, Track 4) shows a status line from
the box's `voiceRecording.statusByMessage`. `hqFallbackLabel` picks the text,
and says when nothing more will change, so the bubble stops polling.

```ts setup
import { hqFallbackLabel } from "../../../src/frontend/src/components/chat/hq-fallback-label.js";

const status = (hq: unknown, handoff: unknown) => ({ recordingId: "rec", hq, handoff, sealed: true, service: "mai" });
const show = (mark: "pending" | "failed", s: unknown) => {
  const l = hqFallbackLabel(mark, s);
  return `${l.text}${l.settled ? " (settled)" : ""}`;
};
```

```ts
[
  show("pending", undefined),
  show("pending", status({ state: "transcribing", piece: 1, pieces: 2, attempt: 1, pieceSeconds: 300 }, { mode: "late", emissionId: "em" })),
  show("pending", status({ state: "ready", result: {} }, { mode: "delivering", emissionId: "em" })),
  show("pending", status({ state: "ready", result: {} }, { mode: "delivered", emissionId: "em", messageId: "rec" })),
  show("pending", status({ state: "failed", failure: { kind: "exhausted", code: "hq_retry_exhausted", message: "HQ transcription retry window elapsed" } }, { mode: "late", emissionId: "em" })),
  show("failed", status({ state: "failed", failure: { kind: "permanent", code: "missing_key", message: "No OpenRouter key" } }, { mode: "open" })),
  show("pending", null),
].join("\n")
=>
Live text · HQ coming
Live text · HQ coming
HQ transcript below
HQ transcript below (settled)
HQ failed: HQ transcription retry window elapsed (settled)
HQ failed: No OpenRouter key (settled)
Live text (settled)
```
