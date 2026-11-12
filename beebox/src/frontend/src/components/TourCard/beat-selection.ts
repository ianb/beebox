/**
 * Which beat of a tour the strip shows (`docs/plans/conversation-strip.md`,
 * Track B). The selection follows the card's `current` until the person
 * clicks another title. A click is remembered together with the `current`
 * it was made under, so when the agent moves `current` the pick lapses and
 * the new current beat is selected again. A click never writes the card.
 */

import { currentBeatIndex, type TourBeat } from "@shared/tour-beats";

/** A beat title the person clicked, and the card's `current` at that moment. */
export interface BeatPick {
  title: string;
  current: string | undefined;
}

/**
 * The index of the beat to show, or null when the tour has no beats. A pick
 * made under the card's present `current` wins; else the current beat; else
 * the first beat.
 */
export function selectedBeatIndex({ beats, current, picked }: {
  beats: readonly TourBeat[];
  current: string | undefined;
  picked: BeatPick | null;
}): number | null {
  if (beats.length === 0) return null;
  if (picked !== null && picked.current === current) {
    const index = beats.findIndex((beat) => beat.title === picked.title);
    if (index !== -1) return index;
  }
  return currentBeatIndex(beats, current) ?? 0;
}

/** The card's `current` field, when it is a string. */
export function tourCurrent(frontmatter: Record<string, unknown> | undefined): string | undefined {
  const value = frontmatter?.current;
  return typeof value === "string" ? value : undefined;
}
