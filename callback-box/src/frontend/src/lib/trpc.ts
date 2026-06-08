import { createTRPCReact } from "@trpc/react-query";
import { createTRPCClient, httpBatchLink, splitLink, type TRPCLink } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@backend/trpc/router.js";
import { getApiBase, withBase } from "../api.js";

export const trpc = createTRPCReact<AppRouter>();

/** Inferred output types from the tRPC router */
export type RouterOutput = inferRouterOutputs<AppRouter>;

/**
 * Shared custom fetch for every link: rewrites the URL so it always reflects
 * the current box slug, and redirects to the login page on a 401.
 */
async function trpcFetch(url: RequestInfo | URL, options?: RequestInit): Promise<Response> {
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
    window.location.href = withBase(`/auth/login?returnTo=${returnTo}`);
    return new Promise(() => {});
  }
  return response;
}

/**
 * Shared link config — used by both the React client (in trpc-provider)
 * and the vanilla client (for callers outside React, e.g. XState actors).
 *
 * tRPC batches queries into a single GET with the input encoded in the URL.
 * `files.summarize` can carry a long list of paths (every file a chat session
 * touched), which both overflows the server's URL limit (431) and — because
 * it's batched with the queries a page needs to render — drags those into the
 * same failure, stalling the load. So route that one query over POST (input in
 * the request body, no URL limit), and cap the GET batch URL length so an
 * oversized query can never poison its batch-mates again.
 */
export function buildTrpcLink(): TRPCLink<AppRouter> {
  return splitLink({
    condition: (op) => op.path === "files.summarize",
    true: httpBatchLink({ url: "/api/trpc", methodOverride: "POST", fetch: trpcFetch }),
    false: httpBatchLink({ url: "/api/trpc", maxURLLength: 2000, fetch: trpcFetch }),
  });
}

/**
 * Vanilla tRPC client for use outside React (e.g., inside XState actors).
 * Shares the link config with the React client.
 */
export const trpcClient = createTRPCClient<AppRouter>({
  links: [buildTrpcLink()],
});
