/**
 * The per-segment progress the speech playback machine shows on each spoken
 * chunk: waiting for audio, playing, or failed (with why). Pure helpers over
 * the index-keyed maps, kept apart from the machine itself.
 */

export type SpeechSegmentState = "waiting" | "playing" | "failed";

export function waitingStates(items: ReadonlyArray<{ index: number }>): Record<number, SpeechSegmentState> {
  return Object.fromEntries(items.map((item) => [item.index, "waiting"]));
}

export function withoutSegment(
  states: Record<number, SpeechSegmentState>,
  index: number,
): Record<number, SpeechSegmentState> {
  const next = { ...states };
  delete next[index];
  return next;
}

export function failedSegment(
  states: Record<number, SpeechSegmentState>,
  index: number,
): Record<number, SpeechSegmentState> {
  return { ...states, [index]: "failed" };
}

export function onlyFailures(
  states: Record<number, SpeechSegmentState>,
): Record<number, SpeechSegmentState> {
  return Object.fromEntries(
    Object.entries(states).filter(([, state]) => state === "failed"),
  );
}

/** The reason a segment failed, as the boxholder should read it. */
export function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function hasFailures(states: Record<number, SpeechSegmentState>): boolean {
  return Object.values(states).includes("failed");
}
