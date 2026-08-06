import type { EnabledBox } from "../domain/config.js";
import type { SharedTabsResult } from "../domain/messages.js";
import { commentaryOpenUrl } from "../domain/commentary.js";
import { captureTabs } from "./tab-capture.js";
import { postTabArrangement } from "./clerk-api.js";
import { browserSessionId, loadTabTransfer, saveTabTransfer } from "./tab-transfer-storage.js";

class MissingTabTransferError extends Error {
  constructor() {
    super("That tab organizer handoff is no longer available in Clerk.");
    this.name = "MissingTabTransferError";
  }
}
class ApplyingTabTransferError extends Error {
  constructor() {
    super("A tab arrangement is still applying. Wait for it to finish before sharing again.");
    this.name = "ApplyingTabTransferError";
  }
}

export async function shareTabs(
  box: EnabledBox,
  options: { scope: "current-window" | "all-windows"; sourceWindowId: number },
): Promise<SharedTabsResult> {
  const existing = await loadTabTransfer();
  if (existing?.state === "applying") throw new ApplyingTabTransferError();
  const captured = await captureTabs(options.scope, options.sourceWindowId);
  const result = await postTabArrangement(box, captured.payload);
  const openUrl = commentaryOpenUrl(box.boxUrl, result.open);
  await saveTabTransfer({
    version: 1,
    browserSessionId: await browserSessionId(),
    boxUrl: box.boxUrl,
    openUrl,
    payload: captured.payload,
    locations: captured.locations,
    state: "ready",
  });
  let organizerOpened = true;
  try {
    await chrome.windows.create({ url: openUrl, type: "popup" });
  } catch (error) {
    organizerOpened = false;
    console.error("[callback-clerk] tabs shared but organizer did not open:", error);
  }
  return {
    kind: "shared-tabs",
    transferId: captured.payload.transferId,
    tabCount: Object.keys(captured.locations).length,
    replacedUndo: existing?.state === "applied",
    organizerOpened,
  };
}

export async function openTabOrganizer(box: EnabledBox, transferId: string): Promise<void> {
  const transfer = await loadTabTransfer();
  if (transfer === null || transfer.payload.transferId !== transferId || transfer.boxUrl !== box.boxUrl) {
    throw new MissingTabTransferError();
  }
  await chrome.windows.create({ url: transfer.openUrl, type: "popup" });
}

export async function latestTransferForBox(box: EnabledBox): Promise<SharedTabsResult | undefined> {
  const transfer = await loadTabTransfer();
  if (transfer === null || transfer.boxUrl !== box.boxUrl || transfer.state !== "ready") return undefined;
  return {
    kind: "shared-tabs",
    transferId: transfer.payload.transferId,
    tabCount: Object.keys(transfer.locations).length,
  };
}
