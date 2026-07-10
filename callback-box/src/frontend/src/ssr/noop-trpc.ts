/**
 * No-op tRPC client for server-side rendering.
 *
 * During `cb render` every query's data is pre-populated in the QueryClient
 * before the tree renders, so the tRPC client never actually fetches — it just
 * needs to exist for `trpc.Provider`. This helper centralizes the two boundary
 * casts the SSR render site previously inlined: the `createTRPCReact` helper
 * doesn't surface `createClient` in its public types, and the resulting client
 * isn't structurally the branded type `trpc.Provider` wants. Both live here
 * now, in one named place, instead of a double cast at the call site.
 */

import { trpc } from "../lib/trpc";

/** The `client` prop type `trpc.Provider` expects. */
type TrpcProviderClient = Parameters<typeof trpc.Provider>[0]["client"];

export function createSsrNoopTrpcClient(): TrpcProviderClient {
  return (
    // eslint-disable-next-line no-restricted-syntax -- createTRPCReact doesn't surface `createClient` in its public types, and the result isn't the branded type Provider wants; both boundary casts centralized here (see file docstring).
    trpc as unknown as {
      createClient: (opts: { links: [] }) => TrpcProviderClient;
    }
  ).createClient({ links: [] });
}
