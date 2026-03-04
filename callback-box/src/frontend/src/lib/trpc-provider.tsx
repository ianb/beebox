import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { trpc } from "./trpc.js";
import { getApiBase } from "../api.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5000, retry: false },
  },
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: `${getApiBase()}/trpc`,
      fetch: async (url, options) => {
        const response = await fetch(url, options);
        if (response.status === 401) {
          const returnTo = encodeURIComponent(
            window.location.pathname + window.location.search
          );
          window.location.href = `/auth/login?returnTo=${returnTo}`;
          return new Promise(() => {});
        }
        return response;
      },
    }),
  ],
});

export function TrpcProvider({ children }: { children: React.ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
