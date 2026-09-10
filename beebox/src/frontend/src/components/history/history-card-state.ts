import { z } from "zod";
import type { ViewState, ViewStateValue, ViewTarget } from "../../lib/view-url";
import { EMPTY_FILTER } from "./history-filter";
import type { HistoryFilterState } from "./HistoryFilterBar";
import { paramsToFilter } from "./history-filter";
import { HISTORY_VIEW_PARAMS } from "@shared/named-views";
import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
import { withoutShellParams } from "../../lib/system-card-navigation";
import { viewStateSearchValue } from "../../lib/view-url";

export const HISTORY_FILTER_STATE = z.object({
  connectors: z.array(z.string()), workflows: z.array(z.string()),
  touchpoint: z.boolean(), feedback: z.boolean(),
  session: z.string().nullable(), path: z.string().nullable(),
}).strict();

export const HISTORY_CARD_STATE = z.object({
  filter: HISTORY_FILTER_STATE.optional(),
  /** absent = newest, null = timeline explicitly selected, string = durable detail */
  commit: z.string().min(1).nullable().optional(),
}).strict();
export type HistoryCardState = z.infer<typeof HISTORY_CARD_STATE>;

export function parseHistoryCardState(value: ViewState | null) { return HISTORY_CARD_STATE.safeParse(value ?? {}); }

function strings(value: unknown): ViewStateValue {
  if (typeof value === "string") return value === "" ? [] : value.split(",").filter(Boolean);
  if (Array.isArray(value) && value.every(item => typeof item === "string")) return value;
  return typeof value === "number" || typeof value === "boolean" || value === null ? value : String(value);
}
function bool(value: unknown): ViewStateValue {
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return typeof value === "number" || value === null ? value : String(value);
}
function scalar(value: unknown): ViewStateValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null ? value : String(value);
}

/** Full legacy-page vocabulary, deliberately including path. Invalid values survive for localized rendering. */
export function legacyHistoryState(search: Record<string, unknown>, options?: { commit?: string; defaults?: HistoryFilterState }): ViewState {
  const filter: Record<string, ViewStateValue> = { ...EMPTY_FILTER, ...options?.defaults };
  if (search.connector !== undefined) filter.connectors = strings(search.connector);
  if (search.workflow !== undefined) filter.workflows = strings(search.workflow);
  if (search.touchpoint !== undefined) filter.touchpoint = bool(search.touchpoint);
  if (search.feedback !== undefined) filter.feedback = bool(search.feedback);
  if (search.session !== undefined) filter.session = scalar(search.session);
  if (search.path !== undefined) filter.path = scalar(search.path);
  return { filter, ...(options?.commit === undefined ? {} : { commit: options.commit }) };
}

export const HISTORY_LEGACY_QUERY_KEYS = ["connector", "workflow", "touchpoint", "feedback", "session", "path"] as const;
export function hasLegacyHistoryQuery(params: Record<string, string>): boolean {
  return HISTORY_LEGACY_QUERY_KEYS.some(key => params[key] !== undefined);
}

export function normalizeLegacyHistoryTarget(target: ViewTarget, defaults?: HistoryFilterState): ViewTarget {
  if (!hasLegacyHistoryQuery(target.params)) return target;
  const params = { ...target.params };
  for (const key of HISTORY_LEGACY_QUERY_KEYS) delete params[key];
  const legacy = legacyHistoryState(target.params, { defaults });
  return { ...target, params, viewState: { ...legacy, ...target.viewState } };
}

export async function normalizeHistoryViewRouteTarget(
  target: ViewTarget,
  load: (path: string) => Promise<{ type?: string; frontmatter?: Record<string, unknown> }>,
): Promise<ViewTarget | null> {
  if (!hasLegacyHistoryQuery(target.params)) return null;
  if (target.viewer !== null) return null;
  if (target.path === SYSTEM_CARD_PATHS.history) return normalizeLegacyHistoryTarget(target);
  const card = await load(target.path);
  if (card.type !== "view" || card.frontmatter?.view !== "history") return null;
  const parsed = HISTORY_VIEW_PARAMS.safeParse(card.frontmatter.params ?? {});
  const defaults = parsed.success ? paramsToFilter(parsed.data) : undefined;
  return normalizeLegacyHistoryTarget(target, defaults);
}

export function historyViewRedirectSearch(target: ViewTarget, search: object): Record<string, unknown> {
  const content = withoutShellParams(target);
  const nativeComposer = "nativeComposer" in search ? search.nativeComposer : undefined;
  return { nativeComposer, view: content.viewer ?? undefined, ...content.params, viewState: viewStateSearchValue(content.viewState) };
}
