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
      // Placeholder — the custom fetch rewrites the base per-request so
      // the URL always reflects the current box slug, even after redirects.
      url: "/api/trpc",
      fetch: async (url, options) => {
        const reqUrl = typeof url === "string" ? url : url.toString();
        const trpcPath = reqUrl.indexOf("/api/trpc");
        const fixedUrl = trpcPath !== -1
          ? `${getApiBase()}/trpc${reqUrl.slice(trpcPath + "/api/trpc".length)}`
          : reqUrl;
        const response = await fetch(fixedUrl, options);
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
