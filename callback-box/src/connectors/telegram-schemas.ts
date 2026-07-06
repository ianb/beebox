/**
 * Inbound zod schema for the Telegram updates we ingest (Track D.2), matching
 * the narrow `TelegramUpdate`/`TelegramMessageObj` shapes in
 * `telegram-types.ts`. Used at both inbound boundaries: the webhook body
 * (`webapp/routes/telegram.ts` — fully untyped JSON off the wire) and the
 * polling `getUpdates` result (`services/telegram.ts`).
 *
 * Drift-tolerant: `message`/`edited_message` are optional so the many other
 * Telegram update kinds (callback_query, channel_post, …) validate fine and
 * are simply ignored downstream; unknown keys are stripped.
 */

import { z } from "zod";

const telegramMessageSchema = z.object({
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
