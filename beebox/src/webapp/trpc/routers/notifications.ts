/**
 * The notification log, read for the Admin "Recent" list and the `chat:new`
 * banner, and the server-side send for `bbx notify`. The log
 * (`core/notification/log.ts`) is the record. See docs/implemented-plans/notifications.md
 * (Track A).
 *
 * `send` and `channels` exist because a box-spawned shell holds none of the
 * APNs or VAPID keys (`core/script-env-allowlist.ts` keeps them out on
 * purpose), so `bbx notify` run by an agent or a schedule's script asks the
 * server, which has them, to deliver.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, authedProcedure } from "../procedures.js";
import { getIntent, readRecent, type LoggedNotification } from "../../../core/notification/log.js";
import { apnsConfigured } from "../../../core/notification/apns-channel/core.js";
import { CHANNELS, LOUDNESS, targetStringSchema } from "../../../core/notification/intent.js";
import { parseTarget } from "../../../core/notification/target.js";
import {
  notifyBoxholder,
  notifyChannelsDetail,
  type ChannelFlags,
  type NotifyResult,
} from "../../../core/notify-boxholder.js";

/**
 * The box's own agent (the bearer every box-spawned shell holds, as
 * `publications` accepts it) or the signed-in owner. A member, a paired
 * device's non-owner, and an open-access request are refused: reaching the
 * boxholder's phone is the box's voice, not a visitor's.
 */
const notifySenderProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.actor !== "agent" && !ctx.isAuthenticatedOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the box's agent or its signed-in owner can send a notification." });
  }
  return next();
});

const sendInput = z
  .object({
    intent: z
      .object({
        title: z.string().min(1),
        body: z.string(),
        target: targetStringSchema,
        loudness: z.enum(LOUDNESS),
        tag: z.string().min(1).optional(),
        source: z.string().min(1),
      })
      .strict(),
    channel: z.enum(CHANNELS).optional(),
  })
  .strict();

export const notificationsRouter = router({
  /** Intents logged in the last `days` days (default 3), newest first, each with its deliveries. */
  recent: authedProcedure
    .input(z.object({ days: z.number().int().min(1).max(60).optional() }).optional())
    .query(async ({ ctx, input }): Promise<LoggedNotification[]> => {
      const logged = await readRecent(ctx.boxRoot, { days: input?.days ?? 3 });
      return logged.toReversed();
    }),

  /** One intent by id, or null when it is not in the log (never written, or rotated away). */
  get: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<LoggedNotification | null> => getIntent(ctx.boxRoot, input.id)),

  /** Whether this server can send APNs pushes (its key is set, or fake mode is on). */
  apnsStatus: authedProcedure.query((): { configured: boolean } => ({ configured: apnsConfigured() })),

  /** Send one notification from this process, which holds the channel keys: `bbx notify`. */
  send: notifySenderProcedure.input(sendInput).mutation(async ({ ctx, input }): Promise<NotifyResult> => {
    const { intent, channel } = input;
    return notifyBoxholder(ctx.boxRoot, {
      intent: { ...intent, target: parseTarget(intent.target) },
      services: ctx.services.notify,
      channel,
    });
  }),

  /** Which channels can reach the boxholder, and which have their keys, as this server sees it: `bbx notify --check`/`--dry-run`. */
  channels: notifySenderProcedure.query(
    async ({ ctx }): Promise<{ reach: ChannelFlags; configured: ChannelFlags }> =>
      notifyChannelsDetail(ctx.boxRoot, { services: ctx.services.notify }),
  ),
});
