import { isRecord } from "@shared/is-record";
import { conversationSelectionSchema } from "@shared/chat-composer-binding";
import { serializeViewUrl } from "../../../lib/view-url.js";
import type { ViewTarget } from "../../../lib/view-url.js";
import { oppositePane, paneForPath, projectWorkspace, reduceWorkspace, type Viewport, type WorkspaceAction, type WorkspaceState } from "./workspace-state.js";
import { parseWorkspaceState } from "./workspace-storage.js";

export interface WorkspaceHistoryEntry {
  scope: string;
  identity: string;
  snapshot: string;
  revision: number;
  returnRevision?: number;
  returnIndex?: number;
  viewport?: "desktop" | "mobile";
}

export type ScopedWorkspaceHistory =
  | { kind: "snapshot"; entry: WorkspaceHistoryEntry; state: WorkspaceState }
  | { kind: "none" };

export type WorkspaceNavigationDecision =
  | { kind: "restore-snapshot"; entry: WorkspaceHistoryEntry; state: WorkspaceState }
  | { kind: "open-url"; card: string }
  | { kind: "keep-current" };

export interface WorkspaceAdoption {
  from: string;
  to: string;
}

export function explicitConversationHistoryState<T extends object>(state: T): T & {
  bbxConversation: undefined;
  bbxWorkspaceRevealConversation: true;
} {
  return { ...state, bbxConversation: undefined, bbxWorkspaceRevealConversation: true };
}

/** Existing workspace actions needed to reveal chat while retaining a card. */
export function revealConversationActions({ state, cardPath, viewport }: {
  state: WorkspaceState;
  cardPath: string;
  viewport: Viewport;
}): WorkspaceAction[] {
  if (viewport === "mobile") {
    return [{ type: "showChat", pane: paneForPath(state, cardPath) ?? state.lastCardPane, viewport }];
  }
  const actions: WorkspaceAction[] = [];
  let next = state;
  if (next.layout.kind === "focus") {
    const action: WorkspaceAction = { type: "backToSplit", pane: next.layout.pane };
    actions.push(action);
    next = reduceWorkspace(next, action).state;
  }
  if (projectWorkspace(next, "desktop").transcript === null) {
    const owner = paneForPath(next, cardPath) ?? next.lastCardPane;
    actions.push({ type: "showChat", pane: oppositePane(owner), viewport });
  }
  return actions;
}

/** Keep an explicitly retained card in the URL while mobile shows only chat. */
export function workspaceHistoryTarget({ state, viewport, retainedTarget }: {
  state: WorkspaceState;
  viewport: Viewport;
  retainedTarget?: ViewTarget;
}): ViewTarget | null {
  const foreground = projectWorkspace(state, viewport).foregroundPath;
  return (foreground === null ? undefined : state.tabs[foreground]?.target) ?? retainedTarget ?? null;
}

/** Keep content visible only for the exact identity handoff being adopted. */
export function workspaceDisplayReady(input: {
  renderedIdentity: string;
  storedIdentity: string;
  adoption: WorkspaceAdoption | null;
}): boolean {
  if (input.renderedIdentity === "" || input.storedIdentity === "") return false;
  if (input.renderedIdentity === input.storedIdentity) return true;
  if (input.adoption === null) return false;
  return (input.adoption.from === input.renderedIdentity && input.adoption.to === input.storedIdentity)
    || (input.adoption.to === input.renderedIdentity && input.adoption.from === input.storedIdentity);
}

/** The workspace may act only after the route owner publishes this identity. */
export function workspaceRouteBound(selection: unknown, identity: string): boolean {
  if (identity === "") return false;
  const parsed = conversationSelectionSchema.safeParse(selection);
  if (!parsed.success || parsed.data.kind !== "ready") return false;
  const target = parsed.data.target;
  const routeIdentity = target.kind === "session" ? target.sessionId : target.clientConversationId;
  return routeIdentity === identity;
}

function visibleWorkspaceFingerprint(state: WorkspaceState, viewport: Viewport): string {
  const projection = projectWorkspace(state, viewport);
  const target = projection.foregroundPath === null ? null : state.tabs[projection.foregroundPath]?.target;
  return JSON.stringify({
    layout: state.layout,
    displays: { left: state.panes.left.display, right: state.panes.right.display },
    mobileView: viewport === "mobile" ? state.mobileView : null,
    visiblePaths: projection.visiblePaths,
    transcript: projection.transcript,
    target: target === null || target === undefined ? null : serializeViewUrl(target),
  });
}

/** Reopening an unchanged foreground presentation replaces its history entry. */
export function workspaceOpenShouldReplace(input: {
  before: WorkspaceState;
  after: WorkspaceState;
  viewport: Viewport;
}): boolean {
  return visibleWorkspaceFingerprint(input.before, input.viewport) === visibleWorkspaceFingerprint(input.after, input.viewport);
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Parse only snapshots owned by the active worktree scope and conversation. */
export function parseScopedWorkspaceHistory(
  value: unknown,
  owner: { scope: string; identity: string },
): ScopedWorkspaceHistory {
  if (!isRecord(value)) return { kind: "none" };
  const { scope, identity, snapshot, revision, returnRevision, returnIndex } = value;
  if (scope !== owner.scope || identity !== owner.identity || typeof snapshot !== "string" || !isRevision(revision)) {
    return { kind: "none" };
  }
  const hasReturnRevision = returnRevision !== undefined;
  const hasReturnIndex = returnIndex !== undefined;
  if (hasReturnRevision !== hasReturnIndex) return { kind: "none" };
  if (hasReturnRevision && (!isRevision(returnRevision) || !isRevision(returnIndex))) return { kind: "none" };
  const parsed = parseWorkspaceState(snapshot);
  if (parsed.source !== "v2") return { kind: "none" };
  const entry: WorkspaceHistoryEntry = hasReturnRevision && isRevision(returnRevision) && isRevision(returnIndex)
    ? { scope, identity, snapshot, revision, returnRevision, returnIndex }
    : { scope, identity, snapshot, revision };
  if (value["viewport"] === "desktop" || value["viewport"] === "mobile") entry.viewport = value["viewport"];
  return { kind: "snapshot", entry, state: parsed.state };
}

/** A restored entry wins; otherwise a card URL is a fresh open intent. */
export function decideWorkspaceNavigation(input: {
  history: unknown;
  scope: string;
  identity: string;
  freshCard: string | null;
  /** Canonical card routes are open intents; only /chat projects saved arrangements. */
  cardEntry?: boolean;
}): WorkspaceNavigationDecision {
  if (input.cardEntry && input.freshCard) return { kind: "open-url", card: input.freshCard };
  const parsed = parseScopedWorkspaceHistory(input.history, input);
  if (parsed.kind === "snapshot") return { kind: "restore-snapshot", entry: parsed.entry, state: parsed.state };
  if (input.freshCard !== null && input.freshCard !== "") return { kind: "open-url", card: input.freshCard };
  return { kind: "keep-current" };
}

/**
 * Back is safe only on the show-conversation entry created immediately after
 * its recorded card entry. Any later replace/push must restore cards in place.
 */
export function shouldRestoreMobileWithBack(
  entry: WorkspaceHistoryEntry | undefined,
  currentIndex: number | undefined,
): boolean {
  if (entry?.returnRevision === undefined || entry.returnIndex === undefined) return false;
  if (!isRevision(currentIndex)) return false;
  return entry.returnIndex === currentIndex - 1 && entry.returnRevision === entry.revision - 1;
}
