/**
 * TargetStrip — the chat target's own status + control row (docs/plans/
 * input-extraction.md, chunk 3). Rendered where the old "Agent is busy — N
 * queued" banner used to live (ChatStatusBanners), directly above the
 * composer. Two things moved here from the composer bar because they're
 * the target's concern, not the input's: the busy/queued status derived
 * from `chatTargetStatus`, and the stop-agent / stop-TTS controls
 * (`InteractiveChat-composer.tsx`, pre-chunk-3).
 *
 * Stop-TTS is not a bare button move: `STOP_SPEECH` in `pausedForSpeech`
 * also resumes the mic (composerMachine.ts), so this renders the same
 * `onStopSpeech` handler the composer used — only the button's location
 * changes.
 */

import type { ChatTargetStatus } from "../../input/targets/chat-target";

const STRIP_BTN = "flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0";

export function TargetStrip(props: {
  status: ChatTargetStatus;
  pendingCount: number;
  isStreaming: boolean;
  onInterrupt: () => void;
  speechPlaying: boolean;
  onStopSpeech: () => void;
}) {
  const { status, pendingCount, isStreaming, onInterrupt, speechPlaying, onStopSpeech } = props;
  const hasContent = status.state === "busy" || pendingCount > 0 || isStreaming || speechPlaying;
  if (!hasContent) return null;

  return (
    <div className="px-4 py-1.5 border-t border-info-light bg-info-50 text-info-dark text-xs flex items-center gap-3">
      <div className="flex-1 flex items-center gap-3">
        {status.state === "busy" ? <span>Agent is working…</span> : null}
        {pendingCount > 0 ? (
          <span>{pendingCount === 1 ? "1 message queued" : `${pendingCount} messages queued`}</span>
        ) : null}
      </div>
      {speechPlaying ? (
        <button
          onClick={onStopSpeech}
          className={`${STRIP_BTN} bg-danger-100 text-danger hover:bg-danger-100 active:bg-danger-light`}
          title="Stop speaking"
        >
          {/* Speaker-x (audio), not the stop circle — that one stops the agent. */}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5 6 9H3v6h3l5 4V5zM17 9l4 6m0-6-4 6" />
          </svg>
        </button>
      ) : null}
      {isStreaming ? (
        <button
          onClick={onInterrupt}
          className={`${STRIP_BTN} bg-danger-100 text-danger hover:bg-danger-100 active:bg-danger-light`}
          title="Stop agent"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
