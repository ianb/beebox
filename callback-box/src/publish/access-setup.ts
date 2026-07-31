/**
 * Access provisioning for the account (`/a/`) tiers — the API replacement for
 * the retired dashboard-walkthrough prose (`docs/implemented-plans/pub-setup-wrangler.md`).
 *
 * Runs only inside an interactive `cb pub setup --access` with a setup-only
 * Access-edit token (plan fork 2). The sequence converges on rerun instead of
 * duplicating (amendment 7): every step is find-first, and a found-but-drifted
 * app/policy is reported as an exact refusal, never silently "fixed".
 *
 * The policy is allow-everyone-authenticated on purpose: Access only
 * AUTHENTICATES; the Worker's per-publication email allowlist is the real
 * authorization (fail-closed — an absent allowlist admits nobody). The
 * One-Time PIN IdP is the default login method (fork 3): visitors need no
 * Cloudflare account, and the JWT `email` claim is the address the PIN was
 * mailed to — exactly what the Worker validates.
 */

import type { CloudflareAccessClient } from "../services/cloudflare-access.js";
import { normalizeTeamDomain } from "./publish-config.js";

/** What the deploy needs from a successful Access provisioning. */
export interface AccessProvisionOutcome {
  /** Full team origin (`https://<team>.cloudflareaccess.com`) — the Worker's `iss`. */
  teamDomain: string;
  /** The application `aud` tag the Worker pins. */
  aud: string;
  /** True when this run created the application (false: found existing). */
  appCreated: boolean;
  /** True when this run created the One-Time PIN IdP. */
  otpIdpCreated: boolean;
  /** True when this run attached the allow-everyone policy. */
  policyCreated: boolean;
}

export type AccessProvisionResult =
  | ({ ok: true } & AccessProvisionOutcome)
  | { ok: false; reason: "no-organization"; message: string }
  | { ok: false; reason: "bad-team-domain"; message: string }
  | { ok: false; reason: "app-drift"; message: string }
  | { ok: false; reason: "policy-drift"; message: string };

/** The Access application name setup creates (also the find key in error text). */
export const ACCESS_APP_NAME = "callback-box publications";

/**
 * Ensure the Zero Trust org, OTP IdP, `/a` application, and allow-everyone
 * policy exist, and return the (team domain, aud) pair the deploy bakes in.
 */
export async function ensureAccess(
  { hostname }: { hostname: string },
  deps: { access: CloudflareAccessClient },
): Promise<AccessProvisionResult> {
  const { access } = deps;

  // 1. The org must exist — Zero Trust onboarding (team-name + plan pick) is a
  // one-time dashboard step Cloudflare gives no API for. Name it precisely.
  const org = await access.getOrganization();
  if (org === null) {
    return {
      ok: false,
      reason: "no-organization",
      message: [
        "this Cloudflare account has no Zero Trust organization yet — a one-time onboarding",
        "(pick a team name; the Free plan works) has to happen in the dashboard first:",
        "  https://one.dash.cloudflare.com/",
        "then re-run `cb pub setup --access`.",
      ].join("\n"),
    };
  }
  const teamDomain = normalizeTeamDomain(org.authDomain);
  if (teamDomain === null) {
    return {
      ok: false,
      reason: "bad-team-domain",
      message: `the Access organization's auth domain '${org.authDomain}' does not normalize to https://<team>.cloudflareaccess.com — refusing to bake a broken issuer into the Worker`,
    };
  }

  // 2. One-Time PIN IdP: find-or-create by type.
  const idps = await access.listIdentityProviders();
  const otpIdpCreated = !idps.some((idp) => idp.type === "onetimepin");
  if (otpIdpCreated) await access.createOtpIdentityProvider();

  // 3. The self-hosted app protecting `<host>/a`: find-or-create, refuse drift.
  const domain = `${hostname}/a`;
  const existing = await access.findAppByDomain(domain);
  if (existing !== null && existing.type !== "self_hosted") {
    return {
      ok: false,
      reason: "app-drift",
      message: `an Access application already covers '${domain}' but has type '${existing.type}' (expected self_hosted) — fix or remove it in Cloudflare One, then re-run`,
    };
  }
  const app = existing ?? (await access.createApp({ name: ACCESS_APP_NAME, domain }));

  // 4. The allow-everyone policy: satisfied by any existing allow-everyone
  // policy; an app that has policies but none of that shape is drift we refuse
  // to "fix" silently (someone configured deliberate rules we won't override).
  const policies = await access.listAppPolicies(app.id);
  const hasEveryoneAllow = policies.some((p) => p.decision === "allow" && p.includeEveryone);
  let policyCreated = false;
  if (!hasEveryoneAllow) {
    if (policies.length > 0) {
      const shapes = policies.map((p) => `${p.name} (${p.decision}${p.includeEveryone ? ", everyone" : ""})`).join("; ");
      return {
        ok: false,
        reason: "policy-drift",
        message: `Access application '${app.name}' has policies but none is allow-everyone: ${shapes} — the Worker's per-publication allowlist expects Access to only authenticate; align the policies in Cloudflare One, then re-run`,
      };
    }
    await access.createAllowEveryonePolicy(app.id, { name: "authenticate (Worker enforces per-publication allowlists)" });
    policyCreated = true;
  }

  return { ok: true, teamDomain, aud: app.aud, appCreated: existing === null, otpIdpCreated, policyCreated };
}
