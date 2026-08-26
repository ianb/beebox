/**
 * Send a Web Push notification to every endpoint opted into a box.
 *
 * Resolves the box's subscriptions from the server-level store, sends via the
 * injected-or-real PushService, and prunes endpoints the push service reports
 * gone (404/410). Returns counts; it does NOT throw for per-endpoint transient
 * failures (the caller decides what a zero-delivery means — the push connector
 * stamps its card `failed`). A missing VAPID config is a setup error that
 * affects every send, so that throws.
 *
 * Every call appends a payload-only line to the box's gitignored
 * `.callback-box/push-debug.log` (no endpoints or keys) so triggers are
 * inspectable even with zero real subscribers. `CB_PUSH_FAKE=1` routes through
 * a fake service (and a synthetic endpoint when none are subscribed), so any
 * trigger can be exercised on desktop with no setup. See
 * docs/plans/web-push-notifications.md (Track B).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  createPushService,
  createFakePush,
  type PushService,
  type PushPayload,
  type StoredPushSubscription,
} from "../services/push.js";
import { endpointsForBox, removeEndpoint } from "./push-subscriptions.js";
import { errorMessage } from "../lib/error-guards.js";
import { boxSlug as resolveBoxSlug } from "../lib/box-slug.js";

export interface SendPushResult {
  sent: number;
  pruned: number;
  failed: number;
}

/** Thrown when a real push send is attempted without VAPID keys configured. */
export class VapidNotConfiguredError extends Error {
  constructor() {
    super("VAPID keys are not configured (set CB_VAPID_PUBLIC_KEY and CB_VAPID_PRIVATE_KEY)");
    this.name = "VapidNotConfiguredError";
  }
}

/** The configured VAPID public key, or null if push isn't set up on this server. */
export function vapidPublicKey(): string | null {
  return process.env.CB_VAPID_PUBLIC_KEY ?? null;
}

function realPushFromEnv(): PushService {
  // TODO(env-migration): CB_VAPID_* are validated + redacted at startup
  // (lib/env.ts serverEnvSchema); the reads stay here alongside the
  // "throw if unconfigured" logic that a schema shouldn't own.
  const publicKey = process.env.CB_VAPID_PUBLIC_KEY;
  const privateKey = process.env.CB_VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw new VapidNotConfiguredError();
  // VAPID subject must be a mailto: or https: contact URI; the server's public
  // URL is a valid one and avoids hardcoding any address.
  const subject = process.env.CB_VAPID_SUBJECT ?? process.env.PUBLIC_URL ?? "mailto:callback@localhost";
  return createPushService({ publicKey, privateKey, subject });
}

const SYNTHETIC_ENDPOINT = "fake://synthetic";

async function appendDebugLog(boxRoot: string, line: Record<string, unknown>): Promise<void> {
  const logPath = path.join(boxRoot, ".callback-box", "push-debug.log");
  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, `${JSON.stringify(line)}\n`);
  } catch (e) {
    console.warn("Could not write push-debug.log:", e);
  }
}

export async function sendPush(
  boxRoot: string,
  opts: { payload: PushPayload; push?: PushService | undefined },
): Promise<SendPushResult> {
  const boxSlug = await resolveBoxSlug(boxRoot);
  // The sending box's own mark, unless a caller chose one. Filled in here
  // rather than at each call site: a caller knows what it is announcing, not
  // which box's icon should carry it. The route falls back to the shared icon
  // for a box with no mark, so this is safe to set unconditionally.
  const payload: PushPayload = { icon: `/${boxSlug}/icon-192.png`, ...opts.payload };
  const forceFake = process.env.CB_PUSH_FAKE === "1";
  const push = opts.push ?? (forceFake ? createFakePush() : realPushFromEnv());

  let endpoints = await endpointsForBox(boxSlug);
  // Forced-fake dev mode still produces a debug line when nobody is subscribed.
  if (forceFake && endpoints.length === 0) {
    const synthetic: StoredPushSubscription = {
      endpoint: SYNTHETIC_ENDPOINT,
      keys: { p256dh: "synthetic", auth: "synthetic" },
    };
    endpoints = [synthetic];
  }

  let sent = 0;
  let pruned = 0;
  let failed = 0;
  for (const subscription of endpoints) {
    try {
      const result = await push.send(subscription, payload);
      if ("gone" in result) {
        await removeEndpoint(subscription.endpoint);
        pruned++;
      } else {
        sent++;
      }
    } catch (e) {
      failed++;
      console.warn(`Push send failed for an endpoint in ${boxSlug}:`, errorMessage(e));
    }
  }

  await appendDebugLog(boxRoot, {
    sentAt: new Date().toISOString(),
    boxSlug,
    title: payload.title,
    body: payload.body,
    url: payload.url,
    tag: payload.tag,
    sent,
    pruned,
    failed,
  });

  return { sent, pruned, failed };
}
