import { useEffect } from "react";
import { QueryClient, QueryClientProvider, useIsFetching, useIsMutating } from "@tanstack/react-query";
import { trpc, buildTrpcLink } from "./trpc.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5000, retry: false },
  },
});

const trpcReactClient = trpc.createClient({
  links: [buildTrpcLink()],
});

// Page-readiness signal for headless browser automation (bin/browse / agents).
// `<body data-cb-loading="true|false">` reflects whether any React Query
// fetch or mutation is in flight. Starts "true" at module load so a
// snapshot taken before the first commit never sees a premature "false";
// the indicator below flips it based on live query state.
if (typeof document !== "undefined" && document.body) {
  document.body.dataset.cbLoading = "true";
}

function QueryActivityIndicator() {
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();
  const active = isFetching + isMutating > 0;

  useEffect(() => {
    if (active) {
      document.body.dataset.cbLoading = "true";
      return;
    }
    // Debounce the settled→false transition so a brief gap between waves
    // of queries doesn't briefly flash "false" to a watching agent.
    const id = setTimeout(() => {
      document.body.dataset.cbLoading = "false";
    }, 50);
    return () => clearTimeout(id);
  }, [active]);

  return null;
}

export function TrpcProvider({ children }: { children: React.ReactNode }) {
  return (
    <trpc.Provider client={trpcReactClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <QueryActivityIndicator />
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
