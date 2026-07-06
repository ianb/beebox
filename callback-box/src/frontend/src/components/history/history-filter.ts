/**
 * History filter plumbing shared by the History page (filter state in URL
 * search params) and `view: history` cards (filter state in frontmatter
 * params). One mapping in each direction keeps the two spellings of the
 * same filter from drifting.
 */

import type { HistoryViewParams } from "@shared/named-views";
import type { HistoryFilterState } from "./HistoryFilterBar";

export const EMPTY_FILTER: HistoryFilterState = {
  connectors: [],
  workflows: [],
  touchpoint: false,
  feedback: false,
  session: null,
};

/** The History page's URL search-param shape. */
export interface HistorySearch {
  connector?: string[];
  workflow?: string[];
  touchpoint?: boolean;
  feedback?: boolean;
  session?: string;
}

export function searchToFilter(search: HistorySearch): HistoryFilterState {
  return {
    connectors: search.connector ?? [],
    workflows: search.workflow ?? [],
    touchpoint: search.touchpoint ?? false,
    feedback: search.feedback ?? false,
    session: search.session ?? null,
  };
}

export function filterToSearch(filter: HistoryFilterState): HistorySearch {
  const search: HistorySearch = {};
  if (filter.connectors.length > 0) search.connector = filter.connectors;
  if (filter.workflows.length > 0) search.workflow = filter.workflows;
  if (filter.touchpoint) search.touchpoint = true;
  if (filter.feedback) search.feedback = true;
  if (filter.session !== null) search.session = filter.session;
  return search;
}

/** A `view: history` card's frontmatter params as a filter state. */
export function paramsToFilter(params: HistoryViewParams): HistoryFilterState {
  return {
    connectors: params.connectors ?? [],
    workflows: params.workflows ?? [],
    touchpoint: params.touchpoint ?? false,
    feedback: params.feedback ?? false,
    session: params.session ?? null,
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
  return parts.length > 0 ? parts.join(" · ") : "all commits";
}
