/**
 * notifyBoxholder — the single entry point for reaching the person.
 *
 * Logs the intent, emits the live `notification` bus event for open apps,
 * decides which channels to try from loudness, audience, and presence
 * (`notification/channels.ts`), sends once per chosen channel in process, and
 * logs one delivery line per channel. No queue and no retry: a failure is a
 * `failed` line, and the notification health checks surface it. See
 * docs/implemented-plans/notifications.md (Track A).
 */

import { randomBytes } from "node:crypto";
import type { PushService } from "../services/push.js";
import type { ApnsService } from "../services/apns.js";
import { sendPush, VapidNotConfiguredError, webPushConfigured } from "./send-push.js";
import { boxSlug } from "../lib/box-slug.js";
import { getBoxTime } from "../lib/time.js";
import { errorMessage } from "../shared/error-guards.js";
import { assertNever } from "../shared/invariant.js";
import { createEventBus } from "./event-bus/core.js";
import { CHANNELS, type ChannelName, type Delivery, type NotificationIntent } from "./notification/intent.js";
import { formatTarget, targetUrl } from "./notification/target.js";
import { appendDelivery, appendIntent } from "./notification/log.js";
import { channelsToTry, type ChannelPlan } from "./notification/channels.js";
import { livePresence, type Presence } from "./notification/presence.js";
import { audienceDetail, audienceFlags, type AudienceDetail } from "./notification/audience.js";
import { apnsConfigured, sendApns } from "./notification/apns-channel/core.js";
import { FAKE_DETAIL } from "./notification/fake-mode.js";

/** A notification as a caller writes it: the id is assigned when absent. */
export type NotificationInput = Omit<NotificationIntent, "id"> & { id?: string | undefined };

/** Injected services (tests); omitted ones are built from the box's config. */
export interface NotifyServices {
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
  /**
   * The target is on screen right now (a chat callout while a web session is
   * present): every push channel is skipped `present` whatever the loudness,
   * except a `dot` on `apns`. The bus event is still emitted.
   */
  onScreen?: boolean | undefined;
}

export interface NotifyResult {
  id: string;
  deliveries: Delivery[];
  /**
   * The live event showed it in an open app: the bus event went out, someone
   * was present, the loudness has a banner (`quiet` or `loud`; a `dot` is a
   * badge only), and the send was not restricted to one channel.
   */
  shown: boolean;
}

/** Reached: a channel sent it, or an open app showed it. */
export function notificationReached(result: NotifyResult): boolean {
  return result.shown || result.deliveries.some((d) => d.status === "sent" || (d.status === "skipped" && d.detail === "present"));
}

/** A yes or no for each channel. */
export interface ChannelFlags {
  apns: boolean;
  webPush: boolean;
}

/** Whether a send on each channel has what it needs: an injected service, fake mode, or the server's keys. */
function channelsConfigured(boxRoot: string, services: NotifyServices): ChannelFlags {
  return {
    apns: services.apns !== undefined || apnsConfigured(boxRoot),
    webPush: services.push !== undefined || webPushConfigured(boxRoot),
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
  const configured = channelsConfigured(boxRoot, services);
  const reach = {
    apns: audience.apns && configured.apns,
    webPush: audience["web-push"] && configured.webPush,
  };
  return { reach, configured };
}

/**
 * Which channels can currently reach the boxholder for this box: someone to
 * send to, and what a send with the same `services` needs (an injected
 * service, or else the APNs key, VAPID keys).
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

/** Emit the live bus event for open apps; false when the bus refused it. */
function emitLive(boxRoot: string, opts: { intent: NotificationIntent; url: string }): boolean {
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
    return true;
  } catch (e) {
    // The bus is the live signal only; the log and the channels still carry it.
    console.warn("[notify-boxholder] could not emit the notification bus event:", e);
    return false;
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

async function sendOn(channel: ChannelName, ctx: SendContext): Promise<Delivery> {
  switch (channel) {
    case "apns":
      return sendApns({ boxRoot: ctx.boxRoot, intent: ctx.intent, devices: ctx.audience.apnsDevices, apns: ctx.services.apns });
    case "web-push":
      return sendWebPush(ctx);
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
    onScreen?: boolean | undefined;
    presence?: Presence | undefined;
    configured?: ChannelFlags | undefined;
    services?: NotifyServices | undefined;
    now?: Date | undefined;
  },
): Promise<NotifyPlan> {
  const audience = await audienceDetail(boxRoot);
  const configured = opts.configured ?? channelsConfigured(boxRoot, opts.services ?? {});
  const presence = opts.presence ?? (await livePresence(boxRoot, { now: opts.now ?? getBoxTime(boxRoot) }));
  const plan = restrict(channelsToTry({ intent: opts.intent, audience: audienceFlags(audience), presence, onScreen: opts.onScreen }), opts.channel);
  return { audience, configured, presence, plan };
}

export async function notifyBoxholder(boxRoot: string, request: NotifyRequest): Promise<NotifyResult> {
  const now = request.now ?? getBoxTime(boxRoot);
  const services = request.services ?? {};
  const input = request.intent;
  const intent: NotificationIntent = { ...input, id: input.id ?? newNotificationId() };
  const url = targetUrl(intent.target, { boxSlug: await boxSlug(boxRoot), notificationId: intent.id });

  logSafely(() => appendIntent(boxRoot, { intent, now }));
  const emitted = emitLive(boxRoot, { intent, url });

  const { audience, plan, presence } = await planNotification(boxRoot, {
    intent,
    channel: request.channel,
    onScreen: request.onScreen,
    services,
    now,
  });
  const ctx: SendContext = { boxRoot, intent, url, audience, services };
  const sent: Delivery[] = [];
  for (const channel of plan.channels) sent.push(await sendOn(channel, ctx));

  const order = (d: Delivery): number => CHANNELS.indexOf(d.channel);
  const deliveries = [...plan.skipped, ...sent].toSorted((a, b) => order(a) - order(b));
  for (const delivery of deliveries) {
    logSafely(() => appendDelivery(boxRoot, { notificationId: intent.id, delivery, now }));
  }
  // A send restricted to one channel is a test of that channel: the banner does not stand in for it.
  const shown = emitted && request.channel === undefined && intent.loudness !== "dot" && presence.activeWeb > 0;
  return { id: intent.id, deliveries, shown };
}

/**
 * Where a sweep sends from: this process ({@link inProcessSender}), or the box
 * server (`cli/lib/notify-route.ts` `routedSender`), which holds the channel
 * keys a box-spawned process does not.
 */
export interface NotifySender {
  send(request: NotifyRequest): Promise<NotifyResult>;
  reach(): Promise<ChannelFlags>;
}

/** Send and read reach in this process, with `services` for any request that names none. */
export function inProcessSender(boxRoot: string, services?: NotifyServices): NotifySender {
  return {
    send: (request) => notifyBoxholder(boxRoot, { ...request, services: request.services ?? services }),
    reach: () => notifyChannels(boxRoot, { services }),
  };
}

/** The skip details the channel code writes (`notification/intent.ts`). */
const SKIP_DETAILS: ReadonlySet<string | undefined> = new Set(["present", "no-audience", "unconfigured"]);

/**
 * Whether a latch may record this send. Sent when it reached someone, or when
 * every delivery skipped `no-audience` (nobody to reach, so a retry cannot
 * help). A `failed` delivery, an `unconfigured` skip (keys missing in the
 * sending process, which a later send may not share), or an unknown skip
 * detail is not sent.
 */
export function notificationSent(result: NotifyResult): boolean {
  if (notificationReached(result)) return true;
  for (const d of result.deliveries) {
    if (d.status === "skipped" && !SKIP_DETAILS.has(d.detail)) {
      console.warn(`[notify-boxholder] unknown skip detail on ${d.channel}: ${d.detail ?? "(none)"}; treated as not sent`);
    }
  }
  return result.deliveries.every((d) => d.status === "skipped" && d.detail === "no-audience");
}

/** One line for a log: each delivery's channel, status, and detail. */
export function describeDeliveries(result: NotifyResult): string {
  const parts = result.deliveries.map((d) => `${d.channel} ${d.status}${d.detail === undefined ? "" : ` (${d.detail})`}`);
  return parts.join(", ") || "no channel tried";
}
