/**
 * Canonical inbound schema + types for the Telegram updates we ingest
 * (Track D.2 / Track 4c). This lives in `services/` because the schema is the
 * single source of truth for the update shape at the two inbound boundaries:
 *
 *   - the polling `getUpdates` result (`services/telegram.ts`, validated via
 *     `validateResponse`), and
 *   - the webhook body (`webapp/routes/telegram.ts` — fully untyped JSON off
 *     the wire).
 *
 * The `TelegramUpdate`/`TelegramMessageObj` TYPES are derived from the schema
 * (`z.infer`) so there is exactly one declaration — `connectors/telegram-types.ts`
 * re-exports them rather than re-declaring, and `services/telegram.ts` no longer
 * keeps a private duplicate. Keeping the schema here (not in `connectors/`) keeps
 * the import direction intact: `services/` must never import from `connectors/`.
 *
 * Drift-tolerant: `message`/`edited_message` are optional so the many other
 * Telegram update kinds (callback_query, channel_post, …) validate fine and are
 * simply ignored downstream; unknown keys are stripped.
 */

import { z } from "zod";

export const telegramMessageSchema = z.object({
  message_id: z.number(),
  date: z.number(),
  chat: z.object({
    id: z.number(),
    title: z.string().optional(),
    type: z.string(),
  }),
  from: z
    .object({
      id: z.number(),
      first_name: z.string(),
      last_name: z.string().optional(),
      username: z.string().optional(),
    })
    .optional(),
  text: z.string().optional(),
  caption: z.string().optional(),
});

export const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: telegramMessageSchema.optional(),
  edited_message: telegramMessageSchema.optional(),
});

/** The `getUpdates` result: an array of updates. */
export const telegramUpdatesSchema = z.array(telegramUpdateSchema);

/** Minimal Telegram message shape we extract fields from. */
export type TelegramMessageObj = z.infer<typeof telegramMessageSchema>;

/** Shape of the update objects we accept (from webhook or getUpdates). */
export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
