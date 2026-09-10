import { workspaceRouteTarget, workspaceProjectionSearch } from "../../../lib/system-card-navigation";
import { normalizeBrowseTarget } from "../../../lib/browse-card-state";
import { decideWorkspaceNavigation, workspaceDisplayReady, workspaceOpenShouldReplace, workspaceRouteBound, shouldRestoreMobileWithBack, type WorkspaceHistoryEntry } from "./workspace-history";
import { createContext, useContext, useEffect, useRef, useMemo, useCallback, useSyncExternalStore, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { getApiBase } from "../../../api";
import { href, toSearch } from "../../../lib/routing";
import { parseViewUrl, serializeViewUrl, type ViewTarget, type NavigateHint } from "../../../lib/view-url";
import { useMobileChatViewport } from "../everywhere/use-mobile-card-navigation";
import { projectWorkspace, reduceWorkspace, workspaceTabPaths, type WorkspaceAction, type PaneId } from "./workspace-state";
import { serializeWorkspaceState, conversationStorageScope } from "./workspace-storage";
import { createWorkspaceBrowserStore } from "./workspace-browser-store";
import type { ConversationTarget } from "@shared/chat-composer-binding";

declare module "@tanstack/history" { interface HistoryState { bbxWorkspace?: WorkspaceHistoryEntry } }
const Workspace = createContext<ReturnType<typeof useWorkspaceController> | null>(null);
export function useWorkspace() { return useContext(Workspace); }
export function WorkspaceProvider({ target, children }: { target: ConversationTarget | undefined; children: ReactNode }) {
  const value = useWorkspaceController(target);
  return <Workspace.Provider value={value}>{children}</Workspace.Provider>;
}
function useWorkspaceController(conversationTarget: ConversationTarget | undefined) {
  const { boxSlug = "", _splat } = useParams({ strict: false });
  const location = useLocation();
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
  const identity = conversationTarget?.kind === "session" ? conversationTarget.sessionId : conversationTarget?.clientConversationId ?? "";
  const scope = conversationStorageScope(apiBase);
  const participating = location.pathname.endsWith("/chat") || location.pathname.includes("/views/");
  const projection = projectWorkspace(state, viewport);
  const routeBound = workspaceRouteBound(location.state.bbxConversation, identity);
  const ready = routeBound && storedIdentity === identity;
  const displayReady = workspaceDisplayReady({ renderedIdentity: identity, storedIdentity, adoption: pendingAdoption });
  const transcriptVisible = displayReady && (participating ? projection.transcript !== null : location.state.bbxConversationOverlay === true);
  const revision = useRef(0);
  const observed = useRef("");
  const previousMobile = useRef(mobile);
  useEffect(() => { store.select(identity); }, [identity, store]);

  // Router writes are imperative; stable callback prevents a restore/write feedback loop.
  const projectHistory = useCallback((replace: boolean, returnRevision?: number) => {
    const snapshot = store.get();
    const foreground = projectWorkspace(snapshot, viewport).foregroundPath;
    const tab = foreground ? snapshot.tabs[foreground] : undefined;
    const search = workspaceProjectionSearch({ pathname: location.pathname, search: location.search, target: tab?.target ?? null });
    const currentIdentity = store.getIdentity();
    const saved: WorkspaceHistoryEntry = { scope, identity: currentIdentity, snapshot: serializeWorkspaceState(snapshot), viewport, revision: ++revision.current, ...(returnRevision === undefined ? {} : { returnRevision, returnIndex: location.state.__TSR_index }) };
    void navigate({ to: href(`/${boxSlug}/chat`), search: toSearch(search), replace,
      state: (old) => ({ ...old, bbxWorkspace: saved, bbxConversationOverlay: false }) });
  }, [store, viewport, location.pathname, location.search, scope, navigate, boxSlug, location.state.__TSR_index]);
  useEffect(() => {
    if (!routeBound || !participating) return;
    const routeStamp = `${identity}:${location.state.__TSR_index}:${location.pathname}:${location.searchStr}:${location.state.bbxWorkspace?.revision ?? ""}:${location.state.bbxConversationOverlay === true}`;
    if (observed.current === routeStamp) return;
    observed.current = routeStamp;
    if (pendingAdoption?.to === identity) {
      projectHistory(true);
      store.clearAdoption();
      return;
    }
    if (location.state.bbxConversationOverlay === true && !location.pathname.includes("/views/")) {
      const current = store.get();
      if (current.layout.kind === "focus") store.dispatch({ type: "backToSplit", pane: current.layout.pane });
      store.dispatch({ type: "showChat", pane: current.lastCardPane, viewport });
      projectHistory(true);
      return;
    }
    const incoming = workspaceRouteTarget({ pathname: location.pathname, splat: _splat, searchStr: location.searchStr, search: location.search });
    const card = incoming ? serializeViewUrl(incoming) : null;
    const decision = decideWorkspaceNavigation({ history: location.state.bbxWorkspace, scope, identity, freshCard: card ?? null, cardEntry: location.pathname.includes("/views/") });
    if (decision.kind === "restore-snapshot") {
      if (decision.entry.snapshot !== serializeWorkspaceState(store.get())) store.replace(decision.state);
      revision.current = Math.max(revision.current, decision.entry.revision);
      if (decision.entry.viewport !== viewport) {
        store.dispatch({ type: "setViewport", viewport });
        projectHistory(true);
      }
      return;
    }
    if (decision.kind === "open-url") {
      const target = parseViewUrl(decision.card);
      store.dispatch({ type: "openCard", target, label: target.path, at: Date.now(), viewport });
    }
    projectHistory(true);
  }, [identity, routeBound, participating, location, _splat, scope, store, viewport, projectHistory, pendingAdoption]);

  useEffect(() => {
    if (previousMobile.current === mobile) return;
    previousMobile.current = mobile;
    store.dispatch({ type: "setViewport", viewport });
    if (participating && ready) projectHistory(true);
  }, [mobile, viewport, store, participating, ready, projectHistory]);

  function dispatch(action: WorkspaceAction, replace?: boolean) {
    const returning = mobile && action.type === "showChat" ? location.state.bbxWorkspace?.revision : undefined;
    const result = store.dispatch(action);
    projectHistory(replace !== false && !(mobile && action.type === "showChat"), returning);
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
  function open(incoming: ViewTarget, hint?: NavigateHint & { originatingPane?: PaneId }) {
    const target = normalizeBrowseTarget(incoming);
    const action: WorkspaceAction = { type: "openCard", target, label: hint?.label ?? target.path,
      at: Date.now(), viewport, originatingPane: hint?.originatingPane };
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
  return { state, store, mobile, participating, projection, transcriptVisible, ready, displayReady, dispatch, open, restoreCards, updateTarget, retargetCard, adopt, activate, tabsForPane,
    notice,
    activeView: projection.foregroundPath ? state.tabs[projection.foregroundPath] ?? null : null,
    onZoomView: (view: { target: ViewTarget; label: string }) => open(view.target, { label: view.label }),
    onSelectTab: (path: string) => dispatch({ type: "selectTab", path, at: Date.now(), viewport }),
    onCloseTab: (path: string) => dispatch({ type: "closeTab", path, viewport }),
    onTogglePin: (path: string) => dispatch({ type: "togglePin", path, at: Date.now() }),
  };
}
