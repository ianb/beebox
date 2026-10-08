/**
 * The selected conversation's transcript, as the open chat has it.
 *
 * Ambient replies track the selected conversation too, so the reply the user
 * read in the transcript counts as seen after they move to another chat. They
 * used to fetch that conversation's history and status for it, repeating the
 * chat's own load on every page load and every refresh. `InteractiveChat`
 * provides what its machine already holds instead. The value is null until the
 * machine's first history load finishes: an empty transcript observed earlier
 * would be recorded as the baseline, and the real reply would then read as new.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { SessionEntry } from "../../../api";

export interface SelectedTranscript {
  sessionId: string;
  entries: SessionEntry[];
  total: number;
  busy: boolean;
}

const SelectedTranscriptContext = createContext<SelectedTranscript | null>(null);

/** The open chat's transcript when it belongs to `sessionId`, else null. */
export function useSelectedTranscript(sessionId: string): SelectedTranscript | null {
  const selected = useContext(SelectedTranscriptContext);
  return selected?.sessionId === sessionId ? selected : null;
}

/** Provides the open chat's transcript to the ambient region it wraps, once its first load is done. */
export function SelectedTranscriptRegion({ sessionId, loaded, entries, total, busy, children }: {
  sessionId: string | null; loaded: boolean; entries: SessionEntry[]; total: number; busy: boolean; children: ReactNode;
}) {
  const value = useMemo(
    () => (sessionId !== null && loaded ? { sessionId, entries, total, busy } : null),
    [sessionId, loaded, entries, total, busy],
  );
  return <SelectedTranscriptContext.Provider value={value}>{children}</SelectedTranscriptContext.Provider>;
}
