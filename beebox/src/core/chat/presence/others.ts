import type { PresentPerson } from "./types.js";

export interface Watcher {
  /** Join order across the process; earlier joins sort first. */
  seq: number;
  person: PresentPerson;
}

/**
 * Everyone present except `selfEmail`: one entry per person however many tabs
 * they have open, ordered by each person's earliest join so heads don't jump.
 */
export function othersFor(watchers: readonly Watcher[], selfEmail: string): PresentPerson[] {
  const self = selfEmail.toLowerCase();
  const earliest = new Map<string, Watcher>();
  for (const w of watchers) {
    const key = w.person.email.toLowerCase();
    if (key === self) continue;
    const seen = earliest.get(key);
    if (seen === undefined || w.seq < seen.seq) earliest.set(key, w);
  }
  return [...earliest.values()].toSorted((a, b) => a.seq - b.seq).map((w) => w.person);
}
