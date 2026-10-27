import { workspaceRouteTarget, workspaceProjectionSearch } from "../../../../lib/system-card-navigation";
import { browseStateToViewState, normalizeBrowseTarget, parseBrowseState, type BrowseState } from "../../../../lib/browse-card-state";
import { decideWorkspaceNavigation, legacyOverlayActions, revealConversationActions, workspaceDisplayReady, workspaceHistoryTarget, workspaceOpenShouldReplace, workspaceRouteBound, shouldRestoreMobileWithBack, type WorkspaceHistoryEntry, type WorkspaceNavigationDecision } from "../history";
import { createContext, useContext, useEffect, useRef, useMemo, useCallback, useSyncExternalStore, type ReactNode } from "react";
import { useLocation, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { getApiBase } from "../../../../api";
import { href, toSearch } from "../../../../lib/routing";
import { parseViewUrl, serializeViewUrl, type ViewTarget, type NavigateHint } from "../../../../lib/view-url";
import { useMobileChatViewport } from "../../everywhere/use-mobile-card-navigation";
import { projectWorkspace, workspaceTabPaths } from "../state-model.js";
import { reduceWorkspace } from "../state-reducer.js";
import type { WorkspaceAction, PaneId } from "../state-types.js";
import { serializeWorkspaceState } from "../storage";
import { storageScopeFor } from "../../../../lib/storage-scope";
import { createWorkspaceBrowserStore } from "./workspace-browser-store";
import { arrivalPlan, arrivalWaits } from "./arrival";
import { trpc } from "../../../../lib/trpc/client";
import type { ConversationTarget } from "@shared/chat-composer-binding";
import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
import { pickArrivalQuestion, useDismissOnClose } from "../../../questions/question-close";

declare module "@tanstack/history" { interface HistoryState { bbxWorkspace?: WorkspaceHistoryEntry; bbxWorkspaceRevealConversation?: boolean; bbxConversationOverlay?: boolean } }
const Workspace = createContext<ReturnType<typeof useWorkspaceController> | null>(null);
type WorkspaceBrowserStore = ReturnType<typeof createWorkspaceBrowserStore>;
interface BrowseDetailHandoff { source: BrowseState; detail: ViewTarget }

function revealStoredConversation(input: {
  store: WorkspaceBrowserStore;
  incoming: ViewTarget | null;
  viewport: "mobile" | "desktop";
  openIncoming: boolean;
  enabled: boolean;
}) {
  const { store, incoming, viewport } = input;
  if (!input.enabled) return;
  if (input.openIncoming && incoming !== null) {
    store.dispatch({ type: "openCard", target: incoming, label: incoming.path, at: Date.now(), viewport });
  }
  const cardPath = incoming?.path ?? projectWorkspace(store.get(), viewport).foregroundPath;
  if (cardPath === null) return;
  for (const action of revealConversationActions({ state: store.get(), cardPath, viewport })) store.dispatch(action);
}

/**
 * Restores a history entry's snapshot. A snapshot is a saved arrangement, so
 * it also ends a pending arrival. Returns whether the entry must be rewritten.
 */
function restoreHistorySnapshot(input: {
  store: WorkspaceBrowserStore;
  decision: Extract<WorkspaceNavigationDecision, { kind: "restore-snapshot" }>;
  viewport: "mobile" | "desktop";
  incoming: ViewTarget | null;
  revealConversation: boolean;
}): boolean {
  const { store, decision, viewport, incoming, revealConversation } = input;
  store.takeArrival();
  if (decision.entry.snapshot !== serializeWorkspaceState(store.get())) store.replace(decision.state);
  const viewportChanged = decision.entry.viewport !== viewport;
  if (viewportChanged) store.dispatch({ type: "setViewport", viewport });
  revealStoredConversation({ store, incoming, viewport, openIncoming: false, enabled: revealConversation });
  return viewportChanged || revealConversation;
}

function replaceBrowseDetailTarget(input: { store: WorkspaceBrowserStore; source: BrowseState }): boolean {
  const { store, source } = input;
  const current = store.get();
  const path = SYSTEM_CARD_PATHS.browse;
  const tab = current.tabs[path];
  const parsed = tab === undefined ? null : parseBrowseState(tab.target);
  if (tab === undefined || parsed === null || !parsed.ok || JSON.stringify(parsed.state) !== JSON.stringify(source)) return false;
  store.replace({ ...current, tabs: { ...current.tabs, [path]: { ...tab,
    target: { ...tab.target, viewState: browseStateToViewState({ directory: source.directory }) } } } });
  return true;
}

function performBrowseDetailHandoff(input: BrowseDetailHandoff & {
  store: WorkspaceBrowserStore;
  viewport: "mobile" | "desktop";
  dispatch: (action: WorkspaceAction, replace?: boolean) => void;
}): boolean {
  if (!replaceBrowseDetailTarget({ store: input.store, source: input.source })) return false;
  input.dispatch({ type: "openCard", target: input.detail, label: input.detail.path,
    at: Date.now(), viewport: input.viewport, destinationPane: "right" }, true);
  return true;
}

/**
 * Arrival (docs/implemented-plans/landmark-arrival.md, Track D). The store's candidate flag
 * enables the place query on the desktop layout. It uses the same input as the
 * chat's openers query (`useChatBinding`), so one request serves both. At the
 * root of a new chat it also enables the questions query on both layouts, for
 * the arrival question (docs/implemented-plans/questions-beside-the-chat.md, Track A).
 */
function usePlaceArrival(input: { store: WorkspaceBrowserStore; viewport: "mobile" | "desktop"; contextDir: string | undefined; unstarted: boolean }) {
  const { store, viewport, contextDir } = input;
  const candidate = useSyncExternalStore(store.subscribe, store.hasArrival, store.hasArrival);
  const placeEnabled = viewport === "desktop" && candidate && contextDir !== undefined;
  // Only a new chat: an existing one opened in a new tab has no saved arrangement either.
  const questionsEnabled = candidate && contextDir === "" && input.unstarted;
  const query = trpc.landmarks.forDir.useQuery({ dir: contextDir ?? "" }, { enabled: placeEnabled });
  const questions = trpc.status.questions.useQuery(undefined, { enabled: questionsEnabled });
  const done = (q: { isSuccess: boolean; isError: boolean }, enabled: boolean) => !enabled || q.isSuccess || q.isError;
  return { candidate, settled: done(query, placeEnabled) && done(questions, questionsEnabled),
    target: query.data?.landmark?.arrival ?? null, failure: query.isError ? query.error : null,
    question: questionsEnabled && questions.data !== undefined ? pickArrivalQuestion(questions.data.items) : null,
    questionsFailure: questions.isError ? questions.error : null };
}

/**
 * Takes the candidate flag and opens what `arrivalPlan` names beside the chat.
 * The store's own dispatch carries no focus effect, so the cursor stays in the
 * composer.
 */
function arriveAtPlace(input: { store: WorkspaceBrowserStore; viewport: "mobile" | "desktop"; contextDir: string | undefined;
  arrival: Pick<ReturnType<typeof usePlaceArrival>, "target" | "failure" | "question" | "questionsFailure"> }) {
  const { store, viewport, arrival } = input;
  const arrive = store.takeArrival();
  if (arrive && arrival.failure !== null) console.warn(`[workspace] arrival: place query failed for "${input.contextDir ?? ""}"`, arrival.failure);
  if (arrive && arrival.questionsFailure !== null) console.warn("[workspace] arrival: questions query failed", arrival.questionsFailure);
  const paths = arrivalPlan({ arrive, viewport, tabCount: Object.keys(store.get().tabs).length, target: arrival.target, question: arrival.question });
  for (const path of paths) {
    store.dispatch({ type: "openCard", target: { path, viewer: null, params: {}, viewState: null }, label: path, at: Date.now(), viewport });
  }
}

/** The route's card and the navigation it calls for; decided before any wait for arrival. */
function routeNavigation(input: { location: ReturnType<typeof useLocation>; splat: string | undefined; scope: string; identity: string;
  revealConversation: boolean }) {
  const { location } = input;
  const incoming = workspaceRouteTarget({ pathname: location.pathname, splat: input.splat, searchStr: location.searchStr, search: location.search });
  const decision = decideWorkspaceNavigation({ history: location.state.bbxWorkspace, scope: input.scope, identity: input.identity,
    freshCard: incoming ? serializeViewUrl(incoming) : null, cardEntry: location.pathname.includes("/views/") || input.revealConversation });
  return { incoming, decision };
}

export function useWorkspace() { return useContext(Workspace); }
export function WorkspaceProvider({ target, unstarted, children }: { target: ConversationTarget | undefined; unstarted: boolean; children: ReactNode }) {
  const value = useWorkspaceController(target, unstarted);
  return <Workspace.Provider value={value}>{children}</Workspace.Provider>;
}
function useWorkspaceController(conversationTarget: ConversationTarget | undefined, unstarted: boolean) {
  const { boxSlug = "", _splat } = useParams({ strict: false });
  const location = useLocation();
  const routeReady = useRouterState({ select: state => !state.isLoading && state.resolvedLocation?.href === state.location.href });
  const navigate = useNavigate();
  const mobile = useMobileChatViewport();
  const viewport = mobile ? "mobile" : "desktop";
  // External store owns synchronous imperative history/storage transitions.
  const apiBase = getApiBase();
  const store = useMemo(() => createWorkspaceBrowserStore(apiBase, boxSlug), [apiBase, boxSlug]);
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const storedIdentity = useSyncExternalStore(store.subscribe, store.getIdentity, store.getIdentity);
  const pendingAdoption = useSyncExternalStore(store.subscribe, store.getAdoption, store.getAdoption);
  const notice = useSyncExternalStore(store.subscribe, store.getNotice, store.getNotice);
  const contextDir = conversationTarget?.contextDir;
  const arrival = usePlaceArrival({ store, viewport, contextDir, unstarted });
  const dismissOnClose = useDismissOnClose();
  const identity = conversationTarget?.kind === "session" ? conversationTarget.sessionId : conversationTarget?.clientConversationId ?? "";
  const scope = storageScopeFor(apiBase);
  const projection = projectWorkspace(state, viewport);
  const routeBound = workspaceRouteBound(location.state.bbxConversation, identity);
  const ready = routeBound && storedIdentity === identity;
  const displayReady = workspaceDisplayReady({ renderedIdentity: identity, storedIdentity, adoption: pendingAdoption });
  const transcriptVisible = displayReady && projection.transcript !== null;
  const revision = useRef(0);
  const observed = useRef("");
  const previousMobile = useRef(mobile);
  useEffect(() => { store.select(identity); }, [identity, store]);
  // Router writes are imperative; stable callback prevents a restore/write feedback loop.
  const projectHistory = useCallback((replace: boolean, options?: { returnRevision?: number; retainedTarget?: ViewTarget }) => {
    if (!routeReady) return;
    const snapshot = store.get();
    const search = workspaceProjectionSearch({ pathname: location.pathname, search: location.search,
      target: workspaceHistoryTarget({ state: snapshot, viewport, retainedTarget: options?.retainedTarget }) });
    const currentIdentity = store.getIdentity();
    const saved: WorkspaceHistoryEntry = { scope, identity: currentIdentity, snapshot: serializeWorkspaceState(snapshot), viewport, revision: ++revision.current,
      ...(options?.returnRevision === undefined ? {} : { returnRevision: options.returnRevision, returnIndex: location.state.__TSR_index }) };
    void navigate({ to: href(`/${boxSlug}/chat`), search: toSearch(search), replace,
      state: (old) => {
        const { bbxConversationOverlay: _legacyOverlay, ...retained } = old;
        return { ...retained, bbxWorkspace: saved, bbxWorkspaceRevealConversation: undefined };
      } });
  }, [routeReady, store, viewport, location.pathname, location.search, scope, navigate, boxSlug, location.state.__TSR_index]);
  useEffect(() => {
    if (!routeReady || !routeBound) return;
    const revealConversation = location.state.bbxWorkspaceRevealConversation === true;
    const routeStamp = `${identity}:${location.state.__TSR_index}:${location.pathname}:${location.searchStr}:${location.state.bbxWorkspace?.revision ?? ""}:${location.state.bbxConversationOverlay === true}:${revealConversation}`;
    if (observed.current === routeStamp) return;
    const { incoming, decision } = routeNavigation({ location, splat: _splat, scope, identity, revealConversation });
    const special = pendingAdoption?.to === identity || location.state.bbxConversationOverlay === true;
    // The stamp stays unobserved while waiting, so the effect runs this route again when the query settles.
    if (!special && arrivalWaits({ decision: decision.kind, candidate: store.hasArrival(), settled: arrival.settled })) return;
    observed.current = routeStamp;
    if (pendingAdoption?.to === identity) {
      revealStoredConversation({ store, incoming, viewport, openIncoming: true, enabled: revealConversation });
      projectHistory(true, { retainedTarget: incoming ?? undefined });
      store.clearAdoption();
      return;
    }
    if (location.state.bbxConversationOverlay === true) {
      for (const action of legacyOverlayActions({ state: store.get(), incoming, viewport, at: Date.now() })) store.dispatch(action);
      projectHistory(true, { retainedTarget: incoming ?? undefined });
      return;
    }
    if (decision.kind === "restore-snapshot") {
      revision.current = Math.max(revision.current, decision.entry.revision);
      if (restoreHistorySnapshot({ store, decision, viewport, incoming, revealConversation })) projectHistory(true, { retainedTarget: incoming ?? undefined });
      return;
    }
    if (decision.kind === "open-url") {
      store.takeArrival(); // The URL's card is the person's intent.
      const target = parseViewUrl(decision.card);
      store.dispatch({ type: "openCard", target, label: target.path, at: Date.now(), viewport });
      revealStoredConversation({ store, incoming: target, viewport, openIncoming: false, enabled: revealConversation });
    }
    if (decision.kind === "keep-current") {
      arriveAtPlace({ store, viewport, contextDir, arrival: { target: arrival.target, failure: arrival.failure,
        question: arrival.question, questionsFailure: arrival.questionsFailure } });
      revealStoredConversation({ store, incoming, viewport, openIncoming: false, enabled: revealConversation });
    }
    projectHistory(true, revealConversation ? { retainedTarget: incoming ?? undefined } : undefined);
  }, [routeReady, identity, routeBound, location, _splat, scope, store, viewport, projectHistory, pendingAdoption,
    arrival.candidate, arrival.settled, arrival.target, arrival.failure, arrival.question, arrival.questionsFailure, contextDir]);

  useEffect(() => {
    if (!routeReady || previousMobile.current === mobile) return;
    previousMobile.current = mobile;
    store.dispatch({ type: "setViewport", viewport });
    if (ready) projectHistory(true);
  }, [routeReady, mobile, viewport, store, ready, projectHistory]);

  function dispatch(action: WorkspaceAction, replace?: boolean) {
    const returning = mobile && action.type === "showChat" ? location.state.bbxWorkspace?.revision : undefined;
    const result = store.dispatch(action);
    projectHistory(replace !== false && !(mobile && action.type === "showChat"),
      returning === undefined ? undefined : { returnRevision: returning });
    if (result.effect.kind !== "none") requestAnimationFrame(() => {
      const focus = result.effect;
      if (focus.kind === "conversation") document.getElementById("bbx-workspace-show-cards")?.focus();
      else if (focus.kind === "pane-control") document.getElementById(`bbx-pane-${focus.pane}-${store.get().layout.kind === "focus" ? "unfocus" : "focus"}`)?.focus();
      else if (focus.kind === "card-panel" || focus.kind === "tab") {
        const root = [...document.querySelectorAll<HTMLElement>("[data-workspace-card]")].find((node) => node.dataset.workspaceCard === focus.path);
        root?.querySelector<HTMLElement>(focus.kind === "tab" ? '[role="tab"][aria-selected="true"]' : '[role="tabpanel"]')?.focus();
      }
    });
  }
  function open(incoming: ViewTarget, hint?: NavigateHint & { originatingPane?: PaneId; destinationPane?: PaneId }) {
    const target = normalizeBrowseTarget(incoming);
    const action: WorkspaceAction = { type: "openCard", target, label: hint?.label ?? target.path,
      at: Date.now(), viewport, originatingPane: hint?.originatingPane, destinationPane: hint?.destinationPane };
    const before = store.get();
    const after = reduceWorkspace(before, action).state;
    dispatch(action, workspaceOpenShouldReplace({ before, after, viewport }));
  }
  function restoreCards(pane: PaneId) {
    if (mobile && shouldRestoreMobileWithBack(location.state.bbxWorkspace, location.state.__TSR_index)) { window.history.back(); return; }
    dispatch({ type: "restoreCards", pane, viewport });
  }
  function updateTarget(incoming: ViewTarget, method?: "push" | "replace") {
    const target = normalizeBrowseTarget(incoming);
    const current = store.get();
    const existing = current.tabs[target.path];
    if (!existing) return;
    store.replace({ ...current, tabs: { ...current.tabs, [target.path]: { ...existing, target } } });
    projectHistory(method !== "push");
  }
  function retargetCard(fromPath: string, path: string) {
    const current = store.get();
    const tab = current.tabs[fromPath];
    if (tab === undefined) return;
    dispatch({ type: "retargetCard", fromPath, target: { ...tab.target, path } });
  }
  function adopt(sessionId: string) {
    store.adopt(sessionId);
  }
  function activate(path: string) {
    const interaction = store.get().lastInteraction;
    if (interaction.kind === "card" && interaction.path === path) return;
    // Focus inside content updates attention without navigating during pointer-down.
    // A route replacement here can cancel the link click that follows focus.
    store.dispatch({ type: "selectTab", path, at: Date.now(), viewport });
  }
  function tabsForPane(pane: PaneId) {
    const paths = workspaceTabPaths(state, { viewport, pane });
    return paths.flatMap((path) => state.tabs[path] ? [state.tabs[path]] : []);
  }
  return { state, store, mobile, projection, transcriptVisible, ready, displayReady, dispatch, open,
    cancelArrival: store.cancelArrival,
    handoffBrowseDetail: (input: BrowseDetailHandoff) => performBrowseDetailHandoff({ ...input, store, viewport, dispatch }), restoreCards, updateTarget, retargetCard, adopt, activate, tabsForPane,
    notice,
    activeView: projection.foregroundPath ? state.tabs[projection.foregroundPath] ?? null : null,
    onZoomView: (view: { target: ViewTarget; label: string }) => open(view.target, { label: view.label }),
    onSelectTab: (path: string) => dispatch({ type: "selectTab", path, at: Date.now(), viewport }),
    // Closing a pending question's tab is "Not now" (docs/implemented-plans/questions-beside-the-chat.md, Track B).
    onCloseTab: (path: string) => { dispatch({ type: "closeTab", path, viewport }); dismissOnClose(path); },
    onTogglePin: (path: string) => dispatch({ type: "togglePin", path, at: Date.now() }),
  };
}
