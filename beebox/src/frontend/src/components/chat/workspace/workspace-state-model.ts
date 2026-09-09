/**
 * Pure state machine for the two card panes and singleton conversation.
 *
 * Path is the tab identity domain: a card can belong to exactly one pane. The
 * desktop and mobile projections deliberately share the tab registry while
 * retaining separate foreground choices.
 */


import { MAX_UNPINNED_TABS, type SidecarTab } from "../sidecar-tabs";
import { PANE_IDS } from "./workspace-state-types.js";
import type { Pane, PaneId, Viewport, WorkspaceAction, WorkspaceProjection, WorkspaceState } from "./workspace-state-types.js";

export { InvalidWorkspaceActionError, NO_WORKSPACE_FOCUS, PANE_IDS } from "./workspace-state-types.js";
export type * from "./workspace-state-types.js";

export function createEmptyWorkspaceState(): WorkspaceState {
  return {
    version: 2,
    tabs: {},
    panes: {
      left: { paths: [], activePath: null, display: "chat" },
      right: { paths: [], activePath: null, display: "chat" },
    },
    layout: { kind: "split" },
    lastCardPane: "left",
    chatAnchor: "right",
    mobileView: { kind: "chat", returnPath: null },
    lastInteraction: { kind: "chat" },
  };
}

export const EMPTY_WORKSPACE_STATE: WorkspaceState = createEmptyWorkspaceState();

export function oppositePane(pane: PaneId): PaneId {
  return pane === "left" ? "right" : "left";
}

export function paneForPath(state: WorkspaceState, path: string): PaneId | null {
  if (state.panes.left.paths.includes(path)) return "left";
  if (state.panes.right.paths.includes(path)) return "right";
  return null;
}

export function orderedWorkspacePaths(paths: readonly string[], tabs: Record<string, SidecarTab>): string[] {
  return [
    ...paths.filter((path) => tabs[path]?.pinned === true),
    ...paths.filter((path) => tabs[path]?.pinned === false),
  ];
}

/** Render order for a pane, or the mobile strip's stable left-then-right union. */
export function workspaceTabPaths(state: WorkspaceState, location: { viewport: Viewport; pane?: PaneId }): string[] {
  const paths = location.viewport === "mobile"
    ? [...state.panes.left.paths, ...state.panes.right.paths]
    : (location.pane === undefined ? [] : state.panes[location.pane].paths);
  return orderedWorkspacePaths(paths, state.tabs);
}

export function retainedRestorePane(state: WorkspaceState): PaneId | null {
  if (state.panes[state.chatAnchor].paths.length > 0) return state.chatAnchor;
  const other = oppositePane(state.chatAnchor);
  return state.panes[other].paths.length > 0 ? other : null;
}

export function mobileRestorePane(state: WorkspaceState): PaneId | null {
  if (state.mobileView.kind === "chat" && state.mobileView.returnPath !== null) {
    const owner = paneForPath(state, state.mobileView.returnPath);
    if (owner !== null) return owner;
  }
  return retainedRestorePane(state);
}

/** Repair snapshots at restore/close boundaries without inventing tabs. */
export function normalizeWorkspaceState(input: WorkspaceState): WorkspaceState {
  const tabs: Record<string, SidecarTab> = {};
  const seen = new Set<string>();
  const panes: Record<PaneId, Pane> = {
    left: { paths: [], activePath: null, display: "chat" },
    right: { paths: [], activePath: null, display: "chat" },
  };

  for (const paneId of PANE_IDS) {
    const source = input.panes[paneId];
    const paths: string[] = [];
    for (const path of source.paths) {
      const tab = input.tabs[path];
      if (tab === undefined || tab.target.path !== path || seen.has(path)) continue;
      seen.add(path);
      tabs[path] = tab;
      paths.push(path);
    }
    const ordered = orderedWorkspacePaths(paths, tabs);
    const activePath = source.activePath !== null && ordered.includes(source.activePath)
      ? source.activePath
      : (ordered.at(-1) ?? null);
    panes[paneId] = {
      paths: ordered,
      activePath,
      display: ordered.length === 0 ? "chat" : source.display,
    };
  }

  let layout = input.layout;
  if (layout.kind === "focus" && panes[layout.pane].display !== "cards") layout = { kind: "split" };

  const allPaths = [...panes.left.paths, ...panes.right.paths];
  let mobileView = input.mobileView;
  if (mobileView.kind === "card" && !seen.has(mobileView.path)) {
    const fallback = panes[input.lastCardPane].activePath ?? panes[oppositePane(input.lastCardPane)].activePath;
    mobileView = fallback === null ? { kind: "chat", returnPath: null } : { kind: "card", path: fallback };
  } else if (mobileView.kind === "chat" && mobileView.returnPath !== null && !seen.has(mobileView.returnPath)) {
    mobileView = { kind: "chat", returnPath: null };
  }
  const lastInteraction = input.lastInteraction.kind === "card" && !seen.has(input.lastInteraction.path)
    ? { kind: "chat" as const }
    : input.lastInteraction;

  return { ...input, version: 2, tabs, panes, layout, mobileView, lastInteraction,
    lastCardPane: allPaths.length === 0 ? "left" : input.lastCardPane };
}

export function evictWorkspaceToCap(input: WorkspaceState): WorkspaceState {
  let state = input;
  const unpinned = Object.values(state.tabs).filter((tab) => !tab.pinned);
  if (unpinned.length <= MAX_UNPINNED_TABS) return state;
  const protectedPaths = new Set(PANE_IDS.flatMap((pane) => state.panes[pane].activePath ?? []));
  const candidates = unpinned
    .filter((tab) => !protectedPaths.has(tab.target.path))
    .toSorted((a, b) => a.lastActiveAt - b.lastActiveAt);
  const doomed = candidates.slice(0, unpinned.length - MAX_UNPINNED_TABS);
  for (const tab of doomed) state = removeWorkspacePath(state, tab.target.path);
  return state;
}

export function removeWorkspacePath(state: WorkspaceState, path: string): WorkspaceState {
  const owner = paneForPath(state, path);
  if (owner === null) return state;
  const pane = state.panes[owner];
  const index = pane.paths.indexOf(path);
  const paths = pane.paths.filter((candidate) => candidate !== path);
  const activePath = pane.activePath === path
    ? (paths[Math.min(index, paths.length - 1)] ?? null)
    : pane.activePath;
  const tabs = { ...state.tabs };
  delete tabs[path];
  return {
    ...state,
    tabs,
    panes: { ...state.panes, [owner]: {
      ...pane,
      paths,
      activePath,
      display: paths.length === 0 ? "chat" : pane.display,
    } },
  };
}

export function moveWorkspacePath(state: WorkspaceState, move: { path: string; destination: PaneId }): WorkspaceState {
  const { path, destination } = move;
  const owner = paneForPath(state, path);
  if (owner === null || owner === destination) return state;
  const source = state.panes[owner];
  const sourceIndex = source.paths.indexOf(path);
  const sourcePaths = source.paths.filter((candidate) => candidate !== path);
  const destinationPane = state.panes[destination];
  return {
    ...state,
    panes: {
      ...state.panes,
      [owner]: {
        ...source,
        paths: sourcePaths,
        activePath: source.activePath === path
          ? (sourcePaths[Math.min(sourceIndex, sourcePaths.length - 1)] ?? null)
          : source.activePath,
        display: sourcePaths.length === 0 ? "chat" : source.display,
      },
      [destination]: {
        ...destinationPane,
        paths: orderedWorkspacePaths([...destinationPane.paths, path], state.tabs),
        activePath: path,
        display: "cards",
      },
    },
  };
}

export function openWorkspaceDestination(state: WorkspaceState, action: Extract<WorkspaceAction, { type: "openCard" }>): PaneId {
  const existing = paneForPath(state, action.target.path);
  if (action.viewport === "mobile") {
    if (state.mobileView.kind === "chat") return oppositePane(state.chatAnchor);
    return existing ?? paneForPath(state, state.mobileView.path) ?? state.lastCardPane;
  }
  if (state.layout.kind === "focus") return existing ?? state.layout.pane;
  const projection = projectWorkspace(state, "desktop");
  if (projection.transcript === "full") return oppositePane(state.chatAnchor);
  if (projection.transcript === "left" || projection.transcript === "right") return oppositePane(projection.transcript);
  return existing ?? action.originatingPane ?? state.lastCardPane;
}

export function activateWorkspacePath(state: WorkspaceState, activation: { path: string; at: number }): WorkspaceState {
  const { path, at } = activation;
  const owner = paneForPath(state, path);
  if (owner === null) return state;
  const tab = state.tabs[path];
  if (tab === undefined) return state;
  return {
    ...state,
    tabs: { ...state.tabs, [path]: { ...tab, lastActiveAt: at } },
    panes: { ...state.panes, [owner]: { ...state.panes[owner], activePath: path, display: "cards" } },
    lastCardPane: owner,
    lastInteraction: { kind: "card", path },
  };
}

export function projectWorkspace(state: WorkspaceState, viewport: Viewport): WorkspaceProjection {
  if (viewport === "mobile") {
    if (state.mobileView.kind === "chat") {
      return { visiblePanes: [], visiblePaths: {}, transcript: "full", foregroundPath: null,
        restorePane: mobileRestorePane(state) };
    }
    const owner = paneForPath(state, state.mobileView.path);
    if (owner === null) return { visiblePanes: [], visiblePaths: {}, transcript: "full", foregroundPath: null,
      restorePane: retainedRestorePane(state) };
    return {
      visiblePanes: [{ pane: owner, path: state.mobileView.path }],
      visiblePaths: { [owner]: state.mobileView.path },
      transcript: null,
      foregroundPath: state.mobileView.path,
      restorePane: null,
    };
  }
  if (state.layout.kind === "focus") {
    const path = state.panes[state.layout.pane].activePath;
    const visiblePanes = path === null ? [] : [{ pane: state.layout.pane, path }];
    return { visiblePanes, visiblePaths: path === null ? {} : { [state.layout.pane]: path },
      transcript: null, foregroundPath: path, restorePane: null };
  }
  const cardPanes = PANE_IDS.filter((pane) => state.panes[pane].display === "cards" && state.panes[pane].activePath !== null);
  if (cardPanes.length === 0) {
    return { visiblePanes: [], visiblePaths: {}, transcript: "full", foregroundPath: null,
      restorePane: retainedRestorePane(state) };
  }
  const visiblePanes = cardPanes.flatMap((pane) => {
    const path = state.panes[pane].activePath;
    return path === null ? [] : [{ pane, path }];
  });
  const visiblePaths = Object.fromEntries(visiblePanes.map(({ pane, path }) => [pane, path]));
  const chatPane = PANE_IDS.find((pane) => state.panes[pane].display === "chat") ?? null;
  const restorePane = chatPane !== null && state.panes[chatPane].paths.length > 0 ? chatPane : null;
  const interactedPath = state.lastInteraction.kind === "card" ? state.lastInteraction.path : null;
  const foregroundPath = interactedPath !== null && visiblePanes.some(({ path }) => path === interactedPath)
    ? interactedPath
    : (state.panes[state.lastCardPane].display === "cards" ? state.panes[state.lastCardPane].activePath : null)
      ?? visiblePanes.at(-1)?.path ?? null;
  return { visiblePanes, visiblePaths, transcript: chatPane, foregroundPath, restorePane };
}
