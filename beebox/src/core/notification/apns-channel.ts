/**
 * The `apns` channel: push one intent to every paired phone with an APNs
 * registration, and log one delivery for the channel.
 *
 * `sent` when at least one phone took it; with several phones the detail
 * names the counts. A token APNs reports dead (410, BadDeviceToken) is pruned
 * from its device and the device's label is logged, never the token. Missing
 * keys are `skipped: unconfigured`, never a throw. Every send appends one line
 * to `.beebox/push-debug.log` with the loudness and target. See
 * docs/implemented-plans/notifications.md (Track B).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  createApnsService,
  createFakeApns,
  type ApnsConfig,
  type ApnsSendResult,
  type ApnsService,
} from "../../services/apns.js";
import { pruneDevicePush, type DevicePushRegistration } from "../mobile/pairing.js";
import { errorMessage } from "../../lib/error-guards.js";
import { boxSlug } from "../../lib/box-slug.js";
import { formatTarget } from "./target.js";
import { buildApnsRequest } from "./apns-payload.js";
import { FAKE_DETAIL, notifyFakeMode } from "./fake-mode.js";
import type { Delivery, NotificationIntent } from "./intent.js";

/** The topic a fake or injected service is sent with when no bundle id is configured. */
const PLACEHOLDER_BUNDLE_ID = "app.beebox.fake";

/** The APNs key and app identity from the environment, or null when any is missing. */
export function apnsConfigFromEnv(): ApnsConfig | null {
  // TODO(env-migration): lazy reads beside the "unconfigured" rule, like the VAPID keys in send-push.ts.
  const keyPath = process.env.BBX_APNS_KEY_PATH;
  const keyId = process.env.BBX_APNS_KEY_ID;
  const teamId = process.env.BBX_APNS_TEAM_ID;
  const bundleId = process.env.BBX_APNS_BUNDLE_ID;
  return keyPath && keyId && teamId && bundleId ? { keyPath, keyId, teamId, bundleId } : null;
}

/** Whether a send without an injected service can go out: the keys are set, or fake mode is on. */
export function apnsConfigured(): boolean {
  return notifyFakeMode() || apnsConfigFromEnv() !== null;
}

type Outcome = { kind: "sent" } | { kind: "pruned"; reason: string } | { kind: "failed"; error: string };

async function appendDebugLog(boxRoot: string, line: Record<string, unknown>): Promise<void> {
  const logPath = path.join(boxRoot, ".beebox", "push-debug.log");
  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, `${JSON.stringify(line)}\n`);
  } catch (e) {
    console.warn("[notify] could not write push-debug.log:", e);
  }
}

async function sendOne(opts: {
  boxRoot: string;
  service: ApnsService;
  device: DevicePushRegistration;
  request: ReturnType<typeof buildApnsRequest>;
}): Promise<Outcome> {
  const { boxRoot, service, device, request } = opts;
  let result: ApnsSendResult;
  try {
    result = await service.send({ token: device.token, environment: device.environment, ...request });
  } catch (e) {
    console.warn(`[notify] APNs push to "${device.label}" failed: ${errorMessage(e)}`);
    return { kind: "failed", error: errorMessage(e) };
  }
  if ("ok" in result) return { kind: "sent" };
  console.warn(`[notify] APNs reports the token for "${device.label}" is gone (${result.reason}); removing its registration`);
  try {
    await pruneDevicePush(boxRoot, { deviceId: device.deviceId, token: device.token });
  } catch (e) {
    console.error(`[notify] could not prune the APNs registration for "${device.label}":`, e);
  }
  return { kind: "pruned", reason: result.reason };
}

function delivery(opts: { outcomes: Outcome[]; fake: boolean }): Delivery {
  const { outcomes, fake } = opts;
  const sent = outcomes.filter((o) => o.kind === "sent").length;
  const pruned = outcomes.filter((o) => o.kind === "pruned").length;
  const failures = outcomes.flatMap((o) => (o.kind === "failed" ? [o.error] : []));
  const counts = [`sent ${sent} of ${outcomes.length}`, ...(pruned > 0 ? [`pruned ${pruned}`] : []), ...(failures.length > 0 ? [`failed ${failures.length}`] : [])].join(", ");
  if (sent > 0) {
    const parts = [...(fake ? [FAKE_DETAIL] : []), ...(outcomes.length > 1 ? [`devices: ${counts}`] : [])];
    return { channel: "apns", status: "sent", ...(parts.length > 0 ? { detail: parts.join("; ") } : {}) };
  }
  const first = failures[0];
  return { channel: "apns", status: "failed", detail: `no device received the push (${counts})${first === undefined ? "" : `: ${first}`}` };
}

export async function sendApns(opts: {
  boxRoot: string;
  intent: NotificationIntent;
  devices: DevicePushRegistration[];
  apns?: ApnsService | undefined;
}): Promise<Delivery> {
  const { boxRoot, intent, devices } = opts;
  const fake = notifyFakeMode();
  const config = apnsConfigFromEnv();
  let service: ApnsService;
  let owned = false;
  if (opts.apns !== undefined) {
    service = opts.apns;
  } else if (fake) {
    service = createFakeApns();
    owned = true;
  } else if (config !== null) {
    service = createApnsService(config);
    owned = true;
  } else {
    return { channel: "apns", status: "skipped", detail: "unconfigured" };
  }
  const request = buildApnsRequest(intent, { bundleId: config?.bundleId ?? PLACEHOLDER_BUNDLE_ID, box: await boxSlug(boxRoot) });
  const outcomes: Outcome[] = [];
  try {
    for (const device of devices) {
      const outcome = await sendOne({ boxRoot, service, device, request });
      outcomes.push(outcome);
      await appendDebugLog(boxRoot, {
        sentAt: new Date().toISOString(),
        channel: "apns",
        device: device.label,
        environment: device.environment,
        loudness: intent.loudness,
        target: formatTarget(intent.target),
        notificationId: intent.id,
        result: outcome.kind,
        ...(fake ? { fake: true } : {}),
      });
    }
  } finally {
    if (owned) await service.close();
  }
  return delivery({ outcomes, fake });
}
