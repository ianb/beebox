/** Saved History defaults and their human-readable filter summary. */

import type { HistoryViewParams } from "@shared/named-views";
import type { HistoryFilterState } from "./HistoryFilterBar";

export const EMPTY_FILTER: HistoryFilterState = {
  connectors: [],
  workflows: [],
  touchpoint: false,
  feedback: false,
  session: null,
  path: null,
};

/** A `view: history` card's frontmatter params as a filter state. */
export function paramsToFilter(params: HistoryViewParams): HistoryFilterState {
  return {
    connectors: params.connectors ?? [],
    workflows: params.workflows ?? [],
    touchpoint: params.touchpoint ?? false,
    feedback: params.feedback ?? false,
    session: params.session ?? null,
    path: null,
  };
}

/** Short human summary of a filter, for the card header ("feedback · connector: gmail"). */
export function describeFilter(filter: HistoryFilterState): string {
  const parts: string[] = [];
  if (filter.connectors.length > 0) parts.push(`connector: ${filter.connectors.join(", ")}`);
  if (filter.workflows.length > 0) parts.push(`workflow: ${filter.workflows.join(", ")}`);
  if (filter.touchpoint) parts.push("touchpoint");
  if (filter.feedback) parts.push("feedback");
  if (filter.session !== null) parts.push(`session: ${filter.session.slice(0, 8)}`);
  if (filter.path !== null) parts.push(`path: ${filter.path}`);
  return parts.length > 0 ? parts.join(" · ") : "all commits";
}
