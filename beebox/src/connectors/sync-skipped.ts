/**
 * Builders for the two ways a Google connector declines to sync.
 *
 * Gmail, Calendar and Drive each reach the same two dead ends — the box policy
 * has the service off, or `getGoogleAuth` found nothing this process can read —
 * and each used to report them differently (empty success, empty success, hard
 * failure). These builders give all three one shape, so `SyncResult.skipped`
 * means the same thing whoever produced it.
 */

import type { GoogleServiceName } from "../core/box/config.js";
import { explainGoogleAuthGap } from "./google-auth-gap.js";
import type { SyncResult, SyncSkipped } from "./index.js";

/** The box's own policy has this service switched off. */
export function serviceNotAllowed(service: GoogleServiceName): SyncSkipped {
  return {
    reason: "not-allowed",
    detail: `Enable it in box settings (\`googleServices.${service}\` in \`_config/box.json\`)`,
  };
}

/**
 * No Google credential this process can use. The detail is
 * `explainGoogleAuthGap`'s relay-ready account of which piece is missing —
 * "run google-auth" is right for only one of the four causes.
 */
export async function serviceNotConfigured(boxRoot: string): Promise<SyncSkipped> {
  return { reason: "not-configured", detail: await explainGoogleAuthGap(boxRoot) };
}

/** A successful sync that deliberately did nothing. */
export function skippedSync(skipped: SyncSkipped): SyncResult {
  return { success: true, created: [], updated: [], skipped };
}
