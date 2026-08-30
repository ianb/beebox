/**
 * Wrapper around one spoken `<speech>` chunk in an assistant message.
 *
 * Provides the now-playing highlight (a subtle background that fades in/out as
 * playback moves from chunk to chunk) and an optional speaker name label. The
 * spoken text itself is passed as children (rendered markdown).
 *
 * Presentational only — `active` is driven by the playback machine's
 * currently-playing segment index; see useSpeechPlayback / AssistantMessage.
 */

import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { SpeechSegmentState } from "../../machines/speechPlaybackMachine";

const stateDescription: Record<SpeechSegmentState, string> = {
  waiting: "Speech audio is being prepared.",
  playing: "Speech audio is playing.",
  failed: "Speech audio failed.",
};

export function SpeechChunk({
  name,
  state,
  children,
}: {
  name?: string | undefined;
  state?: SpeechSegmentState | undefined;
  children: ReactNode;
}) {
  const description = state === undefined ? undefined : stateDescription[state];
  return (
    <div
      data-speech-state={state}
      className={cn(
        "border-l-2 pl-3 pr-2 py-1 rounded-r-md transition-colors duration-500 ease-out",
        state === "waiting" && "border-warning border-dashed bg-warning/5",
        state === "playing" && "border-primary border-solid bg-white/25",
        state === "failed" && "border-l-4 border-danger border-double bg-danger/5",
        state === undefined && "border-warm-300 border-solid bg-transparent",
      )}
    >
      {description === undefined ? null : <span className="sr-only">{description}</span>}
      {name !== undefined && name.length > 0 ? (
        <div className="-ml-1 text-[10px] font-semibold uppercase tracking-wide text-warm-600 mb-0.5">{name}</div>
      ) : null}
      {children}
    </div>
  );
}
