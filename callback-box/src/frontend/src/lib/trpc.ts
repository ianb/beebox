import { createTRPCReact } from "@trpc/react-query";
import { createTRPCClient, httpBatchLink, type TRPCLink } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@backend/trpc/router.js";
import { getApiBase } from "../api.js";

export const trpc = createTRPCReact<AppRouter>();

/** Inferred output types from the tRPC router */
export type RouterOutput = inferRouterOutputs<AppRouter>;

/**
 * Shared link config — used by both the React client (in trpc-provider)
 * and the vanilla client (for callers outside React, e.g. XState actors).
 * The custom fetch rewrites the URL so it always reflects the current box
 * slug, and redirects to the login page on a 401.
 */
export function buildTrpcLink(): TRPCLink<AppRouter> {
  return httpBatchLink({
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
          window.location.pathname + window.location.search,
        );
        window.location.href = `/auth/login?returnTo=${returnTo}`;
        return new Promise(() => {});
      }
      return response;
    },
  });
}

/**
 * Vanilla tRPC client for use outside React (e.g., inside XState actors).
 * Shares the link config with the React client.
 */
export const trpcClient = createTRPCClient<AppRouter>({
  links: [buildTrpcLink()],
});
