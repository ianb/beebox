/**
 * The status line under a voice message sent in place of its HQ transcript
 * (`<speech hq="pending">` / `hq="failed"`,
 * docs/plans/resilient-voice-recording.md, Track 4), from the box's
 * `voiceRecording.statusByMessage`. `settled` stops the polling once nothing
 * more will change.
 */

import type { RouterOutput } from "../../lib/trpc";

type MessageVoiceStatus = RouterOutput["voiceRecording"]["statusByMessage"];

export function hqFallbackLabel(
  mark: "pending" | "failed",
  status: MessageVoiceStatus | undefined,
): { text: string; settled: boolean } {
  if (status === undefined) {
    return { text: mark === "pending" ? "Live text · HQ coming" : "Live text · HQ failed", settled: false };
  }
  // The recording is gone (collected after 7 days) or was never staged here.
  if (status === null) return { text: mark === "pending" ? "Live text" : "Live text · HQ failed", settled: true };
  if (status.hq.state === "failed") return { text: `HQ failed: ${status.hq.failure.message}`, settled: true };
  switch (status.handoff.mode) {
    case "delivered":
      return { text: "HQ transcript below", settled: true };
    case "delivering":
      return { text: "HQ transcript below", settled: false };
    case "claimed":
      // HQ finished just as the live text was sent; no correction follows.
      return { text: "Live text · HQ kept on the box", settled: true };
    case "late":
    case "open":
      return { text: "Live text · HQ coming", settled: false };
  }
}
