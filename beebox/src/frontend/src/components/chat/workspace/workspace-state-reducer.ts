import { serializeViewUrl } from "../../../lib/view-url";
import type { SidecarTab } from "../sidecar-tabs";
import {
  activateWorkspacePath, evictWorkspaceToCap, InvalidWorkspaceActionError,
  mobileRestorePane, moveWorkspacePath, normalizeWorkspaceState, NO_WORKSPACE_FOCUS,
  openWorkspaceDestination, oppositePane, orderedWorkspacePaths, paneForPath,
  PANE_IDS, projectWorkspace, removeWorkspacePath, retainedRestorePane,
} from "./workspace-state-model.js";
import type { Pane, WorkspaceAction, WorkspaceState, WorkspaceTransition } from "./workspace-state-types.js";

type Action<Type extends WorkspaceAction["type"]> = Extract<WorkspaceAction, { type: Type }>;

function openCard(state: WorkspaceState, action: Action<"openCard">): WorkspaceTransition {
  const destination = openWorkspaceDestination(state, action);
  const existing = state.tabs[action.target.path];
  let next = state;
  if (existing === undefined) {
    const tab: SidecarTab = { target: action.target, label: action.label, pinned: false, lastActiveAt: action.at };
    const tabs = { ...next.tabs, [action.target.path]: tab };
    next = { ...next, tabs, panes: { ...next.panes, [destination]: { ...next.panes[destination],
      paths: orderedWorkspacePaths([...next.panes[destination].paths, action.target.path], tabs) } } };
  } else {
    const explicitView = action.target.viewer !== null || action.target.viewState !== null || Object.keys(action.target.params).length > 0;
    if (explicitView && serializeViewUrl(existing.target) !== serializeViewUrl(action.target)) {
      next = { ...next, tabs: { ...next.tabs,
        [action.target.path]: { ...existing, target: action.target, label: action.label } } };
    }
    next = moveWorkspacePath(next, { path: action.target.path, destination });
  }
  next = activateWorkspacePath(next, { path: action.target.path, at: action.at });
  if (action.viewport === "desktop") {
    next = { ...next, layout: state.layout.kind === "focus"
      ? { kind: "focus", pane: destination } : { kind: "split" } };
  } else next = { ...next, mobileView: { kind: "card", path: action.target.path } };
  next = normalizeWorkspaceState(evictWorkspaceToCap(next));
  return { state: next, effect: { kind: "card-panel", pane: destination, path: action.target.path } };
}

function selectTab(state: WorkspaceState, action: Action<"selectTab">): WorkspaceTransition {
  const owner = paneForPath(state, action.path);
  if (owner === null) return { state, effect: NO_WORKSPACE_FOCUS };
  let next = activateWorkspacePath(state, { path: action.path, at: action.at });
  if (action.viewport === "mobile") next = { ...next, mobileView: { kind: "card", path: action.path } };
  return { state: next, effect: { kind: "tab", pane: owner, path: action.path } };
}

interface PathReplacement {
  from: string;
  to: string;
}

function retargetPane(pane: Pane, replacement: PathReplacement): Pane {
  return {
    ...pane,
    paths: [...new Set(pane.paths.map(path => path === replacement.from ? replacement.to : path))],
    activePath: pane.activePath === replacement.from ? replacement.to : pane.activePath,
  };
}

function retargetCard(state: WorkspaceState, action: Action<"retargetCard">): WorkspaceTransition {
  const tab = state.tabs[action.fromPath];
  const owner = paneForPath(state, action.fromPath);
  if (tab === undefined || owner === null) return { state, effect: NO_WORKSPACE_FOCUS };
  const tabs = { ...state.tabs };
  delete tabs[action.fromPath];
  tabs[action.target.path] = { ...tab, target: action.target };
  const replacement = { from: action.fromPath, to: action.target.path };
  const panes = {
    left: retargetPane(state.panes.left, replacement),
    right: retargetPane(state.panes.right, replacement),
  };
  const mobileView = state.mobileView.kind === "card" && state.mobileView.path === action.fromPath
    ? { kind: "card" as const, path: action.target.path }
    : state.mobileView.kind === "chat" && state.mobileView.returnPath === action.fromPath
      ? { kind: "chat" as const, returnPath: action.target.path }
      : state.mobileView;
  const lastInteraction = state.lastInteraction.kind === "card" && state.lastInteraction.path === action.fromPath
    ? { kind: "card" as const, path: action.target.path }
    : state.lastInteraction;
  const next = normalizeWorkspaceState({ ...state, tabs, panes, mobileView, lastInteraction });
  return { state: next, effect: { kind: "card-panel", pane: owner, path: action.target.path } };
}

function closeTab(state: WorkspaceState, action: Action<"closeTab">): WorkspaceTransition {
  if (paneForPath(state, action.path) === null) return { state, effect: NO_WORKSPACE_FOCUS };
  const next = normalizeWorkspaceState(removeWorkspacePath(state, action.path));
  const path = projectWorkspace(next, action.viewport).foregroundPath;
  const pane = path === null ? null : paneForPath(next, path);
  return { state: next, effect: path === null || pane === null
    ? NO_WORKSPACE_FOCUS : { kind: "tab", pane, path } };
}

function togglePin(state: WorkspaceState, action: Action<"togglePin">): WorkspaceTransition {
  const tab = state.tabs[action.path];
  if (tab === undefined) return { state, effect: NO_WORKSPACE_FOCUS };
  const tabs = { ...state.tabs, [action.path]: { ...tab, pinned: !tab.pinned, lastActiveAt: action.at } };
  const panes = { ...state.panes };
  for (const pane of PANE_IDS) panes[pane] = { ...panes[pane], paths: orderedWorkspacePaths(panes[pane].paths, tabs) };
  return { state: normalizeWorkspaceState(evictWorkspaceToCap({ ...state, tabs, panes })), effect: NO_WORKSPACE_FOCUS };
}

function moveActive(state: WorkspaceState, action: Action<"moveActive">): WorkspaceTransition {
  const path = state.panes[action.pane].activePath;
  if (path === null) throw new InvalidWorkspaceActionError();
  const destination = oppositePane(action.pane);
  const next = normalizeWorkspaceState({ ...moveWorkspacePath(state, { path, destination }), lastCardPane: destination, lastInteraction: { kind: "card", path } });
  return { state: next, effect: { kind: "tab", pane: destination, path } };
}

function showChat(state: WorkspaceState, action: Action<"showChat">): WorkspaceTransition {
  if (action.viewport === "mobile") {
    const returnPath = state.mobileView.kind === "card" ? state.mobileView.path : state.mobileView.returnPath;
    return { state: { ...state, mobileView: { kind: "chat", returnPath }, lastInteraction: { kind: "chat" } },
      effect: { kind: "conversation", pane: "full" } };
  }
  if (state.layout.kind === "focus") throw new InvalidWorkspaceActionError();
  const next = { ...state, panes: { ...state.panes,
    [action.pane]: { ...state.panes[action.pane], display: "chat" as const } },
  chatAnchor: action.pane, lastInteraction: { kind: "chat" as const } };
  return { state: next, effect: { kind: "conversation",
    pane: projectWorkspace(next, "desktop").transcript ?? action.pane } };
}

function restoreCards(state: WorkspaceState, action: Action<"restoreCards">): WorkspaceTransition {
  const pane = action.pane ?? (action.viewport === "mobile" ? mobileRestorePane(state) : retainedRestorePane(state));
  if (pane === null) return { state, effect: NO_WORKSPACE_FOCUS };
  const path = state.panes[pane].activePath;
  if (path === null) return { state, effect: NO_WORKSPACE_FOCUS };
  if (action.viewport === "mobile") {
    return { state: { ...state, mobileView: { kind: "card", path }, lastInteraction: { kind: "card", path } },
      effect: { kind: "card-panel", pane, path } };
  }
  const next = { ...state, layout: { kind: "split" as const }, panes: { ...state.panes,
    [pane]: { ...state.panes[pane], display: "cards" as const } },
  lastCardPane: pane, lastInteraction: { kind: "card" as const, path } };
  return { state: next, effect: { kind: "card-panel", pane, path } };
}

function setViewport(state: WorkspaceState, action: Action<"setViewport">): WorkspaceTransition {
  const next = normalizeWorkspaceState(state);
  if (action.viewport === "desktop") return { state: next, effect: NO_WORKSPACE_FOCUS };
  if (next.lastInteraction.kind === "card" && paneForPath(next, next.lastInteraction.path) !== null) {
    return { state: { ...next, mobileView: { kind: "card", path: next.lastInteraction.path } }, effect: NO_WORKSPACE_FOCUS };
  }
  const returnPath = next.mobileView.kind === "card" ? next.mobileView.path : next.mobileView.returnPath;
  return { state: { ...next, mobileView: { kind: "chat", returnPath } }, effect: NO_WORKSPACE_FOCUS };
}

function restoreSnapshot(action: Action<"restoreSnapshot">): WorkspaceTransition {
  const state = normalizeWorkspaceState(action.state);
  const projection = projectWorkspace(state, action.viewport);
  const path = projection.foregroundPath;
  const pane = path === null ? null : paneForPath(state, path);
  if (path !== null && pane !== null) return { state, effect: { kind: "card-panel", pane, path } };
  return { state, effect: { kind: "conversation", pane: projection.transcript ?? "full" } };
}

export function reduceWorkspace(state: WorkspaceState, action: WorkspaceAction): WorkspaceTransition {
  switch (action.type) {
    case "openCard": return openCard(state, action);
    case "retargetCard": return retargetCard(state, action);
    case "selectTab": return selectTab(state, action);
    case "closeTab": return closeTab(state, action);
    case "togglePin": return togglePin(state, action);
    case "moveActive": return moveActive(state, action);
    case "focusPane": {
      const pane = state.panes[action.pane];
      if (pane.display !== "cards" || pane.activePath === null) throw new InvalidWorkspaceActionError();
      return { state: { ...state, layout: { kind: "focus", pane: action.pane }, lastCardPane: action.pane, lastInteraction: { kind: "card", path: pane.activePath } },
        effect: { kind: "card-panel", pane: action.pane, path: pane.activePath } };
    }
    case "backToSplit": return { state: { ...state, layout: { kind: "split" } },
      effect: { kind: "pane-control", pane: action.pane } };
    case "showChat": return showChat(state, action);
    case "restoreCards": return restoreCards(state, action);
    case "setViewport": return setViewport(state, action);
    case "restoreSnapshot": return restoreSnapshot(action);
  }
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  return reduceWorkspace(state, action).state;
}
