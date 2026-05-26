import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trpc, buildTrpcLink } from "./trpc.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5000, retry: false },
  },
});

const trpcReactClient = trpc.createClient({
  links: [buildTrpcLink()],
});

export function TrpcProvider({ children }: { children: React.ReactNode }) {
  return (
    <trpc.Provider client={trpcReactClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
