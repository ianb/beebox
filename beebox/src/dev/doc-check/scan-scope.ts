/**
 * Which files doc-check reads for which kind of reference. Shared by
 * `check.ts` (the check and `--fix`) and `bin/lib/doc-move.ts` (a targeted move), so a
 * move rewrites exactly the references doc-check enforces.
 */

import * as path from "node:path";
import { SITE_DOCS_PREFIX } from "./site-reference-links.js";

// Frozen point-in-time snapshots: their broken/example links are intentional,
// so --fix must not rewrite them (monorepo-relative prefixes).
export const FROZEN_SCAN_PREFIXES = ["beebox/docs/reports/", "beebox/docs/user-stories/catalog/"];

// Generated emitter outputs quote other files' links verbatim (regenerate with
// pnpm doc-graph / prompt-report); --fix must not touch them.
export const GENERATED_NO_SCAN = new Set(["beebox/docs/doc-graph.md", "beebox/docs/prompts.md"]);

// `site/docs/` is the public agent-docs corpus: its links are relative to the
// PUBLISHED tree (`concepts/glossary.md`), not the repo, and the site build
// validates them. Scanning them here reports phantom breaks, and `--fix` once
// rewrote them into repo paths (2026-09-12).
export const AGENT_DOCS_PREFIX = SITE_DOCS_PREFIX;

// Code and YAML files whose plan and issue mentions (source comments,
// schedule configs, knowledge-audits.yaml) follow moves.
export const MENTION_SOURCE_RE = /\.(?:ts|tsx|mts|yaml|yml)$/;

// Historical records whose backticked paths were accurate when written and are
// not maintained (monorepo-relative prefixes). Generated outputs
// (GENERATED_NO_SCAN) are skipped too.
const FILE_PATH_EXEMPT_PREFIXES = [
  "beebox/docs/implemented-plans/",
  "beebox/docs/unimplemented-plans/",
  "beebox/docs/reports/",
  "beebox/docs/user-stories/catalog/",
  "issues/closed/",
  "research/",
  // Cumulative release log: each entry quotes paths as of its release.
  "schedules/sdk-update/agent-sdk-notes.md",
];

export function isFilePathExempt(rel: string): boolean {
  return GENERATED_NO_SCAN.has(rel)
    || FILE_PATH_EXEMPT_PREFIXES.some((p) => rel.startsWith(p))
    // Changelogs and dated reports (docs/reports/, user-story journey reports).
    || path.posix.basename(rel) === "CHANGELOG.md"
    || rel.includes("/reports/");
}

/** A Markdown file whose relative links and frontmatter paths `--fix` maintains. */
export function isLinkScanned(rel: string): boolean {
  return !rel.startsWith(AGENT_DOCS_PREFIX)
    && !GENERATED_NO_SCAN.has(rel)
    && !FROZEN_SCAN_PREFIXES.some((prefix) => rel.startsWith(prefix));
}
