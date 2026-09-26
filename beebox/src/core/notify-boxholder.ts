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
import { loadTelegramConfig } from "../connectors/telegram-helpers.js";
import { createFakeTelegram, createTelegramService, type TelegramService } from "../services/telegram.js";
import type { PushService } from "../services/push.js";
import type { ApnsService } from "../services/apns.js";
import { sendPush, VapidNotConfiguredError, webPushConfigured } from "./send-push.js";
import { boxSlug } from "../lib/box-slug.js";
import { getBoxTime } from "../lib/time.js";
import { getPublicUrl } from "../lib/public-url.js";
import { errorMessage } from "../lib/error-guards.js";
import { assertNever } from "../lib/invariant.js";
import { createEventBus } from "./event-bus.js";
import { CHANNELS, type ChannelName, type Delivery, type NotificationIntent } from "./notification/intent.js";
import { formatTarget, targetUrl } from "./notification/target.js";
import { appendDelivery, appendIntent } from "./notification/log.js";
import { channelsToTry, type ChannelPlan } from "./notification/channels.js";
import { livePresence, type Presence } from "./notification/presence.js";
import { audienceDetail, audienceFlags, type AudienceDetail } from "./notification/audience.js";
import { apnsConfigured, sendApns } from "./notification/apns-channel.js";
import { FAKE_DETAIL } from "./notification/fake-mode.js";

/** A notification as a caller writes it: the id is assigned when absent. */
export type NotificationInput = Omit<NotificationIntent, "id"> & { id?: string | undefined };

/** Injected services (tests); omitted ones are built from the box's config. */
export interface NotifyServices {
  tg?: TelegramService | undefined;
  push?: PushService | undefined;
  apns?: ApnsService | undefined;
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

/** A yes or no for each channel. */
export interface ChannelFlags {
  apns: boolean;
  webPush: boolean;
  telegram: boolean;
}

/** Whether a send on each channel has what it needs: an injected service, fake mode, or the server's keys. */
async function channelsConfigured(boxRoot: string, opts: { services: NotifyServices; fake: boolean }): Promise<ChannelFlags> {
  const { services, fake } = opts;
  return {
    apns: services.apns !== undefined || apnsConfigured(),
    webPush: services.push !== undefined || webPushConfigured(),
    telegram: services.tg !== undefined || fake || (await loadTelegramConfig(boxRoot)) !== null,
  };
}

/**
 * Which channels can reach the boxholder (`reach`: someone to send to, and
 * what a send needs), and which have what a send needs regardless of audience
 * (`configured`). The second is what `bbx notify --dry-run` reports when it
 * asks the box server, whose keys the CLI process does not have.
 */
export async function notifyChannelsDetail(
  boxRoot: string,
  opts?: { services?: NotifyServices | undefined },
): Promise<{ reach: ChannelFlags; configured: ChannelFlags }> {
  const services = opts?.services ?? {};
  const detail = await audienceDetail(boxRoot);
  const audience = audienceFlags(detail);
  const configured = await channelsConfigured(boxRoot, { services, fake: detail.fake });
  const reach = {
    apns: audience.apns && configured.apns,
    webPush: audience["web-push"] && configured.webPush,
    telegram: audience.telegram && configured.telegram,
  };
  return { reach, configured };
}

/**
 * Which channels can currently reach the boxholder for this box: someone to
 * send to, and what a send with the same `services` needs (an injected
 * service, or else the APNs key, VAPID keys, and the bot secret).
 * Triggers use this to decide whether a proactive alert has anywhere to go.
 */
export async function notifyChannels(boxRoot: string, opts?: { services?: NotifyServices | undefined }): Promise<ChannelFlags> {
  return (await notifyChannelsDetail(boxRoot, opts)).reach;
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
  audience: AudienceDetail;
  services: NotifyServices;
}

/** A send that went through fake mode says so in the log. */
function sentDelivery(channel: ChannelName, ctx: SendContext): Delivery {
  return ctx.audience.fake ? { channel, status: "sent", detail: FAKE_DETAIL } : { channel, status: "sent" };
}

async function sendWebPush(ctx: SendContext): Promise<Delivery> {
  const { boxRoot, intent, url, services } = ctx;
  try {
    const result = await sendPush(boxRoot, {
      payload: { title: intent.title, body: intent.body, url, tag: intent.tag, silent: intent.loudness === "quiet" },
      push: services.push,
    });
    if (result.sent > 0) return sentDelivery("web-push", ctx);
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
  if (ctx.audience.fake) return createFakeTelegram({ username: "fake-bot" });
  const config = await loadTelegramConfig(ctx.boxRoot);
  return config === null ? null : createTelegramService(config.botToken);
}

/** Title, body, and the link a tap opens: absolute when the server knows its public URL. */
function telegramText(intent: NotificationIntent, url: string): string {
  const link = `${getPublicUrl("").replace(/\/+$/, "")}${url}`;
  return [intent.title, ...(intent.body ? [intent.body] : []), link].join("\n");
}

async function sendTelegram(ctx: SendContext): Promise<Delivery> {
  const { intent, url } = ctx;
  const telegramChat = ctx.audience.telegramChat;
  if (telegramChat === undefined) return { channel: "telegram", status: "skipped", detail: "no-audience" };
  try {
    const tg = await telegramService(ctx);
    if (tg === null) return { channel: "telegram", status: "skipped", detail: "unconfigured" };
    await tg.sendMessage(telegramChat, { text: telegramText(intent, url), silent: intent.loudness === "quiet" });
    return sentDelivery("telegram", ctx);
  } catch (e) {
    return { channel: "telegram", status: "failed", detail: errorMessage(e) };
  }
}

async function sendOn(channel: ChannelName, ctx: SendContext): Promise<Delivery> {
  switch (channel) {
    case "apns":
      return sendApns({ boxRoot: ctx.boxRoot, intent: ctx.intent, devices: ctx.audience.apnsDevices, apns: ctx.services.apns });
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

/** What a send would do, without sending: `bbx notify --dry-run`. */
export interface NotifyPlan {
  audience: AudienceDetail;
  configured: ChannelFlags;
  presence: Presence;
  plan: ChannelPlan;
}

function restrict(plan: ChannelPlan, only: ChannelName | undefined): ChannelPlan {
  if (only === undefined) return plan;
  return { channels: plan.channels.filter((c) => c === only), skipped: plan.skipped.filter((d) => d.channel === only) };
}

/**
 * Read the audience and presence and decide the channels, exactly as a send
 * would, and send nothing and log nothing. `presence` overrides the reading;
 * `configured` replaces this process's reading of the keys with another
 * process's (the box server's, for a dry run that asked it).
 */
export async function planNotification(
  boxRoot: string,
  opts: {
    intent: { loudness: NotificationIntent["loudness"] };
    channel?: ChannelName | undefined;
    presence?: Presence | undefined;
    configured?: ChannelFlags | undefined;
    services?: NotifyServices | undefined;
    now?: Date | undefined;
  },
): Promise<NotifyPlan> {
  const audience = await audienceDetail(boxRoot);
  const configured = opts.configured ?? (await channelsConfigured(boxRoot, { services: opts.services ?? {}, fake: audience.fake }));
  const presence = opts.presence ?? (await livePresence(boxRoot, { now: opts.now ?? getBoxTime(boxRoot) }));
  const plan = restrict(channelsToTry({ intent: opts.intent, audience: audienceFlags(audience), presence }), opts.channel);
  return { audience, configured, presence, plan };
}

export async function notifyBoxholder(boxRoot: string, request: NotifyRequest): Promise<NotifyResult> {
  const now = request.now ?? getBoxTime(boxRoot);
  const services = request.services ?? {};
  const input = request.intent;
  const intent: NotificationIntent = { ...input, id: input.id ?? newNotificationId() };
  const url = targetUrl(intent.target, { boxSlug: await boxSlug(boxRoot), notificationId: intent.id });

  logSafely(() => appendIntent(boxRoot, { intent, now }));
  emitLive(boxRoot, { intent, url });

  const { audience, plan } = await planNotification(boxRoot, { intent, channel: request.channel, services, now });
  const ctx: SendContext = { boxRoot, intent, url, audience, services };
  const sent: Delivery[] = [];
  for (const channel of plan.channels) sent.push(await sendOn(channel, ctx));

  const order = (d: Delivery): number => CHANNELS.indexOf(d.channel);
  const deliveries = [...plan.skipped, ...sent].toSorted((a, b) => order(a) - order(b));
  for (const delivery of deliveries) {
    logSafely(() => appendDelivery(boxRoot, { notificationId: intent.id, delivery, now }));
  }
  return { id: intent.id, deliveries };
}
