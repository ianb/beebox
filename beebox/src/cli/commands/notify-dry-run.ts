/**
 * `bbx notify --dry-run`: what a send would do, printed, with nothing sent and
 * nothing logged. The same audience, presence, and channel rule as a real send
 * (`planNotification`), so a dry run is a faithful preview. From a box-spawned
 * shell the channel keys are the box server's, read through
 * `notifications.channels`, since this process has none of them. See
 * docs/implemented-plans/notifications.md ("Testability").
 */

import { planNotification, type ChannelFlags, type NotifyPlan, type NotifyServices } from "../../core/notify-boxholder.js";
import { formatTarget } from "../../core/notification/target.js";
import type { ChannelName } from "../../core/notification/intent.js";
import type { NotifyRequestParsed } from "./notify.js";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function audienceLines(plan: NotifyPlan): string[] {
  const { audience, configured } = plan;
  const unconfigured = (yes: boolean): string => (yes ? "" : " [unconfigured]");
  const devices = audience.apnsDevices.map((d) => `${d.label}, ${d.environment}`).join("; ");
  const reach: Record<ChannelName, string> = {
    apns: `${plural(audience.apnsDevices.length, "device")}${devices === "" ? "" : ` (${devices})`}${unconfigured(configured.apns)}`,
    "web-push": `${plural(audience.webPushEndpoints, "subscription")}${unconfigured(configured.webPush)}`,
    telegram: `${audience.telegramChat === undefined ? "no chat" : `chat ${audience.telegramChat}`}${unconfigured(configured.telegram)}`,
  };
  return (["apns", "web-push", "telegram"] as const).map((c) => `  ${c}: ${reach[c]}`);
}

export async function printDryRun(
  boxRoot: string,
  opts: {
    request: NotifyRequestParsed;
    tag: string | undefined;
    services: NotifyServices | undefined;
    /** The box server's reading of the channel keys, when the dry run asked it. */
    configured: ChannelFlags | undefined;
  },
): Promise<void> {
  const { request, tag, services, configured } = opts;
  const presence = request.presence === undefined ? undefined : { activeWeb: request.presence };
  const plan = await planNotification(boxRoot, { intent: request, channel: request.channel, presence, services, configured });
  const lines: string[] = [];
  for (const target of request.targets) {
    lines.push(`intent: ${request.loudness} "${request.title}" -> ${formatTarget(target)}${tag === undefined ? "" : ` (tag ${tag})`}`);
  }
  if (request.body !== "") lines.push(`body: ${request.body}`);
  const source = request.presence === undefined ? "live reading" : "--presence";
  lines.push(`presence: ${plural(plan.presence.activeWeb, "active web session")} (${source})`);
  if (plan.audience.fake) lines.push("fake mode: every channel sends through its fake (BBX_NOTIFY_FAKE)");
  lines.push("audience:", ...audienceLines(plan));
  lines.push(`would try: ${plan.plan.channels.join(", ") || "none"}`);
  const skipped = plan.plan.skipped.map((d) => `${d.channel} (${d.detail ?? d.status})`);
  lines.push(`would skip: ${skipped.join(", ") || "none"}`);
  lines.push("dry run: nothing sent, nothing logged");
  console.log(lines.join("\n"));
}
