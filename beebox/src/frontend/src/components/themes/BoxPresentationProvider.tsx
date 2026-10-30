import { createContext, useContext, useMemo, useCallback, type ReactNode } from "react";
import { trpc, type RouterOutput } from "../../lib/trpc/client";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import type { RealtimeEvent } from "../../hooks/useBusSubscription";
import { busEventData } from "../../lib/bus-events";
import { boxRelativePath } from "@shared/box-path";
import { useLocation, useParams } from "@tanstack/react-router";
import { useBoxConversation } from "../chat/everywhere/conversation-context/context";

import { useDoodlebitMotion } from "./useDoodlebitMotion";

export type PresentationData = RouterOutput["presentation"]["get"];

interface PresentationState {
  data: PresentationData | undefined;
  error: string | null;
  retry: () => void;
}

const PresentationContext = createContext<PresentationState | null>(null);

/** Box config, a schema, or a landmark card: the inputs of the presentation. */
function presentationChange(event: RealtimeEvent): boolean {
  const change = busEventData(event, "file-change");
  if (change === null) return false;
  const path = boxRelativePath(change.path);
  return path === "_config/box.json" || path.startsWith("src/schemas/") || path.endsWith(".landmark.card");
}

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
  const refetch = query.refetch;
  const retry = useCallback(() => { if (placeReady) void refetch(); }, [placeReady, refetch]);
  useLiveRefresh({ when: presentationChange, refresh: retry, burstMs: 150 });
  const state = useMemo(() => ({ data: query.data, error: query.error?.message ?? null, retry }), [query.data, query.error, retry]);
  const chrome = query.data?.chrome;
  const surface = useDoodlebitMotion(chrome?.choice.name === "doodlebit");
  return (
    <PresentationContext.Provider value={state}>
      <div ref={surface} className="bbx-box-presentation h-full" data-chrome-theme={chrome?.choice.name ?? "plain"} data-chrome-stock={chrome?.choice.stock ?? "neutral"}>
        {children}
      </div>
    </PresentationContext.Provider>
  );
}

/** A fixed presentation, without the box query, for the theme studio's specimens. */
export function PresentationSnapshot({ data, error, children }: { data: PresentationData; error: string | null; children: ReactNode }) {
  const state = useMemo(() => ({ data, error, retry: () => {} }), [data, error]);
  return <PresentationContext.Provider value={state}>{children}</PresentationContext.Provider>;
}

export function useBoxPresentation(): PresentationState | null { return useContext(PresentationContext); }

export function PresentationNotice() {
  const presentation = useBoxPresentation();
  const problem = presentation?.error ?? presentation?.data?.chrome.problem?.message;
  if (!problem) return null;
  return <div role="status" className="bbx-card-problem">Appearance settings: {problem}</div>;
}
