/**
 * A complete tRPC context and a silent event bus, for tests that call routers
 * directly (`appRouter.createCaller(trpcContext({ boxRoot }))`).
 *
 * The defaults are the caller most router tests need: past the box's auth
 * wall as its owner (`authed`, `isOwner`, actor `user`), with no signed-in
 * user and so not `isAuthenticatedOwner`. A test about access passes the
 * fields it is about, so each case reads as what differs from that caller.
 */

import type { EventBus } from "../../src/core/event-bus/core.js";
import type { TrpcContext } from "../../src/webapp/trpc/context.js";

/** An event bus that records nothing and has nothing to replay. */
export const silentEventBus: EventBus = {
  emit: () => 0,
  emitTransient: () => {},
  readSince: () => [],
  readRecent: () => [],
  subscribe: () => ({ unsubscribe: () => {} }),
  prune: () => 0,
  close: () => {},
};

export function trpcContext(input: Pick<TrpcContext, "boxRoot"> & Partial<TrpcContext>): TrpcContext {
  return {
    boxSlug: "test",
    eventBus: silentEventBus,
    services: {},
    user: null,
    authed: true,
    isOwner: true,
    isAuthenticatedOwner: false,
    actor: "user",
    ...input,
  };
}
