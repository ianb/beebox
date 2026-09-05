import type { TabArrangementPayload } from "../contract/clerk-contract.generated.js";
import type { TabLocation } from "../domain/tab-arrangement.js";
import { sourceProposal } from "../domain/tab-arrangement.js";

const UNGROUPED = -1;

class NoWindowError extends Error { constructor() { super("No normal, non-incognito window was available to share."); this.name = "NoWindowError"; } }
class WindowIdentityError extends Error { constructor() { super("Chrome returned a window without an ID."); this.name = "WindowIdentityError"; } }
class GroupedTabError extends Error { constructor() { super("This selection contains a grouped tab. Ungroup the tabs before sharing this experimental version."); this.name = "GroupedTabError"; } }
class TabIdentityError extends Error { constructor() { super("Chrome returned a tab that could not be identified."); this.name = "TabIdentityError"; } }
class NoTabsError extends Error { constructor() { super("There were no tabs to share."); this.name = "NoTabsError"; } }

export async function captureTabs(
  scope: TabArrangementPayload["scope"],
  sourceWindowId: number,
): Promise<{ payload: TabArrangementPayload; locations: Record<string, TabLocation> }> {
  const all = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const selected = scope === "all-windows"
    ? all.filter((window) => window.incognito !== true)
    : all.filter((window) => window.id === sourceWindowId && window.incognito !== true);
  if (selected.length === 0) throw new NoWindowError();

  const locations: Record<string, TabLocation> = {};
  const windows: TabArrangementPayload["source"]["windows"] = [];
  for (const window of selected) {
    if (window.id === undefined) throw new WindowIdentityError();
    const tabs = window.tabs ?? [];
    if (tabs.some((tab) => tab.groupId !== UNGROUPED)) {
      throw new GroupedTabError();
    }
    const windowUuid = crypto.randomUUID();
    const capturedTabs: TabArrangementPayload["source"]["windows"][number]["tabs"] = [];
    for (const tab of tabs) {
      const url = tab.pendingUrl ?? tab.url;
      if (tab.id === undefined || url === undefined) {
        throw new TabIdentityError();
      }
      const id = crypto.randomUUID();
      capturedTabs.push({ id, title: tab.title ?? url, url, pinned: tab.pinned });
      locations[id] = { tabId: tab.id, windowId: window.id };
    }
    if (capturedTabs.length > 0) windows.push({ id: windowUuid, tabs: capturedTabs });
  }
  if (windows.length === 0) throw new NoTabsError();

  const payload: TabArrangementPayload = {
    transferId: crypto.randomUUID(),
    scope,
    capturedAt: new Date().toISOString(),
    source: { windows },
    proposal: { windows: [], close: [] },
  };
  payload.proposal = sourceProposal(payload);
  return { payload, locations };
}
