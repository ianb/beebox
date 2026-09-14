/**
 * The Drive service, or the reason there isn't one.
 *
 * Two surfaces need this answer and must give the same one: the tRPC router
 * (which renders it as FORBIDDEN / PRECONDITION_FAILED for the settings page
 * and for a delegating agent) and `bbx drive` running in-process under the
 * tooling profile. A `Result` rather than a throw because the callers branch
 * on *which* of the two gaps it is — one is a box-policy switch, the other an
 * authorization — and both are the boxholder's to close, in different places.
 */

import { getGoogleAuth } from "./google-auth.js";
import { explainGoogleAuthGap } from "./google-auth-gap.js";
import { isGoogleServiceAllowed } from "../core/box/config.js";
import { createGoogleAuthService } from "../services/google-auth.js";
import { createGoogleDriveService } from "../services/google-drive.js";
import type { GoogleDriveService } from "../services/google-drive.js";
import { err, ok, type Result } from "../lib/result.js";

/**
 * The message for a box with Drive switched off. It names the agent's own way
 * to turn it on, because the boxholder decided (2026-09-14) the agent may do
 * that when asked — the refusal is the only place that instruction is guaranteed
 * to reach whoever hit the wall.
 */
export const DRIVE_NOT_ENABLED_MESSAGE =
  "Drive is not enabled for this box. Set `googleServices.drive: true` in " +
  "`_config/box.json` (you may do this when the boxholder asks for Drive), or " +
  "enable it in box settings.";

/** Why no Drive service. Both arms are the boxholder's to fix. */
export type DriveAccessProblem =
  | { kind: "not-enabled"; message: string }
  | { kind: "auth-gap"; message: string };

/** Build a Drive service for this box, or say which gate refused. */
export async function resolveDriveService(
  boxRoot: string,
): Promise<Result<GoogleDriveService, DriveAccessProblem>> {
  if (!(await isGoogleServiceAllowed(boxRoot, "drive"))) {
    return err({ kind: "not-enabled", message: DRIVE_NOT_ENABLED_MESSAGE });
  }
  const grant = await getGoogleAuth(boxRoot);
  if (grant === null) {
    return err({ kind: "auth-gap", message: await explainGoogleAuthGap(boxRoot) });
  }
  return ok(createGoogleDriveService(createGoogleAuthService(grant, { boxRoot })));
}

/** Whether a Drive write would find a service, without building one. */
export async function driveServiceAvailable(boxRoot: string): Promise<boolean> {
  if (!(await isGoogleServiceAllowed(boxRoot, "drive"))) return false;
  return (await getGoogleAuth(boxRoot)) !== null;
}
