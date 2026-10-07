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

import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildGraphExtended, ROOT } from "../doc-graph-data/data.js";
import { duplicateBasenames, buildBasenameLookup, repairFrontmatterPaths, repairLinks, type UnfixableLink } from "./link-repair.js";
import { findPrivateLinkViolations, PRIVATE_LINK_REASON } from "./private-link.js";
import { frontmatterProblems } from "./frontmatter.js";
import { describeFilePathProblem, findFilePathProblems, repairFilePaths, type FilePathProblem } from "./file-paths.js";

const MONO_ROOT = path.dirname(ROOT);

// Frozen point-in-time snapshots: their broken/example links are intentional,
// so --fix must not rewrite them (monorepo-relative prefixes).
const FROZEN_SCAN_PREFIXES = ["beebox/docs/reports/", "beebox/docs/user-stories/catalog/"];

// Generated emitter outputs quote other files' links verbatim (regenerate with
// pnpm doc-graph / prompt-report); --fix must not touch them.
const GENERATED_NO_SCAN = new Set(["beebox/docs/doc-graph.md", "beebox/docs/prompts.md"]);

// Example-syntax lines the extractor can't distinguish from real refs.
// Format: "<from> -> <target>". Keep each entry justified.
const ALLOWED_BROKEN = new Set([
  // Describes the @MAP.md include syntax a box's context_dir provides.
  "docs/testing/knowledge-audits.md -> MAP.md",
  // Frozen record quoting the broken-link example it was written about.
  "docs/implemented-plans/link-validation-fix.md -> /store/foo/bar.md",
]);

// Frozen point-in-time snapshots: their refs were valid at freeze time and
// are not maintained.
const BROKEN_EXEMPT_PREFIXES = ["docs/reports/", "docs/user-stories/catalog/"];

const ORPHAN_EXEMPT_PREFIXES = [
  "docs/plans/",
  "docs/implemented-plans/",
  "docs/unimplemented-plans/",
  "docs/reports/",
  // Dated user-story catalogs: same frozen-snapshot category as reports/. Their
  // verification prose quotes code identifiers ("MAP.md", "path.md") that the
  // ref extractor cannot tell from links.
  "docs/user-stories/catalog/",
];

// Every tracked .md in the monorepo (repo-relative POSIX paths), excluding
// doctest fixtures (their example links aren't real references, and their
// basenames aren't link targets).
function trackedMarkdownFiles(): string[] {
  return trackedMarkdownFilesIncludingDoctests().filter((p) => !p.endsWith(".doctest.md"));
}

// Same set, but keeping .doctest.md fixtures: they're public tracked markdown
// too, so the private-issues link scan (unlike the reference/orphan checks,
// which treat doctest example links as non-real references) must not exempt
// them — a private-issues link in doctest prose is a real leak.
function trackedMarkdownFilesIncludingDoctests(): string[] {
  const stdout = execFileSync("git", ["ls-files", "-z", "*.md"], { cwd: MONO_ROOT, encoding: "utf8" });
  return stdout.split("\0").filter((p) => p.length > 0 && fs.existsSync(path.join(MONO_ROOT, p)));
}

function markdownFilesIncludingDoctests(): string[] {
  const stdout = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "*.md"],
    { cwd: MONO_ROOT, encoding: "utf8" },
  );
  return stdout.split("\0").filter((p) => p.length > 0 && fs.existsSync(path.join(MONO_ROOT, p)));
}

// `site/docs/` is the public agent-docs corpus: its links are relative to the
// PUBLISHED tree (`concepts/glossary.md`), not the repo, and the site build
// validates them. Scanning them here reports phantom breaks, and `--fix` once
// rewrote them into repo paths (2026-09-12).
const AGENT_DOCS_PREFIX = "site/docs/";

function markdownFiles(): string[] {
  return markdownFilesIncludingDoctests().filter((p) => !p.endsWith(".doctest.md") && !p.startsWith(AGENT_DOCS_PREFIX));
}

function issueFiles(tracked: string[]): string[] {
  return tracked.filter((p) => p.startsWith("issues/"));
}

// The reference/orphan checks shared by both modes. Returns problem strings.
function referenceProblems(tracked: ReadonlySet<string>): string[] {
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
    const monorepoPath = `beebox/${doc.path}`;
    if (!tracked.has(monorepoPath)) continue;
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
// tracked (public) file — including doctest fixtures — must never link into
// private-issues/ — see src/dev/doc-check/private-link.ts and
// docs/implemented-plans/private-issues-shadow-repo.md section I. Deliberately not fed
// through --fix: these are never a heal-by-basename case, they must stay a
// hard error. Scans its own file list (rather than taking `tracked`) because
// it must cover .doctest.md, unlike every other check here.
function privateLinkProblems(): string[] {
  const problems: string[] = [];
  for (const rel of trackedMarkdownFilesIncludingDoctests()) {
    if (GENERATED_NO_SCAN.has(rel)) continue; // reflects other files' text verbatim, not real links
    const content = fs.readFileSync(path.join(MONO_ROOT, rel), "utf8");
    for (const v of findPrivateLinkViolations(rel, content)) {
      problems.push(`private-issues link: ${v.path}:${v.line} -> ${v.target} — ${PRIVATE_LINK_REASON}`);
    }
  }
  return problems;
}

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

function isFilePathExempt(rel: string): boolean {
  return GENERATED_NO_SCAN.has(rel)
    || FILE_PATH_EXEMPT_PREFIXES.some((p) => rel.startsWith(p))
    // Changelogs and dated reports (docs/reports/, user-story journey reports).
    || path.posix.basename(rel) === "CHANGELOG.md"
    || rel.includes("/reports/");
}

class GitCheckIgnoreError extends Error {
  constructor(readonly stderr: string) {
    super("git check-ignore failed");
    this.name = "GitCheckIgnoreError";
  }
}

// The subset of `paths` (repo-relative) that .gitignore rules match.
function gitIgnored(paths: string[]): Set<string> {
  if (paths.length === 0) return new Set();
  const result = spawnSync("git", ["check-ignore", "--no-index", "--stdin", "-z"], { cwd: MONO_ROOT, input: paths.join("\0"), encoding: "utf8" });
  // Exit 1 means none matched; anything else but 0 is a real failure.
  if (result.status !== 0 && result.status !== 1) throw new GitCheckIgnoreError(result.stderr);
  return new Set(result.stdout.split("\0").filter((p) => p.length > 0));
}

// Backticked paths that name a file outside this repo even though they start
// with a repo directory. Format: "<monorepo doc> -> <token>". Keep each entry
// justified.
const ALLOWED_MISSING_PATHS = new Set([
  // Box guidance surfaces: files every box carries in its own tree.
  "beebox/docs/box-guidance.md -> src/schemas/CLAUDE.md",
  "beebox/docs/box-guidance.md -> src/views/CLAUDE.md",
  "beebox/docs/box-guidance.md -> src/tricks/scripts/CLAUDE.md",
  "beebox/docs/box-guidance.md -> .claude/rules/bbx-validate-ignore.md",
  "beebox/docs/cards.md -> src/schemas/CLAUDE.md",
  "beebox/docs/testing/knowledge-audits.md -> src/schemas/CLAUDE.md",
  "beebox/docs/testing/knowledge-audits.md -> .claude/rules/card-memo.md",
  // Entry points of a consumer project that installs the preset.
  "personal-vibe-check/install.md -> src/index.ts",
  "personal-vibe-check/install.md -> src/main.tsx",
]);

// Plans and open issues name files they propose to create, and quote code
// locations as of when they were filed, so a missing path there is not
// decay. Only the deterministic moved-to-closed finding applies to them.
const FILE_PATH_FORWARD_LOOKING_PREFIXES = ["beebox/docs/plans/", "issues/"];

// Backticked repo paths in prose (`beebox/src/foo.ts`) that resolve nowhere —
// see src/dev/doc-check/file-paths.ts.
function filePathProblemsByFile(files: string[]): Map<string, FilePathProblem[]> {
  const fileExists = (rel: string): boolean => fs.existsSync(path.join(MONO_ROOT, rel));
  const byFile = new Map<string, FilePathProblem[]>();
  for (const rel of files) {
    if (isFilePathExempt(rel)) continue;
    const content = fs.readFileSync(path.join(MONO_ROOT, rel), "utf8");
    const forwardLooking = FILE_PATH_FORWARD_LOOKING_PREFIXES.some((p) => rel.startsWith(p));
    const problems = findFilePathProblems({ docRel: rel, content, fileExists }).filter((p) => (!forwardLooking || p.kind === "moved-to-closed") && !ALLOWED_MISSING_PATHS.has(`${rel} -> ${p.token}`));
    if (problems.length > 0) byFile.set(rel, problems);
  }
  // A gitignored path (deploy/target.env, a build output) legitimately need
  // not exist; one batched check-ignore covers every unresolved candidate.
  const ignored = gitIgnored([...byFile.values()].flatMap((ps) => ps.flatMap((p) => p.tried)));
  for (const [rel, problems] of byFile) {
    const kept = problems.filter((p) => !p.tried.some((t) => ignored.has(t)));
    if (kept.length > 0) byFile.set(rel, kept);
    else byFile.delete(rel);
  }
  return byFile;
}

function filePathProblems(files: string[]): string[] {
  return [...filePathProblemsByFile(files)].flatMap(([rel, problems]) => problems.map((p) => describeFilePathProblem(rel, p)));
}

function schemaProblems(tracked: string[]): string[] {
  const exists = (rel: string): boolean => fs.existsSync(path.join(MONO_ROOT, rel));
  return tracked.flatMap((rel) => frontmatterProblems({
    rel,
    source: fs.readFileSync(path.join(MONO_ROOT, rel), "utf8"),
    exists,
  }));
}

function runDefaultCheck(): void {
  const tracked = trackedMarkdownFiles();
  const all = markdownFiles();
  const problems = [...referenceProblems(new Set(tracked)), ...issuesUniquenessProblems(all), ...privateLinkProblems(), ...schemaProblems(all), ...filePathProblems(all)];

  if (problems.length > 0) {
    console.error("doc-check failed:");
    for (const p of problems) console.error(`  ${p}`);
    console.error("After fixing, regenerate the index: pnpm doc-graph. Conventions: docs/README.md.");
    process.exit(1);
  }
}

// --fix half of the backticked-path check: rewrite issues that moved to
// closed/ in place; every other finding is returned for manual handling.
function fixFilePaths(files: string[]): { rewrites: number; filesChanged: number; missing: string[] } {
  let rewrites = 0;
  let filesChanged = 0;
  const missing: string[] = [];
  for (const [rel, problems] of filePathProblemsByFile(files)) {
    const abs = path.join(MONO_ROOT, rel);
    const moved = problems.filter((p) => p.kind === "moved-to-closed");
    if (moved.length > 0) {
      fs.writeFileSync(abs, repairFilePaths(fs.readFileSync(abs, "utf8"), moved), "utf8");
      rewrites += moved.length;
      filesChanged++;
      console.log(`fixed ${rel}:`);
      for (const p of moved) console.log(`  L${p.line}: \`${p.token}\` -> \`${p.suggestion ?? ""}\``);
    }
    for (const p of problems) if (p.kind === "missing") missing.push(describeFilePathProblem(rel, p));
  }
  return { rewrites, filesChanged, missing };
}

function runFix(): void {
  const tracked = trackedMarkdownFiles();
  const all = markdownFiles();
  const basenameLookup = buildBasenameLookup(tracked);
  const fileExists = (repoRel: string): boolean => fs.existsSync(path.join(MONO_ROOT, repoRel));

  const scanSources = all.filter((p) =>
    !GENERATED_NO_SCAN.has(p) && !FROZEN_SCAN_PREFIXES.some((prefix) => p.startsWith(prefix)),
  );

  let filesChanged = 0;
  let totalRewrites = 0;
  const unfixableByFile = new Map<string, UnfixableLink[]>();

  for (const rel of scanSources) {
    const abs = path.join(MONO_ROOT, rel);
    const content = fs.readFileSync(abs, "utf8");
    const frontmatterResult = repairFrontmatterPaths({ fromRel: rel, content, fileExists, basenameLookup });
    const markdownResult = repairLinks({ fromRel: rel, content: frontmatterResult.content, fileExists, basenameLookup });
    const result = {
      content: markdownResult.content,
      rewrites: [...frontmatterResult.rewrites, ...markdownResult.rewrites],
      unfixable: [...frontmatterResult.unfixable, ...markdownResult.unfixable],
    };
    if (result.rewrites.length > 0) {
      fs.writeFileSync(abs, result.content, "utf8");
      filesChanged++;
      totalRewrites += result.rewrites.length;
      console.log(`fixed ${rel}:`);
      for (const rw of result.rewrites) console.log(`  L${rw.line}: ${rw.from} -> ${rw.to}`);
    }
    if (result.unfixable.length > 0) unfixableByFile.set(rel, result.unfixable);
  }

  const pathFix = fixFilePaths(scanSources);
  totalRewrites += pathFix.rewrites;
  filesChanged += pathFix.filesChanged;
  const missingPaths = pathFix.missing;

  console.log(totalRewrites > 0
    ? `\ndoc-check --fix: rewrote ${totalRewrites} link(s) across ${filesChanged} file(s).`
    : "\ndoc-check --fix: no broken links needed rewriting.");

  const issuesProblems = issuesUniquenessProblems(all);
  if (issuesProblems.length > 0) {
    console.error("\nissues/ uniqueness violations (must fix — auto-repair depends on this):");
    for (const p of issuesProblems) console.error(`  ${p}`);
  }

  // Never auto-fixed (not a heal-by-basename case — a private-issues link is
  // always a hard error, not a decayed reference).
  const privateProblems = privateLinkProblems();
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

  if (missingPaths.length > 0) {
    console.error("\nmissing backticked file paths (manual — find the current path or drop the reference):");
    for (const p of missingPaths) console.error(`  ${p}`);
  }

  // Non-fatal: how far the repo is from globally unique basenames (excluding
  // the intentionally-per-directory whitelist). --fix works today wherever a
  // basename happens to be unique; this just surfaces the remaining overlaps.
  const repoDups = duplicateBasenames(all);
  if (repoDups.size > 0) {
    console.log(`\nrepo-wide duplicate basenames (${repoDups.size}) — not a failure; --fix can't auto-resolve these:`);
    for (const [base, paths] of repoDups) console.log(`  ${base}: ${paths.join(", ")}`);
  }

  // Fail loud on anything needing a human; rewrites alone are a success.
  if (issuesProblems.length > 0 || privateProblems.length > 0 || unfixableByFile.size > 0 || missingPaths.length > 0) process.exit(1);
}

if (process.argv.includes("--fix")) runFix();
else runDefaultCheck();
