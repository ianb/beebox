import type { TabArrangementPayload } from "../contract/clerk-contract.generated.js";

export interface TabLocation {
  tabId: number;
  windowId: number;
}

export interface StoredTabTransfer {
  version: 1;
  browserSessionId: string;
  boxUrl: string;
  openUrl: string;
  payload: TabArrangementPayload;
  locations: Record<string, TabLocation>;
  state: "ready" | "applying" | "applied" | "partial";
  beforeApply?: TabArrangementPayload["proposal"] | undefined;
  appliedProposal?: TabArrangementPayload["proposal"] | undefined;
  error?: string | undefined;
}

export function sourceProposal(payload: TabArrangementPayload): TabArrangementPayload["proposal"] {
  return {
    windows: payload.source.windows.map((window) => ({
      id: window.id,
      tabs: window.tabs.map((tab) => tab.id),
    })),
    close: [],
  };
}

export function validateProposal(
  payload: TabArrangementPayload,
  proposal: TabArrangementPayload["proposal"],
): string | null {
  const sourceTabs = payload.source.windows.flatMap((window) => window.tabs);
  const known = new Set(sourceTabs.map((tab) => tab.id));
  const proposed = [...proposal.windows.flatMap((window) => window.tabs), ...proposal.close];
  if (new Set(proposal.windows.map((window) => window.id)).size !== proposal.windows.length) {
    return "The proposal repeats a window ID.";
  }
  if (proposal.windows.some((window) => window.tabs.length === 0)) {
    return "The proposal contains an empty window.";
  }
  if (proposed.length !== known.size || new Set(proposed).size !== proposed.length) {
    return "Every captured tab must appear exactly once.";
  }
  if (proposed.some((id) => !known.has(id))) return "The proposal contains a tab that was not captured.";

  const pinned = new Map(sourceTabs.map((tab) => [tab.id, tab.pinned]));
  for (const window of proposal.windows) {
    let sawUnpinned = false;
    for (const id of window.tabs) {
      if (pinned.get(id) === false) sawUnpinned = true;
      if (pinned.get(id) === true && sawUnpinned) return "Pinned tabs must precede unpinned tabs.";
    }
  }
  return null;
}
