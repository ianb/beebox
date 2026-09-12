import { createTRPCReact } from "@trpc/react-query";
import { createTRPCClient, createWSClient, httpBatchStreamLink, retryLink, splitLink, wsLink, type TRPCLink } from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@backend/trpc/router.js";
import { getApiBase, getWebSocketUrl, withBase } from "../../api.js";
import { getMobileAuthToken, isMobileAuthenticated, refreshMobileSession, withMobileAuth } from "../mobile-auth";
import { toastError } from "../../components/ui/toast-store";
import { fetchFromBox, retryDelayMs, shouldRetryOperation } from "./transient";

export const trpc = createTRPCReact<AppRouter>();

/** Inferred output types from the tRPC router */
export type RouterOutput = inferRouterOutputs<AppRouter>;
export type RouterInput = inferRouterInputs<AppRouter>;

/**
 * What a 401 means here, and why it no longer takes the page away.
 *
 * A tRPC *procedure* error cannot produce a 401 on this client: every HTTP link
 * below is `httpBatchStreamLink`, and the server's jsonl branch sends its
 * headers before any procedure has resolved — so the HTTP status is
 * unconditionally 200 and the per-call error rides in the body. The only thing
 * that reaches this check is a transport-level 401 from the box auth wall
 * (`webapp/server-box-scope.ts`), which answers 403 for a permitted-user
 * problem and 401 only when there is no identity at all. So a 401 here really
 * does mean the session ended — a 30-day cookie expiry, or a `gen` revocation
 * from a password change.
 *
 * It used to mean an immediate `window.location.href` to the login page, plus a
 * promise that never resolved. Both were wrong. The navigation replaced
 * whatever the person was doing with a bare Sign in form carrying no
 * explanation, which reads as data loss — a 2026-08 walkthrough recorded
 * someone assuming an evening's work was gone (it was not; `returnTo` restores
 * the route and the composer draft is in `localStorage`). And the pending
 * promise left every caller hanging forever, so anything mid-flight could
 * neither finish nor fail.
 *
 * Now the session's end is *reported* — one persistent toast that says what
 * happened and offers the login page — and the 401 is returned so callers fail
 * normally. The person chooses when to leave the page.
 *
 * See `issues/bugs/2026-08-25-one-401-ejects-the-whole-app-to-a-login-form.md`.
 */
function reportSessionEnded(): void {
  const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
  toastError("Your session has ended, so the box stopped answering.", {
    persist: true,
    action: { label: "Sign in", href: withBase(`/auth/login?returnTo=${returnTo}`) },
  });
}

/**
 * Shared custom fetch for every link: rewrites the URL so it always reflects
 * the current box slug, reports a 401 rather than ejecting the page, and turns
 * an unreachable box into a `BoxUnreachableError` (`./transient.ts`) that the
 * retry link below can recognize.
 */
async function trpcFetch(url: RequestInfo | URL, options?: RequestInit): Promise<Response> {
  const reqUrl = typeof url === "string" ? url : url.toString();
  const trpcPath = reqUrl.indexOf("/api/trpc");
  const fixedUrl = trpcPath !== -1
    ? `${getApiBase()}/trpc${reqUrl.slice(trpcPath + "/api/trpc".length)}`
    : reqUrl;
  const response = await fetchFromBox(fixedUrl, withMobileAuth(options));
  if (response.status === 401) {
    if (isMobileAuthenticated()) {
      // A mobile 401 usually means the short-lived bbx_mobile cookie lapsed
      // (e.g. after a WebKit-initiated reload, which carries no Authorization
      // header). We still hold the durable token, so re-establish the session
      // and retry once. One retry only — a second 401 means the device token
      // itself is revoked, and retrying would spin.
      if (await refreshMobileSession(getApiBase())) {
        return fetchFromBox(fixedUrl, withMobileAuth(options));
      }
      return response;
    }
    reportSessionEnded();
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

async function wakeDevBox(): Promise<void> {
  if (!import.meta.env.DEV) return;
  try {
    await fetch(`${getApiBase()}/keepalive`, { method: "HEAD", cache: "no-store" });
  } catch (_error) {
    // A failed wake should not suppress tRPC's normal reconnect behavior.
  }
}

function getWsClient(): ReturnType<typeof createWSClient> {
  if (!wsClientSingleton) {
    wsClientSingleton = createWSClient({
      // The WS URL carries no credential (the browser API can't set headers),
      // so the upgrade is gated entirely on the bbx_mobile cookie. That cookie
      // is short-lived, and unlike an HTTP 401 there is no response body to
      // recover from: a failed upgrade just makes wsLink back off and retry.
      // A device idle past the TTL would reconnect-fail forever, silently. So
      // refresh the session before opening a socket — one extra POST per
      // socket open (lazy + 30s closeMs, so this is rare), in exchange for
      // removing that failure mode entirely.
      url: async () => {
        // A lazy hub deliberately refuses to cold-start a box from a WebSocket
        // upgrade. Wake it over HTTP first, then open the socket only after the
        // box child is ready. This stays dev-only; production hubs keep their
        // existing upgrade behavior.
        await wakeDevBox();
        if (isMobileAuthenticated()) await refreshMobileSession(getApiBase());
        return getWebSocketUrl();
      },
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
 *
 * Both HTTP branches use `httpBatchStreamLink`, not `httpBatchLink`. Same
 * batching, but the server writes each procedure's result as a JSONL line the
 * moment it resolves instead of holding the whole batch until the slowest
 * member finishes. That coupling was the single biggest warm-load cost: the
 * dashboard's six queries all waited on `health.check` (~600 ms), and every
 * page's first batch waited on `status.status` (~275 ms). Nothing else changes
 * — same URL, same `fetch`, same 401 handling, and the WS split above is
 * untouched. A proxy that buffers the response degrades this to the old
 * all-at-once behavior rather than breaking it (hence `proxy_buffering off` in
 * deploy/setup-server.sh).
 *
 * The HTTP branch retries a query whose box did not answer (`./transient.ts`),
 * with backoff sized to a deploy restart. Retrying here rather than in React
 * Query reaches every caller — the vanilla `trpcClient.x.query()` sites and
 * XState actors as well as the hooks — which is why the QueryClient keeps
 * `retry: false`: two layers would multiply. Subscriptions are not in this
 * branch; `wsLink` reconnects on its own.
 */
function buildTrpcLink(): TRPCLink<AppRouter> {
  return splitLink({
    condition: (op) => op.type === "subscription",
    true: wsLink({ client: getWsClient() }),
    false: [
      retryLink({
        // `op.context` is untyped at the link boundary (`Record<string, unknown>`
        // with `unknown` values) — a bracket read plus an `=== true` check is
        // the safe way to pull the caller's opt-in flag off it (`./transient.ts`).
        retry: ({ op, attempts, error }) =>
          shouldRetryOperation({ type: op.type, attempts, error, idempotent: op.context["idempotent"] === true }),
        retryDelayMs,
      }),
      splitLink({
        condition: (op) => op.path === "files.summarize",
        true: httpBatchStreamLink({ url: "/api/trpc", methodOverride: "POST", fetch: trpcFetch }),
        false: httpBatchStreamLink({ url: "/api/trpc", maxURLLength: 2000, fetch: trpcFetch }),
      }),
    ],
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
