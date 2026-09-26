/**
 * The APNs request for one notification intent: the JSON body and the
 * headers. Pure. The custom keys beside `aps` (`target`, `loudness`,
 * `notificationId`) are read by the iOS client, so they are contract
 * (docs/mobile-contract.md §5.10).
 *
 * - `dot`: a badge only. No alert and no sound, so no banner.
 * - `quiet`: a banner at interruption level `passive` (no sound, no wake).
 * - `loud`: a banner with the default sound at level `active`.
 *
 * All three are push type `alert`, the type that covers badge changes; the
 * badge is always 1 because the box keeps no unread count. See
 * docs/plans/notifications.md (Track B).
 */

import { createHash } from "node:crypto";
import { assertNever } from "../../lib/invariant.js";
import type { ApnsHeaders } from "../../services/apns.js";
import type { NotificationIntent } from "./intent.js";
import { formatTarget } from "./target.js";

export interface ApnsRequestParts {
  payload: Record<string, unknown>;
  headers: ApnsHeaders;
}

function aps(intent: NotificationIntent): Record<string, unknown> {
  const alert = { title: intent.title, body: intent.body };
  switch (intent.loudness) {
    case "dot":
      return { badge: 1 };
    case "quiet":
      return { alert, "interruption-level": "passive", badge: 1 };
    case "loud":
      return { alert, "interruption-level": "active", badge: 1, sound: "default" };
    default:
      return assertNever(intent.loudness);
  }
}

/** APNs refuses a collapse id over 64 bytes; a longer tag collapses by its hash instead. */
const MAX_COLLAPSE_ID_BYTES = 64;

function collapseId(tag: string): string {
  if (Buffer.byteLength(tag, "utf-8") <= MAX_COLLAPSE_ID_BYTES) return tag;
  return createHash("sha256").update(tag).digest("hex");
}

export function buildApnsRequest(intent: NotificationIntent, opts: { bundleId: string }): ApnsRequestParts {
  const target = formatTarget(intent.target);
  const payload: Record<string, unknown> =
    intent.loudness === "dot"
      ? { aps: aps(intent), target, notificationId: intent.id }
      : { aps: aps(intent), target, loudness: intent.loudness, notificationId: intent.id };
  const headers: ApnsHeaders = {
    "apns-push-type": "alert",
    "apns-topic": opts.bundleId,
    ...(intent.tag === undefined ? {} : { "apns-collapse-id": collapseId(intent.tag) }),
  };
  return { payload, headers };
}
