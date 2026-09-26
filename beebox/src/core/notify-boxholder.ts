/**
 * notifyBoxholder — the single entry point for reaching the person.
 *
 * Logs the intent, emits the live `notification` bus event for open apps,
 * decides which channels to try from loudness, audience, and presence
 * (`notification/channels.ts`), sends once per chosen channel in process, and
 * logs one delivery line per channel. No queue and no retry: a failure is a
 * `failed` line, and the notification health checks surface it. See
 * docs/plans/notifications.md (Track A).
 */

import { randomBytes } from "node:crypto";
import { loadBoxConfig } from "./box/config.js";
import { loadTelegramConfig } from "../connectors/telegram-helpers.js";
import { createTelegramService, type TelegramService } from "../services/telegram.js";
import type { PushService } from "../services/push.js";
import { sendPush, VapidNotConfiguredError, webPushConfigured } from "./send-push.js";
import { endpointsForBox } from "./push-subscriptions.js";
import { boxSlug } from "../lib/box-slug.js";
import { getBoxTime } from "../lib/time.js";
import { getPublicUrl } from "../lib/public-url.js";
import { errorMessage } from "../lib/error-guards.js";
import { assertNever } from "../lib/invariant.js";
import { createEventBus } from "./event-bus.js";
import { CHANNELS, type ChannelName, type Delivery, type NotificationIntent } from "./notification/intent.js";
import { formatTarget, targetUrl } from "./notification/target.js";
import { appendDelivery, appendIntent } from "./notification/log.js";
import { channelsToTry, type Audience } from "./notification/channels.js";
import { livePresence } from "./notification/presence.js";

/** A notification as a caller writes it: the id is assigned when absent. */
export type NotificationInput = Omit<NotificationIntent, "id"> & { id?: string | undefined };

/** Injected services (tests); omitted ones are built from the box's config. */
export interface NotifyServices {
  tg?: TelegramService | undefined;
  push?: PushService | undefined;
}

export interface NotifyRequest {
  intent: NotificationInput;
  services?: NotifyServices | undefined;
  now?: Date | undefined;
  /**
   * Restrict delivery to this one channel (`bbx notify --channel`, for
   * testing). The others are neither tried nor logged; the named channel
   * still follows the loudness and presence rules.
   */
  channel?: ChannelName | undefined;
}

export interface NotifyResult {
  id: string;
  deliveries: Delivery[];
}

async function audienceFor(boxRoot: string): Promise<{ audience: Audience; telegramChat: string | undefined }> {
  const config = await loadBoxConfig(boxRoot);
  const telegramChat = config.healthAlerts?.telegramChat;
  const webPush = (await endpointsForBox(await boxSlug(boxRoot))).length > 0;
  // APNs arrives with Track B; until then no device can be reached by it.
  return { audience: { apns: false, "web-push": webPush, telegram: telegramChat != null }, telegramChat };
}

/**
 * Which channels can currently reach the boxholder for this box: someone to
 * send to, and what a send with the same `services` needs (an injected
 * service, or else VAPID keys for web push and the bot secret for Telegram).
 * Triggers use this to decide whether a proactive alert has anywhere to go.
 */
export async function notifyChannels(
  boxRoot: string,
  opts?: { services?: NotifyServices | undefined },
): Promise<{ apns: boolean; webPush: boolean; telegram: boolean }> {
  const services = opts?.services ?? {};
  const { audience } = await audienceFor(boxRoot);
  const webPush = audience["web-push"] && (services.push !== undefined || webPushConfigured());
  const telegram = audience.telegram && (services.tg !== undefined || (await loadTelegramConfig(boxRoot)) !== null);
  return { apns: audience.apns, webPush, telegram };
}

/** Log a line; an unwritable log must not stop delivery, so it is reported and delivery goes on. */
function logSafely(write: () => void): void {
  try {
    write();
  } catch (e) {
    console.error("[notify-boxholder] could not write the notification log; delivery continues:", e);
  }
}

function emitLive(boxRoot: string, opts: { intent: NotificationIntent; url: string }): void {
  const { intent, url } = opts;
  try {
    const bus = createEventBus(boxRoot);
    try {
      bus.emit("notification", {
        id: intent.id,
        title: intent.title,
        body: intent.body,
        target: formatTarget(intent.target),
        loudness: intent.loudness,
        ...(intent.tag === undefined ? {} : { tag: intent.tag }),
        source: intent.source,
        url,
      });
    } finally {
      bus.close();
    }
  } catch (e) {
    // The bus is the live signal only; the log and the channels still carry it.
    console.warn("[notify-boxholder] could not emit the notification bus event:", e);
  }
}

interface SendContext {
  boxRoot: string;
  intent: NotificationIntent;
  url: string;
  telegramChat: string | undefined;
  services: NotifyServices;
}

async function sendWebPush(ctx: SendContext): Promise<Delivery> {
  const { boxRoot, intent, url, services } = ctx;
  try {
    const result = await sendPush(boxRoot, {
      payload: { title: intent.title, body: intent.body, url, tag: intent.tag, silent: intent.loudness === "quiet" },
      push: services.push,
    });
    if (result.sent > 0) return { channel: "web-push", status: "sent" };
    return {
      channel: "web-push",
      status: "failed",
      detail: `no device received the push (sent 0, pruned ${result.pruned}, failed ${result.failed})`,
    };
  } catch (e) {
    if (e instanceof VapidNotConfiguredError) return { channel: "web-push", status: "skipped", detail: "unconfigured" };
    return { channel: "web-push", status: "failed", detail: errorMessage(e) };
  }
}

async function telegramService(ctx: SendContext): Promise<TelegramService | null> {
  if (ctx.services.tg !== undefined) return ctx.services.tg;
  const config = await loadTelegramConfig(ctx.boxRoot);
  return config === null ? null : createTelegramService(config.botToken);
}

/** Title, body, and the link a tap opens: absolute when the server knows its public URL. */
function telegramText(intent: NotificationIntent, url: string): string {
  const link = `${getPublicUrl("").replace(/\/+$/, "")}${url}`;
  return [intent.title, ...(intent.body ? [intent.body] : []), link].join("\n");
}

async function sendTelegram(ctx: SendContext): Promise<Delivery> {
  const { intent, url, telegramChat } = ctx;
  if (telegramChat === undefined) return { channel: "telegram", status: "skipped", detail: "no-audience" };
  try {
    const tg = await telegramService(ctx);
    if (tg === null) return { channel: "telegram", status: "skipped", detail: "unconfigured" };
    await tg.sendMessage(telegramChat, { text: telegramText(intent, url), silent: intent.loudness === "quiet" });
    return { channel: "telegram", status: "sent" };
  } catch (e) {
    return { channel: "telegram", status: "failed", detail: errorMessage(e) };
  }
}

async function sendOn(channel: ChannelName, ctx: SendContext): Promise<Delivery> {
  switch (channel) {
    case "apns":
      // No APNs service until Track B; `audienceFor` never offers this channel.
      return { channel, status: "skipped", detail: "unconfigured" };
    case "web-push":
      return sendWebPush(ctx);
    case "telegram":
      return sendTelegram(ctx);
    default:
      return assertNever(channel);
  }
}

/** A leading letter, so an id is never read as a number (a URL search parser would). */
function newNotificationId(): string {
  return `n${randomBytes(6).toString("base64url")}`;
}

export async function notifyBoxholder(boxRoot: string, request: NotifyRequest): Promise<NotifyResult> {
  const now = request.now ?? getBoxTime(boxRoot);
  const services = request.services ?? {};
  const input = request.intent;
  const intent: NotificationIntent = { ...input, id: input.id ?? newNotificationId() };
  const url = targetUrl(intent.target, { boxSlug: await boxSlug(boxRoot), notificationId: intent.id });

  logSafely(() => appendIntent(boxRoot, { intent, now }));
  emitLive(boxRoot, { intent, url });

  const { audience, telegramChat } = await audienceFor(boxRoot);
  const presence = await livePresence(boxRoot, { now });
  const planned = channelsToTry({ intent, audience, presence });
  const only = request.channel;
  const plan =
    only === undefined
      ? planned
      : { channels: planned.channels.filter((c) => c === only), skipped: planned.skipped.filter((d) => d.channel === only) };
  const ctx: SendContext = { boxRoot, intent, url, telegramChat, services };
  const sent: Delivery[] = [];
  for (const channel of plan.channels) sent.push(await sendOn(channel, ctx));

  const order = (d: Delivery): number => CHANNELS.indexOf(d.channel);
  const deliveries = [...plan.skipped, ...sent].toSorted((a, b) => order(a) - order(b));
  for (const delivery of deliveries) {
    logSafely(() => appendDelivery(boxRoot, { notificationId: intent.id, delivery, now }));
  }
  return { id: intent.id, deliveries };
}
