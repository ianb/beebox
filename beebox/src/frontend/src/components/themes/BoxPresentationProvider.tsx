import { createContext, useContext, useEffect, useRef, useMemo, useCallback, type ReactNode } from "react";
import { trpc, type RouterOutput } from "../../lib/trpc";
import { useBusSubscription } from "../../hooks/useBusSubscription";
import { isRecord } from "@shared/is-record";

interface PresentationState {
  data: RouterOutput["presentation"]["get"] | undefined;
  error: string | null;
  retry: () => void;
}

const PresentationContext = createContext<PresentationState | null>(null);

/** One box-scoped query, shared by chrome and every independently surfaced card. */
export function BoxPresentationProvider({ boxSlug, children }: { boxSlug: string; children: ReactNode }) {
  const query = trpc.presentation.get.useQuery({ boxKey: boxSlug }, { staleTime: Infinity });
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetch = query.refetch;
  const retry = useCallback(() => { void refetch(); }, [refetch]);
  useEffect(() => () => { if (pending.current !== null) clearTimeout(pending.current); }, []);
  useBusSubscription({
    onConnect: retry,
    onEvent: ({ event, data }) => {
      if (event !== "file-change" || !isRecord(data) || typeof data.path !== "string") return;
      const path = data.path.replace(/^\//, "");
      if (path !== "_config/box.json" && !path.startsWith("src/schemas/")) return;
      if (pending.current !== null) return;
      pending.current = setTimeout(() => { pending.current = null; retry(); }, 150);
    },
  });
  const state = useMemo(() => ({ data: query.data, error: query.error?.message ?? null, retry }), [query.data, query.error, retry]);
  const chrome = query.data?.chrome;
  return (
    <PresentationContext.Provider value={state}>
      <div className="bbx-box-presentation h-full" data-chrome-theme={chrome?.choice.name ?? "plain"}>
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
