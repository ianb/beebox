/**
 * How a chat's transcript state reads on screen.
 *
 * The state itself is derived server-side (`core/chat/session/availability.ts`)
 * — this is only its wording, in one place so the chat page, the husk card and
 * the chat lists say the same thing about the same state.
 */

import { assertNever } from "@shared/invariant";
import type { TranscriptState } from "@core/chat/session/availability.js";

/** Short form — a list row's or a section heading's worth of words. */
export function transcriptStateLabel(transcript: TranscriptState): string {
  switch (transcript.state) {
    case "present":
      return "Available";
    case "expired":
      return "Expired";
    case "elsewhere":
      return `On ${transcript.originName}`;
    case "unknown":
      return "Unavailable";
    default:
      return assertNever(transcript);
  }
}

/** Long form — the one sentence a dead chat's page owes the reader. */
export function transcriptStateSentence(transcript: TranscriptState): string {
  switch (transcript.state) {
    case "present":
      return "Its transcript is on this machine.";
    case "expired":
      return "It ran on this machine and its transcript has since expired, so callback-box will not try to resume it.";
    case "elsewhere":
      return `It ran on ${transcript.originName}, so its transcript was never on this machine and callback-box will not try to resume it.`;
    case "unknown":
      return "Its local transcript is missing and the chat card records no origin machine, so callback-box will not try to resume it.";
    default:
      return assertNever(transcript);
  }
}

/** Dead chats under one heading — every row in it reads the same way. */
export interface TranscriptGroup<T> {
  label: string;
  rows: T[];
}

/**
 * Group dead chats by what their state *says* — so every chat from one machine
 * lands under that machine's name, and the reader gets one heading per reason
 * rather than one row each. First-seen order, which is the caller's order.
 */
export function groupByTranscriptState<T extends { transcript: TranscriptState }>(rows: readonly T[]): TranscriptGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const label = transcriptStateLabel(row.transcript);
    const existing = groups.get(label);
    if (existing === undefined) groups.set(label, [row]);
    else existing.push(row);
  }
  return [...groups.entries()].map(([label, grouped]) => ({ label, rows: grouped }));
}
