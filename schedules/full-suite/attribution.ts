import type { Landing } from "./lib.js";

export interface Batch {
  pinned: string;
  base: string | null;
  landings: Landing[];
  attributableLandings: Landing[];
}

/** A bisected commit is reportable only when that landing touches deployed paths. */
export function attributableLanding(input: {
  found: Landing;
  attributableCommits: ReadonlySet<string>;
}): Landing | null {
  return input.attributableCommits.has(input.found.commit) ? input.found : null;
}

/** Real failures that were not selected for bisect remain visible in the alert. */
export function unbisectedFiles(input: { real: readonly string[]; bisectable: readonly string[] }): string[] {
  const bisectable = new Set(input.bisectable);
  return input.real.filter((file) => !bisectable.has(file));
}
