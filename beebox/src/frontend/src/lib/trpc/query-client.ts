import { QueryClient } from "@tanstack/react-query";

// `retry: false` is deliberate: a box that did not answer is retried by the
// tRPC link (see `buildTrpcLink` in ./index.ts), which reaches every caller.
// Retrying here as well would multiply the two schedules.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5000, retry: false },
  },
});
