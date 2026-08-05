import type { TabArrangementPayload } from "../contract/clerk-contract.generated.js";
import type { StoredTabTransfer } from "../domain/tab-arrangement.js";
import { sourceProposal, validateProposal } from "../domain/tab-arrangement.js";
import type { TabArrangementResult } from "../domain/relay-messages.js";
import { loadTabTransfer, saveTabTransfer } from "./tab-transfer-storage.js";
import {
  compareBeforeClose,
  compareOriginalSnapshot,
  compareProposalSnapshot,
} from "./tab-arrangement-verifier.js";

class VerificationError extends Error {
  constructor(readonly detail: string) {
    super("Tab arrangement verification failed.");
    this.name = "VerificationError";
  }
}
class MissingTabLocationError extends Error { constructor() { super("A tab has no local correlation."); this.name = "MissingTabLocationError"; } }
class EmptyWindowError extends Error { constructor() { super("The proposal contains an empty window."); this.name = "EmptyWindowError"; } }
class WindowCreationError extends Error { constructor() { super("Chrome did not return an ID for a new window."); this.name = "WindowCreationError"; } }
class ReopenError extends Error { constructor() { super("Chrome did not return an ID while reopening a tab."); this.name = "ReopenError"; } }

let mutationInProgress = false;

export async function tabArrangementAction(options: {
  action: "status" | "apply" | "undo";
  transferId: string;
  boxUrl: string;
  proposal?: TabArrangementPayload["proposal"] | undefined;
}): Promise<TabArrangementResult> {
  const transfer = await loadTabTransfer();
  if (transfer === null || transfer.payload.transferId !== options.transferId) {
    return failure("not-found", "Clerk no longer has the browser-side record for this arrangement.");
  }
  if (transfer.boxUrl !== options.boxUrl) {
    return failure("not-enabled", "This arrangement was sent to a different box.");
  }
  if (options.action === "status") {
    if (transfer.state === "applying" && mutationInProgress) {
      return failure("error", "Clerk is still applying this arrangement.");
    }
    if (transfer.state === "applying") {
      const interrupted: StoredTabTransfer = {
        ...transfer,
        state: "partial",
        error: "A prior Apply was interrupted. Inspect Chrome and share again before making another change.",
      };
      await saveTabTransfer(interrupted);
      return statusResult(interrupted);
    }
    return statusResult(transfer);
  }
  if (mutationInProgress) return failure("error", "Another tab arrangement operation is already in progress.");
  mutationInProgress = true;
  try {
    if (options.action === "undo") return await undoArrangement(transfer);
    if (options.proposal === undefined) return failure("invalid", "The card did not provide a proposal.");
    return await applyArrangement(transfer, options.proposal);
  } finally {
    mutationInProgress = false;
  }
}

async function applyArrangement(
  transfer: StoredTabTransfer,
  proposal: TabArrangementPayload["proposal"],
): Promise<TabArrangementResult> {
  if (transfer.state !== "ready") return failure("invalid", "Only a ready, unapplied transfer can be applied.");
  const invalid = validateProposal(transfer.payload, proposal);
  if (invalid !== null) return failure("invalid", invalid);
  const stale = await compareOriginalSnapshot(transfer);
  if (stale !== null) return failure("stale", `Nothing was changed: ${stale}`);

  const beforeApply = sourceProposal(transfer.payload);
  await saveTabTransfer({ ...transfer, state: "applying", beforeApply, appliedProposal: proposal });
  let closesStarted = false;
  try {
    const updatedLocations = await arrangeOpenTabs(transfer, proposal);
    const beforeClose = await compareBeforeClose({ transfer, locations: updatedLocations, proposal });
    if (beforeClose !== null) throw new VerificationError(beforeClose);
    const closeTabIds = proposal.close.map((id) => transfer.locations[id]?.tabId).filter(isNumber);
    if (closeTabIds.length > 0) {
      closesStarted = true;
      await chrome.tabs.remove(closeTabIds);
    }
    const verification = await compareProposalSnapshot({ ...transfer, locations: updatedLocations }, proposal);
    if (verification !== null) throw new VerificationError(verification);
    const applied: StoredTabTransfer = {
      ...transfer,
      locations: updatedLocations,
      state: "applied",
      beforeApply,
      appliedProposal: proposal,
      error: undefined,
    };
    await saveTabTransfer(applied);
    return {
      ok: true,
      state: "applied",
      message: `Applied the arrangement. ${proposal.close.length} tab${proposal.close.length === 1 ? " was" : "s were"} closed.`,
      undoAvailable: true,
    };
  } catch (error) {
    const message = executionErrorMessage(error);
    if (!closesStarted) {
      const rollback = await tryRollback(transfer, beforeApply);
      if (rollback !== null) {
        await saveTabTransfer({
          ...transfer,
          locations: rollback,
          state: "ready",
          beforeApply: undefined,
          appliedProposal: undefined,
          error: undefined,
        });
        return failure("error", `Chrome rejected the arrangement; the captured layout was restored. ${message}`);
      }
    }
    await saveTabTransfer({ ...transfer, state: "partial", beforeApply, appliedProposal: proposal, error: message });
    return { ok: true, state: "partial", message: `Chrome stopped partway through: ${message}`, undoAvailable: false };
  }
}

async function undoArrangement(transfer: StoredTabTransfer): Promise<TabArrangementResult> {
  if (transfer.state !== "applied" || transfer.appliedProposal === undefined) {
    return failure("invalid", "There is no completed arrangement to undo.");
  }
  const mismatch = await compareProposalSnapshot(transfer, transfer.appliedProposal);
  if (mismatch !== null) return failure("stale", `Undo was not attempted: ${mismatch}`);

  const locations = { ...transfer.locations };
  const sourceTabs = new Map(
    transfer.payload.source.windows.flatMap((window) => window.tabs).map((tab) => [tab.id, tab]),
  );
  try {
    for (const id of transfer.appliedProposal.close) {
      const source = sourceTabs.get(id);
      if (source === undefined) continue;
      const oldWindowId = locations[id]?.windowId;
      const canUseOldWindow = oldWindowId !== undefined && await windowExists(oldWindowId);
      const created = await chrome.tabs.create({
        url: source.url,
        active: false,
        pinned: source.pinned,
        ...(canUseOldWindow ? { windowId: oldWindowId } : {}),
      });
      if (created.id === undefined) throw new ReopenError();
      locations[id] = { tabId: created.id, windowId: created.windowId };
    }
    const withReopened = { ...transfer, locations };
    const originalProposal = sourceProposal(transfer.payload);
    const restoredLocations = await arrangeOpenTabs(withReopened, originalProposal);
    const verification = await compareProposalSnapshot({ ...transfer, locations: restoredLocations }, originalProposal);
    if (verification !== null) throw new VerificationError(verification);
    await saveTabTransfer({
      ...transfer,
      locations: restoredLocations,
      state: "ready",
      beforeApply: undefined,
      appliedProposal: undefined,
      error: undefined,
    });
    const reopened = transfer.appliedProposal.close.length;
    return {
      ok: true,
      state: "ready",
      message: reopened === 0
        ? "Restored the captured window layout."
        : `Restored the layout and reopened ${reopened} closed tab${reopened === 1 ? "" : "s"}. Reopened tabs do not retain their back/forward history.`,
      undoAvailable: false,
    };
  } catch (error) {
    const message = executionErrorMessage(error);
    await saveTabTransfer({ ...transfer, locations, state: "partial", error: message });
    return { ok: true, state: "partial", message: `Undo stopped partway through: ${message}`, undoAvailable: false };
  }
}

async function tryRollback(
  transfer: StoredTabTransfer,
  before: TabArrangementPayload["proposal"],
): Promise<StoredTabTransfer["locations"] | null> {
  try {
    const locations = await arrangeOpenTabs(transfer, before);
    const mismatch = await compareOriginalSnapshot({ ...transfer, locations });
    return mismatch === null ? locations : null;
  } catch (_error) {
    return null;
  }
}

async function arrangeOpenTabs(
  transfer: StoredTabTransfer,
  proposal: TabArrangementPayload["proposal"],
): Promise<StoredTabTransfer["locations"]> {
  const locations = { ...transfer.locations };
  const close = new Set(proposal.close);
  const openIds = Object.keys(locations).filter((id) => !close.has(id));
  await Promise.all(openIds.map((id) => chrome.tabs.update(requireLocation(locations, id).tabId, { pinned: false })));

  const originalWindowIds = sourceWindowMap(transfer);
  for (const proposedWindow of proposal.windows) {
    const tabIds = proposedWindow.tabs.map((id) => requireLocation(locations, id).tabId);
    let targetWindowId = originalWindowIds.get(proposedWindow.id);
    if (targetWindowId === undefined || !(await windowExists(targetWindowId))) {
      const first = tabIds[0];
      if (first === undefined) throw new EmptyWindowError();
      const created = await chrome.windows.create({ tabId: first, type: "normal", focused: false });
      if (created?.id === undefined) throw new WindowCreationError();
      targetWindowId = created.id;
      tabIds.shift();
    }
    if (tabIds.length > 0) await chrome.tabs.move(tabIds, { windowId: targetWindowId, index: 0 });
    const ordered = proposedWindow.tabs.map((id) => requireLocation(locations, id).tabId);
    await chrome.tabs.move(ordered, { windowId: targetWindowId, index: 0 });
    for (const id of proposedWindow.tabs) {
      locations[id] = { tabId: requireLocation(locations, id).tabId, windowId: targetWindowId };
    }
  }

  const pinnedById = new Map(
    transfer.payload.source.windows.flatMap((window) => window.tabs).map((tab) => [tab.id, tab.pinned]),
  );
  for (const proposedWindow of proposal.windows) {
    for (const id of proposedWindow.tabs) {
      if (pinnedById.get(id) === true) await chrome.tabs.update(requireLocation(locations, id).tabId, { pinned: true });
    }
  }
  return locations;
}

function sourceWindowMap(transfer: StoredTabTransfer): Map<string, number> {
  const result = new Map<string, number>();
  for (const window of transfer.payload.source.windows) {
    const first = window.tabs[0];
    if (first !== undefined) {
      const windowId = transfer.locations[first.id]?.windowId;
      if (windowId !== undefined) result.set(window.id, windowId);
    }
  }
  return result;
}

async function windowExists(windowId: number): Promise<boolean> {
  try {
    await chrome.windows.get(windowId);
    return true;
  } catch (_error) {
    return false;
  }
}

function isNumber(value: number | undefined): value is number {
  return value !== undefined;
}

function requireLocation(
  locations: StoredTabTransfer["locations"],
  id: string,
): StoredTabTransfer["locations"][string] {
  const location = locations[id];
  if (location === undefined) throw new MissingTabLocationError();
  return location;
}

function executionErrorMessage(error: unknown): string {
  if (error instanceof VerificationError) return `${error.message} ${error.detail}`;
  return error instanceof Error ? error.message : String(error);
}

function failure(reason: "stale" | "invalid" | "not-enabled" | "not-found" | "error", message: string): TabArrangementResult {
  return { ok: false, reason, message };
}

function statusResult(transfer: StoredTabTransfer): TabArrangementResult {
  if (transfer.state === "partial") {
    return { ok: true, state: "partial", message: transfer.error ?? "A previous operation stopped partway through.", undoAvailable: false };
  }
  if (transfer.state === "applied") {
    return { ok: true, state: "applied", message: "This arrangement has been applied.", undoAvailable: true };
  }
  return { ok: true, state: "ready", message: "Clerk is ready to validate and apply this proposal.", undoAvailable: false };
}
