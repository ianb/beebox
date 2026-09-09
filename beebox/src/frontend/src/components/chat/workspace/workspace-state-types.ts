import type { SidecarTab } from "../sidecar-tabs";

export type PaneId = "left" | "right";
export type Viewport = "desktop" | "mobile";
export type PaneDisplay = "cards" | "chat";

export interface Pane {
  paths: string[];
  activePath: string | null;
  display: PaneDisplay;
}

export type WorkspaceLayout = { kind: "split" } | { kind: "focus"; pane: PaneId };
export type MobileView = { kind: "chat"; returnPath: string | null } | { kind: "card"; path: string };

export interface WorkspaceState {
  version: 2;
  tabs: Record<string, SidecarTab>;
  panes: Record<PaneId, Pane>;
  layout: WorkspaceLayout;
  lastCardPane: PaneId;
  chatAnchor: PaneId;
  mobileView: MobileView;
  lastInteraction: { kind: "chat" } | { kind: "card"; path: string };
}

export type WorkspaceFocusEffect =
  | { kind: "none" }
  | { kind: "card-panel"; pane: PaneId; path: string }
  | { kind: "tab"; pane: PaneId; path: string }
  | { kind: "conversation"; pane: PaneId | "full" }
  | { kind: "pane-control"; pane: PaneId };

export type WorkspaceAction =
  | { type: "openCard"; target: SidecarTab["target"]; label: string; at: number; viewport: Viewport; originatingPane?: PaneId }
  | { type: "selectTab"; path: string; at: number; viewport: Viewport }
  | { type: "closeTab"; path: string; viewport: Viewport }
  | { type: "togglePin"; path: string; at: number }
  | { type: "moveActive"; pane: PaneId }
  | { type: "focusPane"; pane: PaneId }
  | { type: "backToSplit"; pane: PaneId }
  | { type: "showChat"; pane: PaneId; viewport: Viewport }
  | { type: "restoreCards"; viewport: Viewport; pane?: PaneId }
  | { type: "setViewport"; viewport: Viewport }
  | { type: "restoreSnapshot"; state: WorkspaceState; viewport: Viewport };

export interface WorkspaceTransition {
  state: WorkspaceState;
  effect: WorkspaceFocusEffect;
}

export interface VisibleCardPane {
  pane: PaneId;
  path: string;
}

export interface WorkspaceProjection {
  visiblePanes: VisibleCardPane[];
  visiblePaths: Partial<Record<PaneId, string>>;
  transcript: PaneId | "full" | null;
  foregroundPath: string | null;
  restorePane: PaneId | null;
}

export const PANE_IDS: readonly PaneId[] = ["left", "right"];
export const NO_WORKSPACE_FOCUS: WorkspaceFocusEffect = { kind: "none" };

export class InvalidWorkspaceActionError extends Error {
  constructor() {
    super("Workspace action is invalid for the current pane state");
    this.name = "InvalidWorkspaceActionError";
  }
}
