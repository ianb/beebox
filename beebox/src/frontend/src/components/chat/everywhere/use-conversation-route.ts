import { routeCardAttentionRef } from "./route-attention";
/** Route navigation supplies attention; only explicit chat URLs select a recipient. */
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { useViewOverlay } from "../../ViewOverlay";
import { z } from "zod";
import { conversationSelectionSchema, type ConversationSelection, type AttentionSnapshot } from "@shared/chat-composer-binding";
import { routeConversationRequest } from "./conversation-intent";
import { workspaceRouteTarget, systemCardEntryContext } from "../../../lib/system-card-navigation";
import { href, toSearch } from "../../../lib/routing";
import type { ConversationContextValue } from "./conversation-context";

declare module "@tanstack/history" {
  interface HistoryState {
    bbxConversation?: ConversationSelection;
    bbxConversationOverlay?: boolean;
  }
}
const chatSearch = z.object({ session: z.string().optional(), contextDir: z.string().optional(), engine: z.string().optional(), model: z.string().optional() });
export function useConversationRoute(conversation: ConversationContextValue) {
  const location = useLocation();
  const navigate = useNavigate();
  const viewOverlay = useViewOverlay();
  const { _splat } = useParams({ strict: false });
  const previousUrl = useRef<string | null>(null);
  const resolvingRoute = useRef(false);
  const routeRequestSerial = useRef(0);
  const [routeRevision, setRouteRevision] = useState(0);
  const chatPage = location.pathname.endsWith("/chat");
  const overlay = location.state.bbxConversationOverlay === true;
  const transcriptVisible = chatPage || overlay;
  const routeKey = `${location.state.__TSR_index}:${location.pathname}${location.searchStr}`;
  const { select, selection } = conversation;
  useEffect(() => {
    function choose(request: Parameters<typeof select>[0]) {
      const ticket = ++routeRequestSerial.current;
      resolvingRoute.current = true;
      void select(request).finally(() => {
        if (ticket !== routeRequestSerial.current) return;
        resolvingRoute.current = false;
        setRouteRevision((old) => old + 1);
      });
    }
    if (previousUrl.current === routeKey) return;
    const first = previousUrl.current === null;
    previousUrl.current = routeKey;
    const entry = systemCardEntryContext(workspaceRouteTarget({ pathname: location.pathname, splat: _splat, searchStr: location.searchStr, search: location.search }));
    const saved = conversationSelectionSchema.safeParse(location.state.bbxConversation);
    const request = routeConversationRequest({ first, chatPage, search: chatSearch.parse(location.search), selection: first && conversation.rendered ? conversation.rendered : selection,
      stored: first ? conversation.restored : null,
      remembered: saved.success ? saved.data : null,
      cardPath: entry.cardPath,
      browseDir: location.pathname.includes("/browse/") ? (_splat ?? "") : entry.browseDir });
    if (request) choose(request);
  }, [routeKey, chatPage, location.searchStr, location.search, location.state.bbxConversation, location.pathname, select, selection, _splat, conversation.rendered, conversation.restored]);
  // Every app history entry keeps the focus it inherited. Back can restore it;
  // a normal link into another landmark never derives a new focus from its path.
  useEffect(() => {
    if (resolvingRoute.current || selection.kind !== "ready") return;
    const search = chatSearch.parse(location.search);
    const canonicalSession = chatPage && selection.target.kind === "session" && search.session !== selection.target.sessionId ? selection.target.sessionId : null;
    const consumeCapture = chatPage && "capture" in location.search;
    if (!canonicalSession && !consumeCapture && JSON.stringify(selection) === JSON.stringify(location.state.bbxConversation)) return;
    const nextSearch = { ...location.search };
    if (canonicalSession) nextSearch.session = canonicalSession;
    if (consumeCapture) delete nextSearch.capture;
    void navigate({ to: href(location.pathname), search: toSearch(nextSearch), replace: true,
      state: (old) => ({ ...old, bbxConversation: selection }) });
  }, [selection, location.state.bbxConversation, location.pathname, location.search, navigate, routeRevision, chatPage]);
  function showConversation() {
    viewOverlay?.close();
    if (transcriptVisible) return;
    void navigate({ to: href(location.pathname), search: toSearch(location.search),
      state: (old) => ({ ...old, bbxConversationOverlay: true, bbxConversation: undefined }) });
  }
  function hideConversation() {
    if (overlay) window.history.back();
  }
  const surface: AttentionSnapshot["surface"] = location.pathname.includes("/views/") ? "card"
    : location.pathname.includes("/browse") ? "browse" : chatPage ? "chat"
    : location.pathname.endsWith("/dashboard") ? "dashboard" : location.pathname.endsWith("/landmarks") ? "landmarks" : "other";
  const cardPath = routeCardAttentionRef(_splat, location.searchStr);
  const attention: AttentionSnapshot = { surface, transcript: transcriptVisible ? "visible" : "hidden",
    ...(surface === "card" && cardPath ? { focusedRef: cardPath } : {}) };
  return { chatPage, transcriptVisible, showConversation, hideConversation, attention };
}
