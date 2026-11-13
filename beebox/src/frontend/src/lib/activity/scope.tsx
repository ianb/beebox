/**
 * Where a view's or figure's activity belongs. The chat shell provides the
 * conversation scope; each companion-pane card provides its own path. Outside
 * a chat there is no scope and reporters log nothing.
 */

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import type { ConversationTarget } from "@shared/chat-composer-binding";
import { logActivity, type ActivityReport, type ActivityScope } from "./page-queue";

type ScopeGetter = () => ActivityScope;

const ScopeContext = createContext<ScopeGetter | null>(null);
const PaneCardContext = createContext<string | null>(null);

/** The scope getter for one conversation; reads the latest values at call time. */
export function useActivityScope(scope: ActivityScope): ScopeGetter {
  const latest = useRef(scope);
  useEffect(() => { latest.current = scope; }, [scope]);
  return useCallback(() => latest.current, []);
}

/** The scope of one chat: its session id, or the page's key for a new conversation, and the last message sent. */
export function useChatActivityScope(chat: { sessionId: string | null; target: ConversationTarget; lastSentId: string | undefined }): ScopeGetter {
  const { sessionId, target, lastSentId } = chat;
  return useActivityScope({
    ...(sessionId !== null ? { chat: sessionId } : target.kind === "start" ? { pendingChat: target.clientConversationId } : {}),
    ...(lastSentId !== undefined ? { afterMessage: lastSentId } : {}),
  });
}

export function ActivityScopeProvider({ getScope, children }: { getScope: ScopeGetter; children: ReactNode }) {
  return <ScopeContext.Provider value={getScope}>{children}</ScopeContext.Provider>;
}

/** Marks `card` as the companion-pane card whose content is rendered below. */
export function PaneCardProvider({ card, children }: { card: string; children: ReactNode }) {
  return <PaneCardContext.Provider value={card}>{children}</PaneCardContext.Provider>;
}

/** The companion-pane card this component renders under, or null. */
export function usePaneCard(): string | null {
  return useContext(PaneCardContext);
}

/** Log one entry into the selected conversation's scope; a no-op outside a chat. */
export function useActivityLogger(): (report: ActivityReport) => void {
  const getScope = useContext(ScopeContext);
  return useCallback((report) => { if (getScope !== null) logActivity(report, getScope()); }, [getScope]);
}
