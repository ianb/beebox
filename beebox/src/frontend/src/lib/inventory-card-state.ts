import { isRecord } from "@shared/is-record";
import type { ViewState } from "@shared/view-state";

export interface InventoryCardState {
  projection: "grouped" | "direct";
  metric: "count" | "bytes";
  linkStatus: "all" | "linked" | "unlinked";
}

export const DEFAULT_INVENTORY_CARD_STATE: InventoryCardState = {
  projection: "grouped",
  metric: "count",
  linkStatus: "all",
};

export type InventoryCardStateResult =
  | { ok: true; state: InventoryCardState }
  | { ok: false; error: string };

export function parseInventoryCardState(value: ViewState | null | undefined): InventoryCardStateResult {
  if (value === null || value === undefined) return { ok: true, state: DEFAULT_INVENTORY_CARD_STATE };
  if (!isRecord(value)) return invalidInventoryState();
  const projection = value["projection"] ?? DEFAULT_INVENTORY_CARD_STATE.projection;
  const metric = value["metric"] ?? DEFAULT_INVENTORY_CARD_STATE.metric;
  const linkStatus = value["linkStatus"] ?? DEFAULT_INVENTORY_CARD_STATE.linkStatus;
  if ((projection !== "grouped" && projection !== "direct")
    || (metric !== "count" && metric !== "bytes")
    || (linkStatus !== "all" && linkStatus !== "linked" && linkStatus !== "unlinked")) return invalidInventoryState();
  return { ok: true, state: { projection, metric, linkStatus } };
}

export function inventoryCardViewState(state: InventoryCardState): ViewState {
  return { ...state };
}

function invalidInventoryState(): InventoryCardStateResult {
  return { ok: false, error: "Invalid Storage view state. Reset the controls to continue." };
}
