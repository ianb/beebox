// Grouping for the "waiting on you" queue, kept out of the page so the shape is
// testable without a DOM (the issue-category-nav.ts precedent).

import type { AskQueue, AskQueueEntry, AskType } from "../types.js";

/** Cost-ordered: a decision blocks work, an FYI never does. */
export const ASK_GROUP_ORDER = ["decide", "confirm", "react"] as const satisfies readonly AskType[];

export interface AskGroup {
  type: AskType;
  entries: AskQueueEntry[];
}

export interface GroupedAskQueue {
  /** The ordered non-FYI groups; empty groups are dropped. */
  groups: AskGroup[];
  /** Unanswered non-FYI asks — the number the queue is named for. */
  waitingCount: number;
  /** Unanswered FYIs, shown collapsed: seen, never chased. */
  fyi: AskQueueEntry[];
  /** Entries whose manifest did not parse: visible, never silently dropped. */
  broken: AskQueueEntry[];
  answered: AskQueueEntry[];
}

export function groupAskQueue(queue: AskQueue): GroupedAskQueue {
  const unanswered = queue.entries.filter((entry) => !entry.answered && entry.ask !== null);
  const waiting = unanswered.filter((entry) => entry.ask?.type !== "fyi");
  return {
    groups: ASK_GROUP_ORDER.map((type) => ({
      type,
      entries: waiting.filter((entry) => entry.ask?.type === type),
    })).filter((group) => group.entries.length > 0),
    waitingCount: waiting.length,
    fyi: unanswered.filter((entry) => entry.ask?.type === "fyi"),
    broken: queue.entries.filter((entry) => entry.ask === null),
    answered: queue.entries.filter((entry) => entry.answered),
  };
}
