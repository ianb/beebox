#!/usr/bin/env node --import tsx
/**
 * Docling currency watch (`pnpm check-docling-update`): compares the pinned
 * Docling release against the newest release on PyPI and prints one line when
 * a settled newer release exists. It NEVER changes anything — not the pin, not
 * the deploy script, not a card. Upgrading Docling means re-reading
 * `docling convert --help` and re-extracting a sample document (D3), which is
 * judgment work for a human or an agent, not a version bump.
 *
 * Why a watch at all: the pin is deliberate (unpinned, `uvx docling` silently
 * resolves whatever is newest and extraction output drifts between two runs of
 * the same document), and a deliberate pin goes stale silently. This is the
 * counterweight.
 *
 * Two conditions must hold before it says anything:
 *   1. the newest PyPI release is above our pin, and
 *   2. that release is more than SETTLING_DAYS old.
 * The settling window keeps us off day-one releases — Docling ships often and
 * yanks/patches within days, and a document extractor's regressions land in
 * stored card content where they are expensive to notice.
 *
 * Exit status is always 0: this is a report, not a gate. It is wired into
 * `bin/update-agent-sdk-scheduled.sh` so the existing daily maintenance log
 * carries the line, and it prints nothing when there is nothing to say (a
 * silent run is the normal one — routine-success chatter is a bug, CLAUDE.md).
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

/**
 * The pin's single source of truth (see the file's own header). Parsed rather
 * than imported: this script lives in the monorepo root's TypeScript project,
 * which deliberately excludes `callback-box/`.
 */
const VERSION_FILE = path.join(REPO_ROOT, "callback-box", "src", "services", "docling-version.ts");

/** How old a release must be before we suggest it. */
const SETTLING_DAYS = 14;

const PYPI_URL = "https://pypi.org/pypi/docling/json";

function pinnedVersion(): string {
  const source = fs.readFileSync(VERSION_FILE, "utf-8");
  const match = /^export const DOCLING_VERSION = "([^"]+)";$/mu.exec(source);
  if (match?.[1] === undefined) {
    console.error(`check-docling-update: no DOCLING_VERSION declaration in ${VERSION_FILE}`);
    process.exit(2);
  }
  return match[1];
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
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

/** Newest non-prerelease on PyPI, with the upload time of its first file. */
async function latestRelease(): Promise<PypiLatest | null> {
  const response = await fetch(PYPI_URL);
  if (!response.ok) {
    console.warn(`check-docling-update: PyPI returned ${String(response.status)} for ${PYPI_URL}; skipping this run`);
    return null;
  }
  // Parse boundary: the registry's JSON arrives untyped, and only these two
  // fields are read — a shape change surfaces as the guarded checks below.
  const payload: unknown = await response.json();
  const info = isRecord(payload) ? payload["info"] : undefined;
  const version = isRecord(info) ? info["version"] : undefined;
  const releases = isRecord(payload) ? payload["releases"] : undefined;
  if (typeof version !== "string" || !isRecord(releases)) {
    console.warn("check-docling-update: unexpected PyPI payload shape; skipping this run");
    return null;
  }
  const files = releases[version];
  const first = Array.isArray(files) ? files[0] : undefined;
  const uploaded = isRecord(first) ? first["upload_time_iso_8601"] : undefined;
  if (typeof uploaded !== "string") {
    console.warn(`check-docling-update: PyPI reports no upload time for docling ${version}; skipping this run`);
    return null;
  }
  return { version, uploadedAt: new Date(uploaded) };
}

const pinned = pinnedVersion();
const latest = await latestRelease();
if (latest === null) process.exit(0);

if (compareVersions(latest.version, pinned) <= 0) process.exit(0);

const ageDays = (Date.now() - latest.uploadedAt.getTime()) / 86_400_000;
if (ageDays <= SETTLING_DAYS) process.exit(0);

console.log(
  `docling ${latest.version} is available (pinned: ${pinned}), released ${String(Math.floor(ageDays))} days ago.`
);
console.log(
  "Upgrading is manual: re-read `docling convert --help` for flag changes, bump DOCLING_VERSION in"
  + " callback-box/src/services/docling-version.ts, then `cb pdf reanalyze` a sample document and diff"
  + " (callback-box/docs/plans/scanner-ingest-docling-decisions.md, D3)."
);
