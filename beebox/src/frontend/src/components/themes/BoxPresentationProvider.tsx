import { createContext, useContext, useEffect, useRef, useMemo, useCallback, type ReactNode } from "react";
import { trpc, type RouterOutput } from "../../lib/trpc";
import { useBusSubscription } from "../../hooks/useBusSubscription";
import { isRecord } from "@shared/is-record";
import { useLocation, useParams } from "@tanstack/react-router";
import { useBoxConversation } from "../chat/everywhere/conversation-context";

interface PresentationState {
  data: RouterOutput["presentation"]["get"] | undefined;
  error: string | null;
  retry: () => void;
}

const PresentationContext = createContext<PresentationState | null>(null);

/** System appearance follows the workspace's place, never its inspected card. */
export function BoxPresentationProvider({ boxSlug, children }: { boxSlug: string; children: ReactNode }) {
  const { pathname } = useLocation();
  const { _splat } = useParams({ strict: false });
  const conversation = useBoxConversation();
  const workspaceRoute = pathname.endsWith("/chat") || pathname.includes("/views/");
  const contextDir = workspaceRoute ? conversation?.rendered?.target.contextDir
    : pathname.includes("/browse") ? _splat ?? "" : undefined;
  // A pending workspace place is not a request for the box default.
  const placeReady = !workspaceRoute || conversation?.selection.kind !== "resolving";
  const query = trpc.presentation.get.useQuery({ boxKey: boxSlug, contextDir }, {
    enabled: placeReady, staleTime: Infinity, placeholderData: (previous) => previous,
  });
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetch = query.refetch;
  const retry = useCallback(() => { if (placeReady) void refetch(); }, [placeReady, refetch]);
  useEffect(() => () => { if (pending.current !== null) clearTimeout(pending.current); }, []);
  useBusSubscription({
    onConnect: retry,
    onEvent: ({ event, data }) => {
      if (event !== "file-change" || !isRecord(data) || typeof data.path !== "string") return;
      const path = data.path.replace(/^\//, "");
      if (path !== "_config/box.json" && !path.startsWith("src/schemas/") && !path.endsWith(".landmark.card")) return;
      if (pending.current !== null) return;
      pending.current = setTimeout(() => { pending.current = null; retry(); }, 150);
    },
  });
  const state = useMemo(() => ({ data: query.data, error: query.error?.message ?? null, retry }), [query.data, query.error, retry]);
  const chrome = query.data?.chrome;
  return (
    <PresentationContext.Provider value={state}>
      <div className="bbx-box-presentation h-full" data-chrome-theme={chrome?.choice.name ?? "plain"} data-chrome-stock={chrome?.choice.stock ?? "neutral"}>
        {children}
      </div>
    </PresentationContext.Provider>
  );
}

export function useBoxPresentation(): PresentationState | null { return useContext(PresentationContext); }

export function PresentationNotice() {
  const presentation = useBoxPresentation();
  const problem = presentation?.error ?? presentation?.data?.chrome.problem?.message;
  if (!problem) return null;
  return <div role="status" className="bbx-card-problem">Appearance settings: {problem}</div>;
}
