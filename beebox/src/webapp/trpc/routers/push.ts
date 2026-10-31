import { z } from "zod";
import { router, authedProcedure, publicProcedure } from "../procedures.js";
import { vapidPublicKey } from "../../../core/send-push.js";
import { addSubscription, endpointsForBox, removeEndpointFromBox } from "../../../core/push-subscriptions.js";

/**
 * Web Push subscription API. `vapidPublicKey` feeds the frontend's
 * PushManager.subscribe; `subscribe` records the resulting subscription in the
 * server-level store under this box's slug; `disable` removes it from this box
 * (server-side only — never client-unsubscribe, which traps Safari into refusing
 * a new subscribe without a fresh gesture). See
 * docs/implemented-plans/web-push-notifications.md (Track E).
 */

const SubscriptionInput = z.object({
  endpoint: z.string().min(1),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  ua: z.string().optional(),
});

export const pushRouter = router({
  vapidPublicKey: publicProcedure.query(() => ({ publicKey: vapidPublicKey() })),

  /**
   * Does this box hold this endpoint? The browser's own subscription outlives a
   * disable (see above) and a server-side prune, so it cannot answer "is this on".
   */
  isSubscribed: authedProcedure.input(z.object({ endpoint: z.string().min(1) })).query(async ({ ctx, input }) => ({
    subscribed: (await endpointsForBox(ctx.boxSlug)).some((sub) => sub.endpoint === input.endpoint),
  })),

  /** How many browsers this box can reach, for Admin. */
  subscriberCount: authedProcedure.query(async ({ ctx }) => ({ count: (await endpointsForBox(ctx.boxSlug)).length })),

  subscribe: publicProcedure.input(SubscriptionInput).mutation(async ({ ctx, input }) => {
    await addSubscription({
      boxSlug: ctx.boxSlug,
      subscription: { endpoint: input.endpoint, keys: input.keys },
      ua: input.ua,
      now: new Date(),
    });
    return { ok: true };
  }),

  disable: publicProcedure.input(z.object({ endpoint: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    await removeEndpointFromBox({ boxSlug: ctx.boxSlug, endpoint: input.endpoint });
    return { ok: true };
  }),
});
