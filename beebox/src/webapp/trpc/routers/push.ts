import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { vapidPublicKey } from "../../../core/send-push.js";
import { addSubscription, removeEndpointFromBox } from "../../../core/push-subscriptions.js";

/**
 * Web Push subscription API. `vapidPublicKey` feeds the frontend's
 * PushManager.subscribe; `subscribe` records the resulting subscription in the
 * server-level store under this box's slug; `disable` removes it from this box
 * (server-side only — never client-unsubscribe, which traps Safari into refusing
 * a new subscribe without a fresh gesture). See
 * docs/plans/web-push-notifications.md (Track E).
 */

const SubscriptionInput = z.object({
  endpoint: z.string().min(1),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  ua: z.string().optional(),
});

export const pushRouter = router({
  vapidPublicKey: publicProcedure.query(() => ({ publicKey: vapidPublicKey() })),

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
