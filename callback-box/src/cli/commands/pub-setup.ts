/**
 * `cb pub setup` / `cb pub status` — the Cloudflare-facing halves of the `cb
 * pub` family (Track E of `docs/plans/publish-pages.md`), split from `pub.ts`
 * to keep each command module small. The logic lives in
 * `src/publish/setup.ts` / `src/publish/status.ts` behind an injectable
 * Cloudflare client; these actions wire the real client from machine-level env
 * creds and format the results.
 */

import { Command } from "commander";

import { requireBoxRoot } from "../../lib/paths.js";
import { errorMessage } from "../../lib/error-guards.js";
import { assertNever } from "../../lib/invariant.js";
import {
  accessSetupInstructions,
  setupCredsFromEnv,
  setupPublishing,
} from "../../publish/setup.js";
import { statusPublishing, type StatusReport } from "../../publish/status.js";
import {
  createCloudflareProvisioningClient,
  type CloudflareProvisioningClient,
} from "../../services/cloudflare-provisioning.js";

/** Build the real provisioning client from machine-level env creds, or `null` when unconfigured. */
function resolveProvisioningClient(): CloudflareProvisioningClient | null {
  const creds = setupCredsFromEnv();
  if (creds === null) return null;
  return createCloudflareProvisioningClient({ accountId: creds.accountId, apiToken: creds.apiToken });
}

/** Print a successful setup: what was provisioned, plus the remaining manual steps. */
function printSetupSuccess(result: Extract<Awaited<ReturnType<typeof setupPublishing>>, { ok: true }>): void {
  console.log("Publishing is provisioned.");
  console.log(`  worker:    ${result.workerName}  (version ${result.version.slice(0, 16)}…)`);
  console.log(`  bucket:    ${result.bucketName}  (${result.bucketCreated ? "created" : "already existed"})`);
  console.log(`  hostname:  https://${result.hostname}`);
  console.log("  workers.dev serving: enabled;  version-preview URLs: DISABLED (verified)");
  if (result.bucketEnvHint !== null) {
    console.log(`\nAdd to ~/.cb-publish.env so the CLI + connector can reach the bucket:\n  ${result.bucketEnvHint}`);
  }
  if (!result.accessConfigured) {
    console.log(`\n${accessSetupInstructions(result.hostname)}`);
  }
  console.log("\nNext: `cb pub draft <source> --tier <tier>` then `cb pub go <pub-id>` (interactive).");
}

export const pubSetupCommand = new Command("setup")
  .description("One-time Cloudflare provisioning: R2 bucket + Worker deploy + workers.dev hostname (idempotent, re-runnable)")
  .option("--access-team-domain <origin>", "Cloudflare Access team origin (https://<team>.cloudflareaccess.com) — after the one-time Access setup")
  .option("--access-aud <aud>", "Cloudflare Access application aud tag — after the one-time Access setup")
  .action(async (...actionArgs: [options: { accessTeamDomain?: string; accessAud?: string }, ...unknown[]]) => {
    const [options] = actionArgs;
    try {
      const result = await setupPublishing(
        { accessTeamDomain: options.accessTeamDomain, accessAud: options.accessAud },
        { client: resolveProvisioningClient() },
      );
      if (result.ok) {
        printSetupSuccess(result);
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
        case "preview-urls-enabled":
        case "no-subdomain":
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
  lines.push(`configured:  ${report.configured ? "yes" : "no (run 'cb pub setup')"}`);
  lines.push(`worker:      ${report.workerName}${report.worker === null ? "  (not deployed)" : ""}`);
  if (report.bucket !== null) lines.push(`bucket:      ${report.bucket.name}  exists: ${yn(report.bucket.exists)}`);
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
  .action(async () => {
    try {
      const boxRoot = await requireBoxRoot();
      const report = await statusPublishing({ boxRoot }, { client: resolveProvisioningClient() });
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
