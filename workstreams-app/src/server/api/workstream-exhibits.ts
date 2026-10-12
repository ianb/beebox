// Joins the exhibit inventory onto workstream rows, by workstream directory
// name == row name (the join the issue overlay uses).

import type { ExhibitInventory, ExhibitInventoryEntry } from "../../shared/exhibits.js";
import type { WorkstreamListResult } from "../../shared/workstreams.js";

function createdMs(entry: ExhibitInventoryEntry): number {
  const time = entry.created === null ? Number.NaN : Date.parse(entry.created);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** One workstream's exhibits, newest first; broken rows (no usable date) last. */
export function exhibitsFor(inventory: ExhibitInventory, workstream: string): ExhibitInventoryEntry[] {
  return inventory.entries
    .filter((entry) => entry.workstream === workstream)
    .toSorted((left, right) => {
      const difference = createdMs(right) - createdMs(left);
      if (difference !== 0 && !Number.isNaN(difference)) return difference;
      return left.slug.localeCompare(right.slug);
    });
}

/** The list result with each row's exhibits; an unreadable store becomes a warning. */
export function withExhibits(result: WorkstreamListResult, inventory: ExhibitInventory) {
  return {
    exhibitsOrigin: inventory.origin,
    items: result.items.map((item) => ({ ...item, exhibits: exhibitsFor(inventory, item.name) })),
    warnings: inventory.storeProblem === null
      ? result.warnings
      : [...result.warnings, { row: null, name: null, fields: [], message: inventory.storeProblem }],
  };
}
