import { createTRPCClient, httpLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { QueryClient, QueryClientProvider, useIsFetching, useIsMutating } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import type { AppRouter } from "../server/api/router.js";

export const trpc = createTRPCReact<AppRouter>();

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: false, refetchOnWindowFocus: true } } });
const trpcClient = createTRPCClient<AppRouter>({ links: [httpLink({ url: "/workstreams/api/trpc" })] });

function QueryActivity() {
  const active = useIsFetching() + useIsMutating() > 0;
  useEffect(() => { document.body.dataset.cbLoading = active ? "true" : "false"; }, [active]);
  return null;
}

export function WorkstreamsApiProvider({ children }: { children: ReactNode }) {
  return <trpc.Provider client={trpcClient} queryClient={queryClient}><QueryClientProvider client={queryClient}><QueryActivity />{children}</QueryClientProvider></trpc.Provider>;
}
