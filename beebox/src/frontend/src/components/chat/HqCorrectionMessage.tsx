import { useState } from "react";
import { UserMessageText } from "./user-message-text";

/** A correction longer than this many lines (or characters) starts collapsed. */
const COLLAPSED_LINES = 6;
const COLLAPSE_CHARS = 480;

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * A late HQ transcript (`<speech corrects="X">`,
 * docs/plans/resilient-voice-recording.md, Track 4): a compact user bubble
 * that names the message it corrects by time, collapsed after six lines. The
 * original may have scrolled out of the loaded window; then it renders
 * standalone without the time.
 */
export function HqCorrectionMessage({ text, originalTime, own }: { text: string; originalTime: string | null; own: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.split("\n").length > COLLAPSED_LINES || text.length > COLLAPSE_CHARS;
  const whose = own ? "your message" : "the message";
  const heading = originalTime === null ? `HQ transcript of ${whose}` : `HQ transcript of ${whose} at ${clockTime(originalTime)}`;
  return (
    <div className={own ? "flex justify-end pl-12 sm:pl-24 py-1" : "pr-12 sm:pr-24 py-1 ml-3 sm:ml-6"}>
      <div className="min-w-0 rounded-2xl bg-info/80 text-white px-3 py-1.5 text-sm break-words">
        <div className="text-xs text-white/70 mb-0.5">{heading}</div>
        <div className={long && !expanded ? "whitespace-pre-wrap line-clamp-6" : "whitespace-pre-wrap"}>
          <UserMessageText text={text} />
        </div>
        {long ? (
          <button type="button" className="text-xs text-white/80 underline mt-0.5" onClick={() => setExpanded((open) => !open)}>
            {expanded ? "Show less" : "Show all"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
