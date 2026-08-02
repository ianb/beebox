#!/usr/bin/env node --import tsx
/**
 * Documentation enforcement (`pnpm doc-check`): exits nonzero on broken
 * references anywhere, on orphaned docs in the live reference area (flat
 * docs/, architecture/, scheduled/ — the plans taxonomy and reports/ are
 * archives and exempt), or on a duplicate basename under issues/ (the
 * unique-basename invariant the issue-link scheme relies on). Run by the
 * monorepo pre-commit hook for any commit touching .md files. Prints nothing
 * on success.
 *
 * `pnpm doc-check --fix` additionally repairs broken relative .md links: for a
 * link whose literal target no longer resolves, if the target's basename is
 * unique repo-wide it rewrites the path to the file's current location
 * (auto-healing issue-move decay and any other unique-basename doc). Links
 * with no basename match (a true rename/delete) or an ambiguous one are
 * reported, never guessed. It also reports repo-wide duplicate basenames as a
 * non-fatal warning (the gap toward making basenames globally unique).
 *
 * Naming/placement conventions: docs/README.md.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildGraphExtended, ROOT } from "./doc-graph-data.js";
import { duplicateBasenames, buildBasenameLookup, repairLinks, type UnfixableLink } from "./doc-link-repair.js";
import { findPrivateLinkViolations, PRIVATE_LINK_REASON } from "./private-link-check.js";

const MONO_ROOT = path.dirname(ROOT);

// Frozen point-in-time snapshots: their broken/example links are intentional,
// so --fix must not rewrite them (monorepo-relative prefixes).
const FROZEN_SCAN_PREFIXES = ["callback-box/docs/reports/"];

// Generated emitter outputs quote other files' links verbatim (regenerate with
// pnpm doc-graph / prompt-report); --fix must not touch them.
const GENERATED_NO_SCAN = new Set(["callback-box/docs/doc-graph.md", "callback-box/docs/prompts.md"]);

// Example-syntax lines the extractor can't distinguish from real refs.
// Format: "<from> -> <target>". Keep each entry justified.
const ALLOWED_BROKEN = new Set([
  // Describes the @MAP.md include syntax a box's context_dir provides.
  "docs/knowledge-audits.md -> MAP.md",
  // Frozen record quoting the broken-link example it was written about.
  "docs/implemented-plans/link-validation-fix.md -> /store/foo/bar.md",
]);

// Frozen point-in-time snapshots: their refs were valid at freeze time and
// are not maintained.
const BROKEN_EXEMPT_PREFIXES = ["docs/reports/"];

const ORPHAN_EXEMPT_PREFIXES = [
  "docs/plans/",
  "docs/implemented-plans/",
  "docs/unimplemented-plans/",
  "docs/reports/",
];

// Every tracked .md in the monorepo (repo-relative POSIX paths), excluding
// doctest fixtures (their example links aren't real references, and their
// basenames aren't link targets).
function trackedMarkdownFiles(): string[] {
  const stdout = execFileSync("git", ["ls-files", "-z", "*.md"], { cwd: MONO_ROOT, encoding: "utf8" });
  return stdout.split("\0").filter((p) => p.length > 0 && !p.endsWith(".doctest.md"));
}

function issueFiles(tracked: string[]): string[] {
  return tracked.filter((p) => p.startsWith("issues/"));
}

// The reference/orphan checks shared by both modes. Returns problem strings.
function referenceProblems(): string[] {
  const { docs, externalRefs } = buildGraphExtended();
  const problems: string[] = [];

  for (const doc of docs.values()) {
    if (BROKEN_EXEMPT_PREFIXES.some((p) => doc.path.startsWith(p))) continue;
    for (const ref of doc.outgoing) {
      if (!ref.resolved && !ALLOWED_BROKEN.has(`${doc.path} -> ${ref.target}`)) {
        problems.push(`broken ref: ${doc.path}:${ref.line} -> ${ref.target}`);
      }
    }
  }
  for (const ref of externalRefs) {
    if (!ref.resolved && !ALLOWED_BROKEN.has(`${ref.from} -> ${ref.target}`)) {
      problems.push(`broken ref: ${ref.from}:${ref.line} -> ${ref.target}`);
    }
  }

  for (const doc of docs.values()) {
    if (!doc.path.startsWith("docs/")) continue;
    if (ORPHAN_EXEMPT_PREFIXES.some((p) => doc.path.startsWith(p))) continue;
    if (doc.path.endsWith("README.md") || doc.path === "docs/doc-graph.md") continue;
    if (doc.incoming.length === 0) {
      problems.push(`orphan: ${doc.path} — nothing links to it; add a pointer (CLAUDE.md Guides table, a related doc, or a skill) or move it to an archive dir`);
    }
  }

  return problems;
}

// HARD invariant: no two files under issues/ may share a basename (the
// issue-link auto-repair scheme relies on it). Returns problem strings.
function issuesUniquenessProblems(tracked: string[]): string[] {
  const dups = duplicateBasenames(issueFiles(tracked));
  return [...dups].map(([base, paths]) => `duplicate issue basename: ${base} — ${paths.join(", ")} (issue basenames must be unique; rename or merge)`);
}

// HARD invariant, lexical and independent of filesystem resolution: a
// tracked (public) file must never link into private-issues/ — see
// src/dev/private-link-check.ts and docs/plans/private-issues-shadow-repo.md
// section I. Deliberately not fed through --fix: these are never a
// heal-by-basename case, they must stay a hard error.
function privateLinkProblems(tracked: string[]): string[] {
  const problems: string[] = [];
  for (const rel of tracked) {
    if (GENERATED_NO_SCAN.has(rel)) continue; // reflects other files' text verbatim, not real links
    const content = fs.readFileSync(path.join(MONO_ROOT, rel), "utf8");
    for (const v of findPrivateLinkViolations(rel, content)) {
      problems.push(`private-issues link: ${v.path}:${v.line} -> ${v.target} — ${PRIVATE_LINK_REASON}`);
    }
  }
  return problems;
}

function runDefaultCheck(): void {
  const tracked = trackedMarkdownFiles();
  const problems = [...referenceProblems(), ...issuesUniquenessProblems(tracked), ...privateLinkProblems(tracked)];

  if (problems.length > 0) {
    console.error("doc-check failed:");
    for (const p of problems) console.error(`  ${p}`);
    console.error("After fixing, regenerate the index: pnpm doc-graph. Conventions: docs/README.md.");
    process.exit(1);
  }
}

function runFix(): void {
  const tracked = trackedMarkdownFiles();
  const basenameLookup = buildBasenameLookup(tracked);
  const fileExists = (repoRel: string): boolean => fs.existsSync(path.join(MONO_ROOT, repoRel));

  const scanSources = tracked.filter((p) =>
    !GENERATED_NO_SCAN.has(p) && !FROZEN_SCAN_PREFIXES.some((prefix) => p.startsWith(prefix)),
  );

  let filesChanged = 0;
  let totalRewrites = 0;
  const unfixableByFile = new Map<string, UnfixableLink[]>();

  for (const rel of scanSources) {
    const abs = path.join(MONO_ROOT, rel);
    const content = fs.readFileSync(abs, "utf8");
    const result = repairLinks({ fromRel: rel, content, fileExists, basenameLookup });
    if (result.rewrites.length > 0) {
      fs.writeFileSync(abs, result.content, "utf8");
      filesChanged++;
      totalRewrites += result.rewrites.length;
      console.log(`fixed ${rel}:`);
      for (const rw of result.rewrites) console.log(`  L${rw.line}: ${rw.from} -> ${rw.to}`);
    }
    if (result.unfixable.length > 0) unfixableByFile.set(rel, result.unfixable);
  }

  console.log(totalRewrites > 0
    ? `\ndoc-check --fix: rewrote ${totalRewrites} link(s) across ${filesChanged} file(s).`
    : "\ndoc-check --fix: no broken links needed rewriting.");

  const issuesProblems = issuesUniquenessProblems(tracked);
  if (issuesProblems.length > 0) {
    console.error("\nissues/ uniqueness violations (must fix — auto-repair depends on this):");
    for (const p of issuesProblems) console.error(`  ${p}`);
  }

  // Never auto-fixed (not a heal-by-basename case — a private-issues link is
  // always a hard error, not a decayed reference).
  const privateProblems = privateLinkProblems(tracked);
  if (privateProblems.length > 0) {
    console.error("\nprivate-issues link violations (must fix by hand — never auto-repaired):");
    for (const p of privateProblems) console.error(`  ${p}`);
  }

  if (unfixableByFile.size > 0) {
    console.error("\nunfixable broken links (manual — true rename/delete or ambiguous):");
    for (const [rel, links] of unfixableByFile) {
      for (const l of links) console.error(`  ${rel}:L${l.line} -> ${l.target} (${l.reason})`);
    }
  }

  // Non-fatal: how far the repo is from globally unique basenames (excluding
  // the intentionally-per-directory whitelist). --fix works today wherever a
  // basename happens to be unique; this just surfaces the remaining overlaps.
  const repoDups = duplicateBasenames(tracked);
  if (repoDups.size > 0) {
    console.log(`\nrepo-wide duplicate basenames (${repoDups.size}) — not a failure; --fix can't auto-resolve these:`);
    for (const [base, paths] of repoDups) console.log(`  ${base}: ${paths.join(", ")}`);
  }

  // Fail loud on anything needing a human; rewrites alone are a success.
  if (issuesProblems.length > 0 || privateProblems.length > 0 || unfixableByFile.size > 0) process.exit(1);
}

if (process.argv.includes("--fix")) runFix();
else runDefaultCheck();
