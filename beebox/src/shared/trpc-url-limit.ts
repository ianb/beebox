/**
 * The longest GET URL the tRPC client builds before it splits a batch.
 *
 * A batched GET names every procedure in its path
 * (`/api/trpc/card.get,collections.query,…`), and the server routes that list
 * as one Fastify path parameter. The server's `maxParamLength` is set from this
 * same number, so any batch the client is willing to send also routes. When the
 * two drifted (client 2000, server 500), a page that refreshed many queries at
 * once got a bare `404 {"error":"Not found"}` for the whole batch, and every
 * query in it failed with tRPC's "Unknown error".
 */
export const TRPC_MAX_URL_LENGTH = 2000;
