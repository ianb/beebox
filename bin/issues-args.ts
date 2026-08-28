/**
 * Flag parsing for `bin/issues` — the `parseArgs` option table, the shape it
 * produces, and the conversions from strings on the command line to the typed
 * `IssueFilters` the model works in.
 *
 * Split out of `bin/issues.ts` purely for size; the surface is identical.
 */

import {
  emptyFilters, normalizeWorkstreamName, type IssueFilters,
} from "../workstreams-app/src/server/issue-search-model.js";
import { InvalidFlagValueError, InvalidIntegerFlagError, InvalidSinceError } from "./issues-errors.js";

export const RESEARCH_STATES = ["awaiting", "researched", "none"] as const;
export const SEARCH_MODES = ["text", "hybrid", "semantic"] as const;

export function oneOf<T extends string>(input: { value: string; allowed: readonly T[]; flag: string }): T {
  const match = input.allowed.find((candidate) => candidate === input.value);
  if (match === undefined) throw new InvalidFlagValueError(input.flag, input.allowed);
  return match;
}

export const options = {
  json: { type: "boolean" },
  all: { type: "boolean" },
  closed: { type: "boolean" },
  rebuild: { type: "boolean" },
  docs: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  by: { type: "string" },
  min: { type: "string" },
  limit: { type: "string" },
  mode: { type: "string" },
  since: { type: "string" },
  research: { type: "string" },
  visibility: { type: "string" },
  category: { type: "string", multiple: true },
  area: { type: "string", multiple: true },
  label: { type: "string", multiple: true },
  workstream: { type: "string", multiple: true },
  "discovered-in": { type: "string", multiple: true },
  needs: { type: "string", multiple: true },
  priority: { type: "string", multiple: true },
  "next-action": { type: "string", multiple: true },
} as const;

/** The shape `options` above produces — spelled out so the rest of the file is plainly typed. */
export interface ParsedValues {
  json?: boolean | undefined;
  all?: boolean | undefined;
  closed?: boolean | undefined;
  rebuild?: boolean | undefined;
  docs?: boolean | undefined;
  help?: boolean | undefined;
  by?: string | undefined;
  min?: string | undefined;
  limit?: string | undefined;
  mode?: string | undefined;
  since?: string | undefined;
  research?: string | undefined;
  visibility?: string | undefined;
  category?: string[] | undefined;
  area?: string[] | undefined;
  label?: string[] | undefined;
  workstream?: string[] | undefined;
  "discovered-in"?: string[] | undefined;
  needs?: string[] | undefined;
  priority?: string[] | undefined;
  "next-action"?: string[] | undefined;
}

export function buildFilters(values: ParsedValues): IssueFilters {
  const filters = emptyFilters();
  if (values.all === true) filters.status = "all";
  else if (values.closed === true) filters.status = "closed";
  filters.category = values.category ?? [];
  filters.area = values.area ?? [];
  filters.labels = values.label ?? [];
  filters.needs = values.needs ?? [];
  filters.priority = values.priority ?? [];
  filters.nextAction = values["next-action"] ?? [];
  filters.workstream = (values.workstream ?? []).map(normalizeWorkstreamName);
  filters.discoveredIn = (values["discovered-in"] ?? []).map(normalizeWorkstreamName);
  if (values.since !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(values.since)) throw new InvalidSinceError();
    filters.since = values.since;
  }
  if (values.research !== undefined) {
    filters.research = oneOf({ value: values.research, allowed: RESEARCH_STATES, flag: "--research" });
  }
  if (values.visibility !== undefined) {
    filters.visibility = oneOf({
      value: values.visibility, allowed: ["public", "private"] as const, flag: "--visibility",
    });
  }
  return filters;
}

/** True when a filter narrows by something a design doc cannot have. */
export function narrowsToIssues(filters: IssueFilters): boolean {
  return filters.category.length > 0 || filters.area.length > 0 || filters.labels.length > 0
    || filters.needs.length > 0 || filters.priority.length > 0 || filters.nextAction.length > 0
    || filters.workstream.length > 0 || filters.discoveredIn.length > 0
    || filters.since !== null || filters.research !== null || filters.visibility !== null;
}

/**
 * How many ranked hits to ask the index for, given that some filters are applied
 * afterwards in JS. A page-sized request would be consumed entirely by hits the
 * post-filter then drops (a narrow `--since` over a common term returned nothing
 * at all before this), so a narrowing filter asks for the whole corpus and lets
 * the post-filter choose the page out of it.
 */
const WIDE_BUDGET = 1000;

export function resultBudget(filters: IssueFilters, limit: number): number {
  return narrowsToIssues(filters) ? WIDE_BUDGET : limit;
}

export function positiveInt(raw: string | undefined, options_: { fallback: number; flag: string }): number {
  if (raw === undefined) return options_.fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new InvalidIntegerFlagError(options_.flag);
  return value;
}
