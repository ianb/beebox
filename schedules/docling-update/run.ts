/**
 * Docling currency watch: compare the pinned Docling release against the newest
 * release on PyPI and alert once when a *settled* newer one exists.
 *
 * It NEVER changes anything — not the pin, not the deploy script, not a card.
 * Upgrading Docling means re-reading `docling convert --help` and re-extracting
 * a sample document (scanner-ingest-docling-decisions.md, D3), which is
 * judgment work for a human or an agent, not a version bump. That is why this
 * schedule has no `workstream:`: its whole product is the alert.
 *
 * Two conditions must hold before it says anything:
 *   1. the newest PyPI release is above our pin, and
 *   2. that release is more than SETTLING_DAYS old.
 * The settling window keeps us off day-one releases — Docling ships often and
 * yanks/patches within days, and a document extractor's regressions land in
 * stored card content where they are expensive to notice.
 *
 * A run with nothing to say exits 0 in silence: routine-success chatter is a
 * bug (root CLAUDE.md), and the store's `lastRunAt` is the record that it ran.
 *
 * Was `bin/check-docling-update.ts`, which piggybacked the SDK job's launchd
 * plist and printed into its log.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execa } from "execa";

const SCHEDULE_DIR = import.meta.dirname;
const REPO_ROOT = path.resolve(SCHEDULE_DIR, "..", "..");

/**
 * The pin's single source of truth (see the file's own header). Parsed rather
 * than imported: this script lives in the monorepo root's TypeScript project,
 * which deliberately excludes `beebox/`.
 */
const VERSION_FILE = path.join(REPO_ROOT, "beebox", "src", "services", "docling-version.ts");

/** How old a release must be before we suggest it. */
const SETTLING_DAYS = 14;

const PYPI_URL = "https://pypi.org/pypi/docling/json";

function pinnedVersion(): string {
  const source = fs.readFileSync(VERSION_FILE, "utf-8");
  const match = /^export const DOCLING_VERSION = "([^"]+)";$/mu.exec(source);
  if (match?.[1] === undefined) {
    // A refusal, not a report: the pin is the whole comparison, so a file that
    // no longer declares it is a broken watch, and the runner's `failed` alert
    // (non-zero exit) is the right answer rather than a silent exit 0.
    process.stderr.write(`docling-update: no DOCLING_VERSION declaration in ${VERSION_FILE}\n`);
    process.exit(2);
  }
  return match[1];
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let i = 0; i < Math.max(leftParts.length, rightParts.length); i += 1) {
    const difference = (leftParts[i] ?? 0) - (rightParts[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface PypiLatest {
  version: string;
  uploadedAt: Date;
}

/** Newest non-prerelease on PyPI, with the upload time of its first file. A
 *  registry that answers something unexpected is a skipped run, not a failed
 *  one: PyPI being down for an hour is not news about Docling. */
async function latestRelease(): Promise<PypiLatest | null> {
  const response = await fetch(PYPI_URL);
  if (!response.ok) {
    console.log(`docling-update: PyPI returned ${String(response.status)} for ${PYPI_URL}; skipping this run`);
    return null;
  }
  // Parse boundary: the registry's JSON arrives untyped, and only these two
  // fields are read — a shape change surfaces as the guarded checks below.
  const payload: unknown = await response.json();
  const info = isRecord(payload) ? payload["info"] : undefined;
  const version = isRecord(info) ? info["version"] : undefined;
  const releases = isRecord(payload) ? payload["releases"] : undefined;
  if (typeof version !== "string" || !isRecord(releases)) {
    console.log("docling-update: unexpected PyPI payload shape; skipping this run");
    return null;
  }
  const files = releases[version];
  const first = Array.isArray(files) ? files[0] : undefined;
  const uploaded = isRecord(first) ? first["upload_time_iso_8601"] : undefined;
  if (typeof uploaded !== "string") {
    console.log(`docling-update: PyPI reports no upload time for docling ${version}; skipping this run`);
    return null;
  }
  return { version, uploadedAt: new Date(uploaded) };
}

/** The one report this schedule can make. Under `SCHEDULE_DRY_RUN` the alert
 *  is printed instead of recorded — `bin/schedules alert` would swallow it the
 *  same way, but saying it here is what makes a dry run readable. */
async function alert(report: { title: string; message: string }): Promise<void> {
  if (process.env["SCHEDULE_DRY_RUN"] === "1") {
    console.log(`[docling-update] would alert (normal): ${report.title}`);
    console.log(report.message);
    return;
  }
  await execa(
    path.join(REPO_ROOT, "bin", "schedules"),
    ["alert", "--priority", "normal", "--title", report.title, "--message", report.message],
    { stdio: "inherit" },
  );
}

const pinned = pinnedVersion();
const latest = await latestRelease();
if (latest === null) process.exit(0);

if (compareVersions(latest.version, pinned) <= 0) process.exit(0);

const ageDays = (Date.now() - latest.uploadedAt.getTime()) / 86_400_000;
if (ageDays <= SETTLING_DAYS) process.exit(0);

await alert({
  title: `docling ${latest.version} is available (pinned: ${pinned})`,
  message:
    `Released ${String(Math.floor(ageDays))} days ago, past the ${String(SETTLING_DAYS)}-day settling window.`
    + " Upgrading is manual: re-read `docling convert --help` for flag changes, bump DOCLING_VERSION in"
    + " beebox/src/services/docling-version.ts, then `bbx pdf reanalyze` a sample document and diff"
    + " (beebox/docs/plans/scanner-ingest-docling-decisions.md, D3).",
});
