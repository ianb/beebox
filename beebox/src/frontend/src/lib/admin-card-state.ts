import { isRecord } from "@shared/is-record";
import type { ViewState } from "@shared/view-state";
import { adminTabForSection, isAdminTab, type AdminTab } from "../components/admin/admin-sections";

export interface AdminArrivalState {
  google?: "connected" | "error";
  message?: string;
  reconnect?: "google";
}

export type AdminCardStateResult =
  | { ok: true; arrival: AdminArrivalState; tab: AdminTab | null }
  | { ok: false; error: string };

/** The card's view state: an arrival notice from an OAuth return, plus the open tab. */
export function parseAdminCardState(value: ViewState | null | undefined): AdminCardStateResult {
  if (value === null || value === undefined) return { ok: true, arrival: {}, tab: null };
  if (!isRecord(value)) return invalidAdminState();
  const google = value["google"];
  const message = value["message"];
  const reconnect = value["reconnect"];
  const tab = value["tab"];
  if (!(google === undefined || google === "connected" || google === "error")
    || !(message === undefined || typeof message === "string")
    || !(reconnect === undefined || reconnect === "google")
    || !(tab === undefined || isAdminTab(tab))) return invalidAdminState();
  return { ok: true, arrival: { ...(google ? { google } : {}), ...(message === undefined ? {} : { message }), ...(reconnect ? { reconnect } : {}) }, tab: tab ?? null };
}

/** The same state with a different tab open; arrival keys are untouched. */
export function adminTabViewState(value: ViewState | null | undefined, tab: AdminTab): ViewState {
  return { ...(value ?? {}), tab };
}

export function adminArrivalViewState(search: Record<string, unknown>): ViewState | null {
  const google = search["google"];
  const message = search["message"];
  const reconnect = search["reconnect"];
  const tab = search["tab"];
  const state: ViewState = {
    ...((google === "connected" || google === "error") ? { google } : {}),
    ...(typeof message === "string" ? { message } : {}),
    ...(reconnect === "google" ? { reconnect } : {}),
    ...(isAdminTab(tab) ? { tab } : {}),
  };
  return Object.keys(state).length === 0 ? null : state;
}

/**
 * Consume the arrival. A Google arrival opened Google's tab, so consuming it
 * pins that tab unless the URL already named one; otherwise the page would
 * fall back to the default tab the moment the notice was acknowledged.
 */
export function clearAdminArrivalState(value: ViewState | null | undefined): ViewState {
  if (!value) return {};
  const next = { ...value };
  const landedOnGoogle = next["google"] !== undefined || next["reconnect"] !== undefined;
  delete next["google"];
  delete next["message"];
  delete next["reconnect"];
  if (landedOnGoogle && !isAdminTab(next["tab"])) next["tab"] = adminTabForSection("google-services");
  return next;
}

export function adminArrivalKey(arrival: AdminArrivalState): string | null {
  return Object.keys(arrival).length === 0 ? null : JSON.stringify(arrival);
}

export function shouldConsumeAdminArrival(input: { arrival: AdminArrivalState; visible: boolean; loading: boolean; alreadyProcessed: boolean }): boolean {
  return shouldAcknowledgeAdminArrival(input) && !input.alreadyProcessed;
}

export function shouldAcknowledgeAdminArrival(input: { arrival: AdminArrivalState; visible: boolean; loading: boolean }): boolean {
  return adminArrivalKey(input.arrival) !== null && input.visible && !input.loading;
}

export function adminArrivalReceipt(historyIndex: number, arrival: AdminArrivalState): string | null {
  const key = adminArrivalKey(arrival);
  return key === null ? null : `${String(historyIndex)}:${key}`;
}

function invalidAdminState(): AdminCardStateResult {
  return { ok: false, error: "Invalid Admin arrival state." };
}
