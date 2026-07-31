/**
 * `cb pub setup` / `cb pub status` — the Cloudflare-facing halves of the `cb
 * pub` family (`docs/plans/pub-setup-wrangler.md`), split from `pub.ts` to
 * keep each command module small. The logic lives in `src/publish/setup.ts` /
 * `src/publish/status.ts` behind injectable clients; these actions resolve the
 * wrangler-login (or env) auth, wire the real clients, and format the results.
 *
 * The `--access` half takes a SETUP-ONLY Access-edit API token via hidden
 * prompt or `CB_ACCESS_SETUP_TOKEN` — never argv (shell history / process
 * list), never stored; revoking it afterwards is printed as a completion step.
 */

import { Command } from "commander";

import { requireBoxRoot } from "../../lib/paths.js";
import { errorMessage } from "../../lib/error-guards.js";
import { assertNever } from "../../lib/invariant.js";
import { resolveCloudflareAuth } from "../../publish/cloudflare-auth.js";
import { type SetupAuthBundle, setupPublishing } from "../../publish/setup.js";
import { statusPublishing, type StatusReport } from "../../publish/status.js";
import { createCloudflareAccessClient, type CloudflareAccessClient } from "../../services/cloudflare-access.js";
import { createCloudflareProvisioningClient } from "../../services/cloudflare-provisioning.js";
import { createWranglerService } from "../../services/wrangler.js";
import { promptHidden } from "../lib/prompt-hidden.js";

/** Resolve login → auth bundle, or print the precise refusal and exit. */
async function requireAuthBundle(accountId: string | undefined): Promise<SetupAuthBundle> {
  const wrangler = createWranglerService();
  const resolved = await resolveCloudflareAuth({ accountId }, { wrangler });
  if (!resolved.ok) {
    console.error(`Error: ${resolved.message}`);
    process.exit(1);
  }
  const { auth } = resolved;
  const client = createCloudflareProvisioningClient({ accountId: auth.accountId, bearer: auth.bearer });
  return { client, wrangler, accountId: auth.accountId, deployEnv: auth.deployEnv };
}

/** The setup-only Access token: env (`CB_ACCESS_SETUP_TOKEN`) or hidden prompt — never argv. */
async function resolveAccessClient(accountId: string): Promise<CloudflareAccessClient> {
  const fromEnv = process.env["CB_ACCESS_SETUP_TOKEN"];
  const apiToken =
    fromEnv !== undefined && fromEnv.length > 0
      ? fromEnv
      : await promptHidden({
          label: "Setup-only Cloudflare API token (Access: Apps and Policies + Organizations, Identity Providers, and Groups — Edit): ",
          noTtyMessage: "stdin is not an interactive terminal; pass the setup-only Access token via CB_ACCESS_SETUP_TOKEN instead.",
        });
  if (apiToken.length === 0) {
    console.error("Error: an Access-edit API token is required for --access (mint one at dash.cloudflare.com → My Profile → API Tokens; revoke it after setup).");
    process.exit(1);
  }
  return createCloudflareAccessClient({ accountId, apiToken });
}

/** Print a successful setup: what was provisioned and what (if anything) remains. */
function printSetupSuccess(result: Extract<Awaited<ReturnType<typeof setupPublishing>>, { ok: true }>, opts: { accessRan: boolean }): void {
  console.log("Publishing is provisioned.");
  console.log(`  worker:    ${result.workerName}  (version ${result.version.slice(0, 16)}…)`);
  console.log(`  content:   ${result.bucketName}  (${result.bucketCreated ? "created" : "already existed"})`);
  console.log(`  ingestion: ${result.ingestBucketName}  (${result.ingestBucketCreated ? "created" : "already existed"})`);
  console.log(`  hostname:  https://${result.hostname}`);
  console.log("  workers.dev serving: enabled;  version-preview URLs: DISABLED (verified)");
  if (result.accessProvisioned !== null) {
    const a = result.accessProvisioned;
    console.log(`  Access:    app ${a.appCreated ? "created" : "found"} (aud baked in); OTP login ${a.otpIdpCreated ? "created" : "present"}; policy ${a.policyCreated ? "attached" : "present"}; team ${a.teamDomain}`);
  }
  if (opts.accessRan) {
    console.log("\nCOMPLETION STEP: revoke the setup-only Access token now (dash.cloudflare.com → My Profile → API Tokens) — nothing stores it and nothing else needs it.");
  }
  if (!result.accessConfigured) {
    console.log("\nAccount tiers (`accounts` / `any-account`) are OPTIONAL and currently off (they fail closed; public/secret tiers work now).");
    console.log("To turn them on: re-run `cb pub setup --access` with a setup-only Access-edit API token.");
  }
  console.log("\nTo pull submissions on the server, mint an R2 token scoped to ONLY the ingestion bucket and place it on the box:");
  console.log(`  config/connectors/publish.secret.json  →  {"accountId":"${result.accountId}","bucket":"${result.ingestBucketName}","apiToken":"<ingestion-bucket-scoped token>"}`);
  console.log("\nNext: `cb pub draft <source> --tier <tier>` then `cb pub go <pub-id>` (interactive).");
}

export const pubSetupCommand = new Command("setup")
  .description("One-time Cloudflare provisioning via the wrangler login: R2 buckets + Worker deploy + optional Access (idempotent, re-runnable)")
  .option("--access", "Provision Cloudflare Access for the account tiers via the API (prompts for a setup-only Access-edit token)")
  .option("--account-id <id>", "Cloudflare account to act on (required when the wrangler login can see several)")
  .option("--access-team-domain <origin>", "Manual override: Access team origin (https://<team>.cloudflareaccess.com)")
  .option("--access-aud <aud>", "Manual override: Access application aud tag")
  .action(async (...actionArgs: [options: { access?: boolean; accountId?: string; accessTeamDomain?: string; accessAud?: string }, ...unknown[]]) => {
    const [options] = actionArgs;
    try {
      const boxRoot = await requireBoxRoot();
      const auth = await requireAuthBundle(options.accountId);
      const access = options.access === true ? await resolveAccessClient(auth.accountId) : undefined;
      const result = await setupPublishing(
        { accessTeamDomain: options.accessTeamDomain, accessAud: options.accessAud },
        { boxRoot, auth, access },
      );
      if (result.ok) {
        printSetupSuccess(result, { accessRan: access !== undefined });
        return;
      }
      switch (result.reason) {
        case "deploy-failed":
          console.error(result.output);
          console.error(`\nError: ${result.message}`);
          break;
        case "unconfigured":
        case "invalid-access-flags":
        case "bucket-mismatch":
        case "unsafe-config":
        case "no-subdomain":
        case "access-provisioning":
        case "preview-urls-enabled":
          console.error(`Error: ${result.message}`);
          break;
        default:
          assertNever(result);
      }
      process.exit(1);
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exit(1);
    }
  });

/** Render the `cb pub status` report as terminal lines. */
function formatStatusReport(report: StatusReport): string[] {
  const yn = (v: boolean): string => (v ? "yes" : "NO");
  const lines: string[] = [];
  lines.push(`configured:  ${report.configured ? "yes" : "no (run 'wrangler login' then 'cb pub setup')"}`);
  lines.push(`worker:      ${report.workerName}${report.worker === null ? "  (not deployed)" : ""}`);
  if (report.bucket !== null) lines.push(`content:     ${report.bucket.name}  exists: ${yn(report.bucket.exists)}`);
  if (report.ingestBucket !== null) lines.push(`ingestion:   ${report.ingestBucket.name}  exists: ${yn(report.ingestBucket.exists)}`);
  if (report.worker !== null) {
    lines.push(`bindings:    PUB_STORE: ${yn(report.worker.hasStoreBinding)}   Access vars: ${report.worker.accessConfigured ? "set (account tiers live)" : "unset (account tiers fail closed)"}`);
  }
  if (report.routing !== null) {
    lines.push(`routing:     workers.dev: ${report.routing.enabled ? "enabled" : "DISABLED"}   preview URLs: ${report.routing.previewsEnabled ? "ENABLED (leak surface!)" : "disabled"}`);
  }
  if (report.hostname !== null) lines.push(`hostname:    https://${report.hostname}`);
  const v = report.version;
  lines.push(
    `version:     committed ${v.local.slice(0, 16)}…   deployed ${v.deployed === null ? "(unknown)" : `${v.deployed.slice(0, 16)}…`}   drift: ${v.drift ? "YES" : "no"}`,
  );
  const p = report.pubs;
  lines.push(`local pubs:  ${p.draft} draft, ${p.live} live, ${p.revoked} revoked${p.invalid > 0 ? `, ${p.invalid} INVALID` : ""}`);
  return lines;
}

export const pubStatusCommand = new Command("status")
  .description("Report the deployed publishing state and flag drift between the committed Worker and what's deployed")
  .option("--account-id <id>", "Cloudflare account to act on (required when the wrangler login can see several)")
  .action(async (...actionArgs: [options: { accountId?: string }, ...unknown[]]) => {
    const [options] = actionArgs;
    try {
      const boxRoot = await requireBoxRoot();
      const wrangler = createWranglerService();
      const resolved = await resolveCloudflareAuth({ accountId: options.accountId }, { wrangler });
      const client = resolved.ok
        ? createCloudflareProvisioningClient({ accountId: resolved.auth.accountId, bearer: resolved.auth.bearer })
        : null;
      const report = await statusPublishing({ boxRoot }, { client });
      for (const line of formatStatusReport(report)) console.log(line);
      if (report.problems.length > 0) {
        console.error(`\n${report.problems.length} problem(s):`);
        for (const problem of report.problems) console.error(`  - ${problem}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exit(1);
    }
  });
