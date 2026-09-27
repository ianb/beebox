/**
 * The notification vocabulary: an intent to reach the person, its loudness,
 * the channels that can carry it, and the two line shapes of the notification
 * log (`log.ts`). See docs/implemented-plans/notifications.md ("Ontology", Track A).
 *
 * An intent is never a card and is never committed: it is one line in the
 * gitignored `.beebox/notifications.jsonl`, and each attempt on a channel is
 * one more line.
 */

import { z } from "zod";
import { parseTarget, type Target } from "./target.js";
import { errorMessage } from "../../lib/error-guards.js";

export const LOUDNESS = ["dot", "quiet", "loud"] as const;
/** `dot`: badge only. `quiet`: a muted notification. `loud`: a notification with sound. */
export type Loudness = (typeof LOUDNESS)[number];

export const CHANNELS = ["apns", "web-push", "telegram"] as const;
export type ChannelName = (typeof CHANNELS)[number];

export const DELIVERY_STATUSES = ["sent", "skipped", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** One intent to reach the person. */
export interface NotificationIntent {
  id: string;
  title: string;
  body: string;
  target: Target;
  loudness: Loudness;
  /** Collapse key: a later notification with the same tag replaces an earlier one. */
  tag?: string | undefined;
  /** Which code, card, or chat session wrote it. */
  source: string;
}

/**
 * One attempt on one channel. `detail` is `present`, `no-audience`, or
 * `unconfigured` for a skip, the error for a failure, absent for a send.
 */
export interface Delivery {
  channel: ChannelName;
  status: DeliveryStatus;
  detail?: string | undefined;
}

/** A target string as stored in the log, carried by the bus event, and sent to `notifications.send`. */
export const targetStringSchema = z.string().superRefine((value, ctx) => {
  try {
    parseTarget(value);
  } catch (e) {
    ctx.addIssue({ code: "custom", message: errorMessage(e) });
  }
});

export const intentLineSchema = z.object({
  kind: z.literal("intent"),
  at: z.string(),
  id: z.string().min(1),
  title: z.string(),
  body: z.string(),
  target: targetStringSchema,
  loudness: z.enum(LOUDNESS),
  tag: z.string().optional(),
  source: z.string(),
});
export type IntentLine = z.infer<typeof intentLineSchema>;

export const deliveryLineSchema = z.object({
  kind: z.literal("delivery"),
  at: z.string(),
  notificationId: z.string().min(1),
  channel: z.enum(CHANNELS),
  status: z.enum(DELIVERY_STATUSES),
  detail: z.string().optional(),
});
export type DeliveryLine = z.infer<typeof deliveryLineSchema>;

export const logLineSchema = z.discriminatedUnion("kind", [intentLineSchema, deliveryLineSchema]);
export type LogLine = z.infer<typeof logLineSchema>;

/**
 * The live `notification` bus event: the intent plus its rendered deep link,
 * for open apps. The bus is the live signal only; the log is the record.
 */
export const notificationEventSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  body: z.string(),
  target: targetStringSchema,
  loudness: z.enum(LOUDNESS),
  tag: z.string().optional(),
  source: z.string(),
  url: z.string(),
});
