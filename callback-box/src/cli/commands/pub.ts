/**
 * `cb pub` — the publication command family (Track E of
 * `docs/plans/publish-pages.md`).
 *
 * This module holds `draft` (render + leak scan + human-gated commit, no
 * Cloudflare), `ls` (read-only), and the store-backed `revoke` / `go` (the
 * human flip). The provisioning pair — `setup` and `status` — lives in
 * `pub-setup.ts` and is attached to the same parent below.
 */

import { Command } from "commander";
import { readFileSync } from "node:fs";
import path from "node:path";

import { requireBoxRoot } from "../../lib/paths.js";
import { getBoxTime } from "../../lib/time.js";
import { getOwnerEmail } from "../../webapp/auth.js";
import { errorMessage } from "../../lib/error-guards.js";
import { isRecord } from "../../lib/is-record.js";
import { assertNever } from "../../lib/invariant.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import { tierValues, type Tier } from "../../publish/manifest.js";
import { draftPublication, type FilePreview } from "../../publish/draft.js";
import type { LeakScanResult } from "../../publish/leak-scan.js";
import {
  listPublications,
  type PublicationSummary,
  resolvePublishStore,
  revokePublication,
} from "../../publish/lifecycle.js";
import { goPublication } from "../../publish/go.js";
import { pubSetupCommand, pubStatusCommand } from "./pub-setup.js";

/** Commander accumulator for repeatable options (e.g. `--accept-leak`). */
function collect(val: string, acc: string[]): string[] {
  acc.push(val);
  return acc;
}

/** Read this package's version for the provenance `softwareVersion` stamp. */
function softwareVersion(): string {
  try {
    const pkg: unknown = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf-8"));
    const version = isRecord(pkg) ? pkg.version : undefined;
    return typeof version === "string" ? version : "0.0.0";
  } catch (_e) {
    return "0.0.0";
  }
}

const TIER_SET: ReadonlySet<string> = new Set(tierValues);

function isTier(value: string): value is Tier {
  return TIER_SET.has(value);
}

/** Print the file-by-file preview plus scan summary (both the ok and blocked paths use this). */
function printPreview(files: FilePreview[], scan: LeakScanResult): void {
  console.log("\nBundle files:");
  for (const f of files) {
    console.log(`  ${f.path}  ${f.bytes} bytes  sha256:${f.sha256.slice(0, 16)}…`);
  }
  if (scan.skippedBinaries.length > 0) {
    console.log(`\n${scan.skippedBinaries.length} binary asset(s) NOT scanned (preview them by eye):`);
    for (const p of scan.skippedBinaries) console.log(`  ${p}`);
  }
  if (scan.findings.length > 0) {
    console.log("\nLeak-scan findings:");
    for (const f of scan.findings) {
      console.log(`  [${f.id}] ${f.kind} (${f.detail}) in ${f.file}:${f.line} — ${f.match}`);
    }
  } else {
    console.log("\nLeak scan: clean.");
  }
}

const draftCommand = new Command("draft")
  .description("Render a docs source into a publication draft (renders + leak-scans; no Cloudflare)")
  .argument("<source>", "Path to the markdown docs source (.md), relative to the box root or absolute")
  .requiredOption("--tier <tier>", `Access tier: ${tierValues.join(" | ")}`)
  .option("--expires <iso|duration>", "Expiry: an ISO datetime or a duration (7d, 24h, 30m)")
  .option("--emails <csv>", "Comma-separated viewer allowlist (accounts tier only)")
  .option("--slug <slug>", "Human slug (public tier only)")
  .option("--accept-leak <id>", "Wave a specific leak-scan finding through (repeatable)", collect, [])
  .action(async (...actionArgs: [
    source: string,
    options: { tier: string; expires?: string; emails?: string; slug?: string; acceptLeak: string[] },
    ...unknown[],
  ]) => {
    const [source, options] = actionArgs;
    try {
      if (!isTier(options.tier)) {
        console.error(`Error: invalid --tier '${options.tier}' — expected one of: ${tierValues.join(", ")}`);
        process.exit(1);
      }
      const boxRoot = await requireBoxRoot();
      const emails = options.emails ? options.emails.split(",").map((e) => e.trim()).filter((e) => e.length > 0) : undefined;

      const result = await draftPublication(
        { boxRoot, source, tier: options.tier, expires: options.expires, emails, slug: options.slug, acceptLeaks: options.acceptLeak },
        { now: getBoxTime(boxRoot), ownerEmail: getOwnerEmail(), softwareVersion: softwareVersion() },
      );

      if (result.ok) {
        printPreview(result.files, result.scan);
        console.log(`\nDrafted ${result.pubId} (tier: ${result.manifest.tier}, status: draft).`);
        console.log(`  manifest: ${path.relative(boxRoot, result.manifestPath)}`);
        if (result.acceptedLeaks.length > 0) {
          console.log(`  accepted leaks: ${result.acceptedLeaks.join(", ")}`);
        }
        console.log("  committed to the box repo. Flip live with `cb pub go` (interactive).");
        return;
      }

      switch (result.reason) {
        case "invalid-flags":
        case "invalid-expires":
          console.error(`Error: ${result.message}`);
          break;
        case "leaks-blocked":
          printPreview(result.files, result.scan);
          console.error(`\nDraft BLOCKED: ${result.blocking.length} leak-scan finding(s) not accepted.`);
          console.error("Review the bytes, then re-run with --accept-leak <id> for each genuine false positive:");
          for (const f of result.blocking) console.error(`  --accept-leak ${f.id}   (${f.kind}: ${f.match})`);
          console.error("\nThe draft was written to disk for preview but NOT committed (a caught secret stays out of git history).");
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

/** Format one `cb pub ls` row. */
function formatSummaryRow(s: PublicationSummary): string {
  const detail = s.slug !== null
    ? `slug:${s.slug}`
    : s.allowedEmails !== null
      ? `emails:${s.allowedEmails.length > 0 ? s.allowedEmails.join(",") : "(none)"}`
      : "";
  return [
    `  ${s.pubId}`,
    `${s.tier}`,
    `${s.status}`,
    `expires:${s.expiresAt ?? "—"}`,
    detail,
    `← ${s.source}`,
  ].filter((part) => part.length > 0).join("  ");
}

const lsCommand = new Command("ls")
  .description("List this box's publications (read-only; no Cloudflare)")
  .action(async () => {
    try {
      const boxRoot = await requireBoxRoot();
      const summaries = await listPublications(boxRoot);
      if (summaries.length === 0) {
        console.log("No publications yet. Draft one with `cb pub draft <source> --tier <tier>`.");
        return;
      }
      console.log(`${summaries.length} publication${summaries.length === 1 ? "" : "s"}:`);
      for (const summary of summaries) console.log(formatSummaryRow(summary));
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exit(1);
    }
  });

const revokeCommand = new Command("revoke")
  .description("Revoke a live publication — tombstones it edge-side (pages + submit die together)")
  .argument("<pub-id>", "The pub-id to revoke (a revoked id is never reused)")
  .action(async (...actionArgs: [pubId: string, ...unknown[]]) => {
    const [pubId] = actionArgs;
    try {
      const boxRoot = await requireBoxRoot();
      const store = resolvePublishStore();
      if (!store) {
        console.error("Error: publishing is not configured on this box — run `cb pub setup` first.");
        process.exit(1);
      }
      const result = await revokePublication({ boxRoot, pubId }, { store });
      if (result.ok) {
        console.log(`Revoked ${result.pubId}: tombstone written edge-side (next request 410s).`);
        console.log(`  deleted ${result.deletedBundleObjects} bundle object(s)${result.deletedSlug ? " + slug pointer" : ""}; local manifest committed as revoked.`);
        return;
      }
      switch (result.reason) {
        case "unconfigured":
        case "not-found":
        case "invalid-manifest":
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

const goCommand = new Command("go")
  .description("Flip a drafted publication LIVE — the human-only flip (interactive confirmation required)")
  .argument("<pub-id>", "The drafted pub-id to publish live")
  .action(async (...actionArgs: [pubId: string, ...unknown[]]) => {
    const [pubId] = actionArgs;
    try {
      const boxRoot = await requireBoxRoot();
      const store = resolvePublishStore();
      if (!store) {
        console.error("Error: publishing is not configured on this box — run `cb pub setup` first.");
        process.exit(1);
      }
      // The default confirm is the real interactive TTY prompt (it displays the
      // preview + tier/expiry/allowlist and requires the typed pub-id).
      const result = await goPublication({ boxRoot, pubId }, { store, ownerEmail: getOwnerEmail() });
      if (result.ok) {
        console.log(`\nPublished ${result.pubId} LIVE (tier: ${result.manifest.tier}).`);
        console.log(`  uploaded ${result.uploadedBundleObjects} bundle object(s) + edge manifest${result.slugPointer ? " + slug pointer" : ""}; local manifest committed as live.`);
        return;
      }
      switch (result.reason) {
        case "leaks-blocked":
          printPreview(result.files, result.scan);
          console.error(`\nRefusing to flip live: ${result.blocking.length} leak-scan finding(s) not accepted at draft time.`);
          console.error("Re-draft accepting each genuine false positive, then `cb pub go` again.");
          break;
        case "unconfigured":
        case "not-found":
        case "invalid-manifest":
        case "not-draft":
        case "not-confirmed":
          console.error(`${result.reason === "not-confirmed" ? "" : "Error: "}${result.message}`);
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

/**
 * The `cb pub` parent. Subcommands: `setup` + `status` (in `pub-setup.ts`),
 * and `draft`, `ls`, `revoke`, `go` (here).
 */
export const pubCommand = new Command("pub")
  .description("Publish box content as external static pages (setup, draft, list, go-live, revoke, status)")
  .addCommand(pubSetupCommand)
  .addCommand(draftCommand)
  .addCommand(lsCommand)
  .addCommand(revokeCommand)
  .addCommand(goCommand)
  .addCommand(pubStatusCommand);
