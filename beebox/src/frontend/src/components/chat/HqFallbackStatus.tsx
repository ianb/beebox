import { trpc } from "../../lib/trpc";
import { hqFallbackLabel } from "./hq-fallback-label";

/** How often an unsettled HQ status re-reads the box. */
const HQ_STATUS_REFRESH_MS = 20_000;

/**
 * Status line inside a user bubble whose voice text was sent in place of its
 * HQ transcript (docs/plans/resilient-voice-recording.md, Track 4): "Live
 * text · HQ coming", "HQ failed: …", "HQ transcript below". Polls the box
 * until the handoff settles.
 */
export function HqFallbackStatus({ messageId, mark }: { messageId: string; mark: "pending" | "failed" }) {
  const status = trpc.voiceRecording.statusByMessage.useQuery({ messageId }, {
    refetchInterval: (query) => (hqFallbackLabel(mark, query.state.data).settled ? false : HQ_STATUS_REFRESH_MS),
  });
  const text = status.isError ? "Live text · HQ status unavailable" : hqFallbackLabel(mark, status.data).text;
  return <div role="status" className="bbx-chat-user-status text-xs text-white/70 mt-1 italic">{text}</div>;
}
