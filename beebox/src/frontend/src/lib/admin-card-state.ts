import { isRecord } from "@shared/is-record";
import type { ViewState } from "@shared/view-state";

export interface AdminArrivalState {
  google?: "connected" | "error";
  message?: string;
  reconnect?: "google";
}

export type AdminCardStateResult =
  | { ok: true; arrival: AdminArrivalState }
  | { ok: false; error: string };

export function parseAdminCardState(value: ViewState | null | undefined): AdminCardStateResult {
  if (value === null || value === undefined) return { ok: true, arrival: {} };
  if (!isRecord(value)) return invalidAdminState();
  const google = value["google"];
  const message = value["message"];
  const reconnect = value["reconnect"];
  if (!(google === undefined || google === "connected" || google === "error")
    || !(message === undefined || typeof message === "string")
    || !(reconnect === undefined || reconnect === "google")) return invalidAdminState();
  return { ok: true, arrival: { ...(google ? { google } : {}), ...(message === undefined ? {} : { message }), ...(reconnect ? { reconnect } : {}) } };
}

export function adminArrivalViewState(search: Record<string, unknown>): ViewState | null {
  const google = search["google"];
  const message = search["message"];
  const reconnect = search["reconnect"];
  const state: AdminArrivalState = {
    ...((google === "connected" || google === "error") ? { google } : {}),
    ...(typeof message === "string" ? { message } : {}),
    ...(reconnect === "google" ? { reconnect } : {}),
  };
  return Object.keys(state).length === 0 ? null : { ...state };
}

export function clearAdminArrivalState(value: ViewState | null | undefined): ViewState {
  if (!value) return {};
  const next = { ...value };
  delete next["google"];
  delete next["message"];
  delete next["reconnect"];
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
