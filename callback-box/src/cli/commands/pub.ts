/**
 * `cb pub` — the publication command family (Track E of
 * `docs/plans/publish-pages.md`).
 *
 * This is the CF-independent surface: `cb pub draft` renders a docs source into
 * a `box/publish/<pub-id>/` draft, runs the leak scan, prints a file-by-file
 * preview, and (on a clean or accepted scan) commits the draft to the box repo.
 * The Cloudflare-dependent subcommands (`setup`, `go`, `revoke`, `ls`,
 * `status`) attach to this same parent later; the parent is structured so they
 * slot in as siblings of `draft`.
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
        console.log("  committed to the box repo. Preview + flip live with `cb pub go` (not yet available).");
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

/**
 * The `cb pub` parent. Subcommands: `draft` (here). `setup`/`go`/`revoke`/`ls`/
 * `status` land with the Cloudflare-dependent half.
 */
export const pubCommand = new Command("pub")
  .description("Publish box content as external static pages (draft now; Cloudflare flow later)")
  .addCommand(draftCommand);
