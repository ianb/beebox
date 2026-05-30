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

export function SpeechChunk({
  name,
  active,
  children,
}: {
  name?: string | undefined;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "border-l-2 pl-3 pr-2 py-1 rounded-r-md transition-colors duration-500 ease-out",
        active ? "border-primary bg-white/25" : "border-warm-300 bg-transparent",
      )}
    >
      {name !== undefined && name.length > 0 ? (
        <div className="-ml-1 text-[10px] font-semibold uppercase tracking-wide text-warm-600 mb-0.5">{name}</div>
      ) : null}
      {children}
    </div>
  );
}
