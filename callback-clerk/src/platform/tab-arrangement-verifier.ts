import type { TabArrangementPayload } from "../contract/clerk-contract.generated.js";
import type { StoredTabTransfer } from "../domain/tab-arrangement.js";
import { openProposal } from "../domain/tab-arrangement.js";

const UNGROUPED = -1;

export async function compareOriginalSnapshot(transfer: StoredTabTransfer): Promise<string | null> {
  for (const sourceWindow of transfer.payload.source.windows) {
    const first = sourceWindow.tabs.at(0);
    if (first === undefined) return "the capture contains an empty window";
    const windowId = transfer.locations[first.id]?.windowId;
    if (windowId === undefined) return "a captured tab has no local correlation";
    const live = await tabsInWindow(windowId);
    if (live === null) return "a captured window no longer exists";
    if (live.length !== sourceWindow.tabs.length) return "a captured window has gained or lost a tab";
    for (let index = 0; index < sourceWindow.tabs.length; index += 1) {
      const expected = sourceWindow.tabs.at(index);
      const actual = live.at(index);
      if (expected === undefined || actual === undefined) return "a captured window changed length";
      if (transfer.locations[expected.id]?.tabId !== actual.id) return "tab order or membership changed";
      const changed = tabMetadataMismatch(expected, actual);
      if (changed !== null) return changed;
    }
  }
  if (transfer.payload.scope === "all-windows") {
    const live = await normalWindows();
    if (live.length !== transfer.payload.source.windows.length) return "the set of normal windows changed";
  }
  return null;
}

export async function compareProposalSnapshot(
  transfer: StoredTabTransfer,
  proposal: TabArrangementPayload["proposal"],
): Promise<string | null> {
  const expectedProposal = openProposal(proposal);
  for (const proposedWindow of expectedProposal.windows) {
    const first = proposedWindow.tabs.at(0);
    if (first === undefined) return "the proposal contains an empty window";
    const windowId = transfer.locations[first]?.windowId;
    if (windowId === undefined) return "a proposed tab has no local correlation";
    const live = await tabsInWindow(windowId);
    if (live === null || live.length !== proposedWindow.tabs.length) return "a target window gained or lost a tab";
    for (let index = 0; index < proposedWindow.tabs.length; index += 1) {
      const uuid = proposedWindow.tabs.at(index);
      const actual = live.at(index);
      const source = uuid === undefined ? undefined : sourceTab(transfer, uuid);
      if (uuid === undefined || source === undefined || actual === undefined) return "an arranged tab could not be correlated";
      if (actual.id !== transfer.locations[uuid]?.tabId) return "the arranged tabs changed order or membership";
      const changed = tabMetadataMismatch(source, actual);
      if (changed !== null) return changed;
    }
  }
  if (transfer.payload.scope === "all-windows" && (await normalWindows()).length !== expectedProposal.windows.length) {
    return "the set of normal windows changed";
  }
  return null;
}

export async function compareClosedTabs(
  locations: StoredTabTransfer["locations"],
  proposal: TabArrangementPayload["proposal"],
): Promise<string | null> {
  const liveTabIds = new Set((await chrome.tabs.query({})).map((tab) => tab.id));
  for (const id of proposal.close) {
    const tabId = locations[id]?.tabId;
    if (tabId === undefined) return "a deleted tab has no local correlation";
    if (liveTabIds.has(tabId)) return "a deleted tab remained open";
  }
  return null;
}

export async function compareBeforeClose(options: {
  transfer: StoredTabTransfer;
  locations: StoredTabTransfer["locations"];
  proposal: TabArrangementPayload["proposal"];
}): Promise<string | null> {
  const { locations, proposal } = options;
  const knownTabIds = new Set(Object.values(locations).map((location) => location.tabId));
  const affectedWindowIds = new Set(Object.values(locations).map((location) => location.windowId));
  for (const windowId of affectedWindowIds) {
    const live = await tabsInWindow(windowId);
    if (live === null) return "an affected window disappeared before closes";
    if (live.some((tab) => tab.id === undefined || !knownTabIds.has(tab.id))) {
      return "an unknown tab appeared before closes; no tabs were closed";
    }
  }
  for (const window of proposal.windows) {
    const first = window.tabs.at(0);
    const targetWindowId = first === undefined ? undefined : locations[first]?.windowId;
    if (targetWindowId === undefined) return "a proposed tab has no local correlation";
    const live = await tabsInWindow(targetWindowId);
    if (live === null) return "a target window disappeared before closes";
    const expected = window.tabs.map((id) => locations[id]?.tabId);
    if (live.length !== expected.length || live.some((tab, index) => tab.id !== expected[index])) {
      return "the reversible layout did not verify before closes";
    }
  }
  return null;
}

function tabMetadataMismatch(
  source: TabArrangementPayload["source"]["windows"][number]["tabs"][number],
  actual: chrome.tabs.Tab,
): string | null {
  if ((actual.pendingUrl ?? actual.url) !== source.url) return `the URL changed for “${source.title}”`;
  if (actual.pinned !== source.pinned) return `pinning changed for “${source.title}”`;
  if (actual.groupId !== UNGROUPED) return `“${source.title}” is now grouped`;
  return null;
}

function sourceTab(
  transfer: StoredTabTransfer,
  id: string,
): TabArrangementPayload["source"]["windows"][number]["tabs"][number] | undefined {
  return transfer.payload.source.windows.flatMap((window) => window.tabs).find((tab) => tab.id === id);
}

async function tabsInWindow(windowId: number): Promise<chrome.tabs.Tab[] | null> {
  try {
    return await chrome.tabs.query({ windowId });
  } catch (_error) {
    return null;
  }
}

async function normalWindows(): Promise<chrome.windows.Window[]> {
  return (await chrome.windows.getAll({ windowTypes: ["normal"] })).filter((window) => window.incognito !== true);
}
