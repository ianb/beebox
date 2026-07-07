import { createTRPCReact } from "@trpc/react-query";
import { createTRPCClient, createWSClient, httpBatchLink, splitLink, wsLink, type TRPCLink } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@backend/trpc/router.js";
import { getApiBase, getWebSocketUrl, withBase } from "../../api.js";
import { getMobileAuthToken, isMobileAuthenticated, withMobileAuth } from "../mobile-auth";

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
  const response = await fetch(fixedUrl, withMobileAuth(options));
  if (response.status === 401) {
    if (isMobileAuthenticated()) return response;
    const returnTo = encodeURIComponent(
      window.location.pathname + window.location.search,
    );
    window.location.href = withBase(`/auth/login?returnTo=${returnTo}`);
    return new Promise(() => {});
  }
  return response;
}

/**
 * One WebSocket client for the whole app, created on first use. `lazy` keeps it
 * from opening a socket until the first subscription, and closes it ~30 s after
 * the last unsubscribes; `keepAlive` runs a client-side ping so a dead server
 * is detected and the auto-reconnect (exponential backoff) kicks in. The `url`
 * is a thunk so nothing touches `window` until a subscription actually opens
 * (keeps module load SSR-safe).
 */
let wsClientSingleton: ReturnType<typeof createWSClient> | null = null;
function getWsClient(): ReturnType<typeof createWSClient> {
  if (!wsClientSingleton) {
    wsClientSingleton = createWSClient({
      url: () => getWebSocketUrl(),
      connectionParams: () => {
        const token = getMobileAuthToken();
        return token ? { authorization: `Bearer ${token}` } : null;
      },
      lazy: { enabled: true, closeMs: 30_000 },
      keepAlive: { enabled: true },
    });
  }
  return wsClientSingleton;
}

/**
 * Shared link config — used by both the React client (in trpc-provider)
 * and the vanilla client (for callers outside React, e.g. XState actors).
 *
 * Three-way routing:
 * - Subscriptions go over the multiplexed WebSocket (`wsLink`), which gives
 *   auto-reconnect + `lastEventId` resume — the resilient real-time transport.
 * - `files.summarize` goes over POST (input in the body): it carries a long
 *   path list that overflows the GET URL limit (431) and would otherwise drag
 *   its batch-mates down with it.
 * - Everything else (queries/mutations) goes over the GET/POST batch, with a
 *   capped URL length so an oversized query can't poison its batch.
 */
function buildTrpcLink(): TRPCLink<AppRouter> {
  return splitLink({
    condition: (op) => op.type === "subscription",
    true: wsLink({ client: getWsClient() }),
    false: splitLink({
      condition: (op) => op.path === "files.summarize",
      true: httpBatchLink({ url: "/api/trpc", methodOverride: "POST", fetch: trpcFetch }),
      false: httpBatchLink({ url: "/api/trpc", maxURLLength: 2000, fetch: trpcFetch }),
    }),
  });
}

/**
 * THE app-wide tRPC client — used directly by non-React callers (XState
 * actors) and handed to `trpc.Provider` for the React hooks.
 *
 * One instance is load-bearing, not a convenience: tRPC numbers operations
 * per client instance, and the WS adapter's per-connection subscription
 * registry is keyed by that number. Two client instances sharing the
 * singleton WebSocket each count 1, 2, 3… independently, so the moment a
 * React-side subscription (e.g. `events.subscribe`) and a vanilla-side one
 * (e.g. `events.turnStream` on send) hold the same number on the same
 * socket, the server rejects with `Duplicate id N` — deterministically per
 * page, invisibly to every log. (Found the hard way, 2026-06.)
 */
export const trpcClient = createTRPCClient<AppRouter>({
  links: [buildTrpcLink()],
});
