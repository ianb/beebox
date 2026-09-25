/**
 * A Google service, or the reason there isn't one.
 *
 * Two surfaces need this answer and must give the same one: the tRPC routers
 * (which render it as FORBIDDEN / PRECONDITION_FAILED for the settings page and
 * for a delegating agent) and the `bbx` verbs running in-process under the
 * tooling profile. A `Result` rather than a throw because the callers branch on
 * *which* of the two gaps it is — one is a box-policy switch, the other an
 * authorization — and both are the boxholder's to close, in different places.
 *
 * One module for all three services: the gates are identical (`googleServices`
 * in `_config/box.json`, then the OAuth grant), and the 2026-09-14 incident was
 * about a family that had its own copy of them
 * (`docs/plans/agent-capability-delegation.md`).
 */

import { getGoogleAuth } from "./google-auth.js";
import { explainGoogleAuthGap } from "./google-auth-gap.js";
import { isGoogleServiceAllowed, type GoogleServiceName } from "../core/box/config.js";
import { createGoogleAuthService, type GoogleAuthService } from "../services/google-auth.js";
import { createGoogleCalendarService, type GoogleCalendarService } from "../services/google-calendar.js";
import { createGoogleDriveService, type GoogleDriveService } from "../services/google-drive.js";
import { createGoogleGmailService, type GoogleGmailService } from "../services/google-gmail.js";
import { err, ok, type Result } from "../lib/result.js";

/**
 * The message for a box with a service switched off. It names the agent's own
 * way to turn it on, because the boxholder decided (2026-09-14) the agent may
 * do that when asked — the refusal is the only place that instruction is
 * guaranteed to reach whoever hit the wall.
 */
export function serviceNotEnabledMessage(service: GoogleServiceName): string {
  return (
    `${LABELS[service]} is not enabled for this box. Set \`googleServices.${service}: true\` in ` +
    `\`_config/box.json\` (you may do this when the boxholder asks for ${LABELS[service]}), or ` +
    "enable it in box settings."
  );
}

const LABELS: Record<GoogleServiceName, string> = {
  drive: "Drive",
  calendar: "Calendar",
  gmail: "Gmail",
};

/** Why no service. Both arms are the boxholder's to fix. */
export type GoogleAccessProblem =
  | { kind: "not-enabled"; message: string }
  | { kind: "auth-gap"; message: string };

/**
 * The authorized Google client for one service, or which gate refused. Every
 * per-service resolver below is this plus one constructor.
 */
export async function resolveGoogleAuth(
  boxRoot: string,
  service: GoogleServiceName,
): Promise<Result<GoogleAuthService, GoogleAccessProblem>> {
  if (!(await isGoogleServiceAllowed(boxRoot, service))) {
    return err({ kind: "not-enabled", message: serviceNotEnabledMessage(service) });
  }
  const grant = await getGoogleAuth(boxRoot);
  if (grant === null) {
    return err({ kind: "auth-gap", message: await explainGoogleAuthGap(boxRoot) });
  }
  return ok(createGoogleAuthService(grant, { boxRoot }));
}

/** Build a Drive service for this box, or say which gate refused. */
export async function resolveDriveService(
  boxRoot: string,
): Promise<Result<GoogleDriveService, GoogleAccessProblem>> {
  const auth = await resolveGoogleAuth(boxRoot, "drive");
  return auth.ok ? ok(createGoogleDriveService(auth.value)) : auth;
}

/** Build a Calendar service for this box, or say which gate refused. */
export async function resolveCalendarService(
  boxRoot: string,
): Promise<Result<GoogleCalendarService, GoogleAccessProblem>> {
  const auth = await resolveGoogleAuth(boxRoot, "calendar");
  return auth.ok ? ok(createGoogleCalendarService(auth.value)) : auth;
}

/** Build a Gmail service for this box, or say which gate refused. */
export async function resolveGmailService(
  boxRoot: string,
): Promise<Result<GoogleGmailService, GoogleAccessProblem>> {
  const auth = await resolveGoogleAuth(boxRoot, "gmail");
  return auth.ok ? ok(createGoogleGmailService(auth.value)) : auth;
}

/** Whether a Drive write would find a service, without building one. */
export async function driveServiceAvailable(boxRoot: string): Promise<boolean> {
  if (!(await isGoogleServiceAllowed(boxRoot, "drive"))) return false;
  return (await getGoogleAuth(boxRoot)) !== null;
}
