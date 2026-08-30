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
  // These are execution-journal evidence, not state-exclusive payload fields:
  // a partial record may retain both the before-image and attempted target for
  // diagnosis. A discriminated union would either duplicate those fields or
  // incorrectly discard useful recovery context during a transition.
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
  const arranged = proposal.windows.flatMap((window) => window.tabs);
  const closed = new Set(proposal.close);
  if (new Set(proposal.windows.map((window) => window.id)).size !== proposal.windows.length) {
    return "The proposal repeats a window ID.";
  }
  if (proposal.windows.some((window) => window.tabs.length === 0)) {
    return "The proposal contains an empty window.";
  }
  if (new Set(arranged).size !== arranged.length) {
    return "Every captured tab must appear in exactly one proposed window.";
  }
  if (proposal.close.length !== closed.size) return "The proposal repeats a deleted tab.";
  if (arranged.some((id) => !known.has(id)) || proposal.close.some((id) => !known.has(id))) {
    return "The proposal contains a tab that was not captured.";
  }

  const arrangedSet = new Set(arranged);
  const annotated = arranged.length === known.size && [...known].every((id) => arrangedSet.has(id));
  const legacy = arranged.length + proposal.close.length === known.size
    && proposal.close.every((id) => !arrangedSet.has(id));
  if (!annotated && !legacy) {
    return "Every captured tab must appear in exactly one proposed window; deleted tabs must also be marked in close.";
  }
  if (annotated && proposal.close.some((id) => !arrangedSet.has(id))) {
    return "Every deleted tab must remain in a proposed window.";
  }
  if (proposal.close.length >= known.size) return "At least one tab must remain open.";

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

/** Converts the original partition-style close list into the annotated form. */
export function normalizeProposal(
  payload: TabArrangementPayload,
  proposal: TabArrangementPayload["proposal"],
): TabArrangementPayload["proposal"] {
  const arranged = new Set(proposal.windows.flatMap((window) => window.tabs));
  if (payload.source.windows.every((window) => window.tabs.every((tab) => arranged.has(tab.id)))) {
    return proposal;
  }

  const windows = proposal.windows.map((window) => ({ ...window, tabs: [...window.tabs] }));
  const survivorIds = new Set(windows.flatMap((window) => window.tabs));
  const closed = new Set(proposal.close);
  for (const sourceWindow of payload.source.windows) {
    const sourceIds = sourceWindow.tabs.map((tab) => tab.id);
    for (const id of sourceIds) {
      if (!closed.has(id) || windows.some((window) => window.tabs.includes(id))) continue;
      const target = nearestLegacyWindow({ windows, survivorIds, sourceWindowId: sourceWindow.id, id, sourceIds });
      insertNearSourceNeighbors({ tabs: target.tabs, id, sourceIds });
    }
  }

  const pinned = new Map(
    payload.source.windows.flatMap((window) => window.tabs).map((tab) => [tab.id, tab.pinned]),
  );
  for (const window of windows) {
    window.tabs = [
      ...window.tabs.filter((id) => pinned.get(id) === true),
      ...window.tabs.filter((id) => pinned.get(id) !== true),
    ];
  }
  return { windows, close: [...proposal.close] };
}

function nearestLegacyWindow(options: {
  windows: TabArrangementPayload["proposal"]["windows"];
  survivorIds: Set<string>;
  sourceWindowId: string;
  id: string;
  sourceIds: string[];
}): TabArrangementPayload["proposal"]["windows"][number] {
  const { windows, survivorIds, sourceWindowId, id, sourceIds } = options;
  const sourceIndex = sourceIds.indexOf(id);
  for (let distance = 1; distance < sourceIds.length; distance += 1) {
    const neighbors = [sourceIds[sourceIndex - distance], sourceIds[sourceIndex + distance]];
    const target = windows.find((window) => neighbors.some(
      (neighbor) => neighbor !== undefined && survivorIds.has(neighbor) && window.tabs.includes(neighbor),
    ));
    if (target !== undefined) return target;
  }
  return windows.find((window) => window.id === sourceWindowId)
    ?? addLegacyWindow(windows, sourceWindowId);
}

export function openProposal(
  proposal: TabArrangementPayload["proposal"],
): TabArrangementPayload["proposal"] {
  const closed = new Set(proposal.close);
  return {
    windows: proposal.windows
      .map((window) => ({ ...window, tabs: window.tabs.filter((id) => !closed.has(id)) }))
      .filter((window) => window.tabs.length > 0),
    close: [],
  };
}

function addLegacyWindow(
  windows: TabArrangementPayload["proposal"]["windows"],
  id: string,
): TabArrangementPayload["proposal"]["windows"][number] {
  const window = { id, tabs: [] };
  windows.push(window);
  return window;
}

function insertNearSourceNeighbors(options: { tabs: string[]; id: string; sourceIds: string[] }): void {
  const { tabs, id, sourceIds } = options;
  const sourceIndex = sourceIds.indexOf(id);
  for (let index = sourceIndex - 1; index >= 0; index -= 1) {
    const preceding = tabs.indexOf(sourceIds[index] ?? "");
    if (preceding !== -1) {
      tabs.splice(preceding + 1, 0, id);
      return;
    }
  }
  for (let index = sourceIndex + 1; index < sourceIds.length; index += 1) {
    const following = tabs.indexOf(sourceIds[index] ?? "");
    if (following !== -1) {
      tabs.splice(following, 0, id);
      return;
    }
  }
  tabs.push(id);
}
