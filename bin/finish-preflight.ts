/**
 * `/finish` steps 1–3 plus the classification, as one command: confirm the
 * worktree and the private leg, list stragglers, merge `main`, then print the
 * decision sheet every later step keys off.
 *
 *   bin/finish-preflight             # short text block
 *   bin/finish-preflight --json      # the sheet
 *   bin/finish-preflight --no-merge  # re-read the sheet without merging again
 *
 * Exit: 0 sheet printed, 2 wrong place / broken private mount, 3 merge conflict.
 *
 * See callback-box/docs/plans/change-based-test-selection.md, "Revision
 * 2026-08-25 — test economics", mechanism E2.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { changedPaths, git } from "./test-git.js";
import {
  hasCodeChange,
  isDocPath,
  isDocsOnly,
  isTestPath,
  groupPaths,
  parseTrailers,
  skipTypecheckLintDecision,
  trackORecommendation,
  verificationCommands,
  type VerificationCommand,
} from "./finish-preflight-lib.js";

export interface Sheet {
  worktree: string;
  branch: string;
  repoRoot: string;
  privateLeg: { active: boolean; state: string; repo: string | null };
  stragglers: string[];
  merge: { status: "up-to-date" | "merged"; broughtPaths: string[] };
  changed: { all: string[]; byGroup: Record<string, string[]>; unknownGroups: string[] };
  docsOnly: boolean;
  codeChanged: boolean;
  selectedTests: { files: string[]; note: string } | null;
  verification: VerificationCommand[];
  skipTypecheckLint: { value: boolean; reason: string; rule: string };
  plan: { attached: boolean; docs: string[]; trailers: string[] };
  issues: string[];
  diff: { lines: number; sourceLines: number };
  trackO: { recommended: boolean; reason: string };
}

const SKIP_RULE =
  "pre-commit runs typecheck+lint on every worktree commit, so a finish needs them again " +
  "only when code arrived that pre-commit never saw (the merge of main, or a straggler). " +
  "`--no-verify` leaves no git evidence and is not detectable.";

function repoRoot(): string {
  return git(["rev-parse", "--show-toplevel"]);
}

/** Top-level directory of every pnpm workspace entry. */
function workspacePackages(root: string): Set<string> {
  const text = readFileSync(join(root, "pnpm-workspace.yaml"), "utf-8");
  const parsed: unknown = parse(text);
  const packages =
    typeof parsed === "object" && parsed !== null && "packages" in parsed
      ? (parsed as { packages?: unknown }).packages
      : undefined;
  const list = Array.isArray(packages) ? packages : [];
  return new Set(list.map((entry) => String(entry).split("/")[0] ?? "").filter((p) => p !== ""));
}

function hasScriptIn(root: string): (pkg: string, script: string) => boolean {
  const cache = new Map<string, Set<string>>();
  return (pkg, script) => {
    let scripts = cache.get(pkg);
    if (scripts === undefined) {
      const file = join(root, pkg, "package.json");
      const parsed: unknown = existsSync(file) ? JSON.parse(readFileSync(file, "utf-8")) : {};
      const raw =
        typeof parsed === "object" && parsed !== null && "scripts" in parsed
          ? (parsed as { scripts?: Record<string, string> }).scripts
          : undefined;
      scripts = new Set(Object.keys(raw ?? {}));
      cache.set(pkg, scripts);
    }
    return scripts.has(script);
  };
}

class PreflightError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "PreflightError";
    this.exitCode = exitCode;
  }
}

function privateLeg(root: string): Sheet["privateLeg"] {
  const result = spawnSync(join(root, "bin/private-issues"), ["status", "."], {
    cwd: root,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    return { active: false, state: "no-repo", repo: null };
  }
  const out = result.stdout.trim();
  const state = /state=(\S+)/.exec(out)?.[1] ?? "unknown";
  const repo = /repo=(\S+)/.exec(out)?.[1] ?? null;
  if (state === "no-repo") return { active: false, state, repo: null };
  if (state === "valid") return { active: true, state, repo };
  // relink / invalid / anything else is a human decision, not an opt-out.
  throw new PreflightError(`private-issues mount is ${state} — heal it or return BLOCKED`, 2);
}

function mergeMain(root: string): Sheet["merge"] {
  const before = git(["rev-parse", "HEAD"], root);
  const result = spawnSync("git", ["merge", "main"], { cwd: root, encoding: "utf-8" });
  if (result.status !== 0) {
    const conflicted = git(["diff", "--name-only", "--diff-filter=U"], root);
    throw new PreflightError(
      `git merge main conflicted:\n${conflicted}\n${result.stdout}${result.stderr}`,
      3,
    );
  }
  const after = git(["rev-parse", "HEAD"], root);
  if (before === after) return { status: "up-to-date", broughtPaths: [] };
  const brought = git(["diff", "--name-only", `${before}..HEAD`], root)
    .split("\n")
    .filter((p) => p !== "");
  return { status: "merged", broughtPaths: brought };
}

/** Added+deleted lines vs main, total and restricted to non-doc, non-test files. */
function diffSize(root: string): { lines: number; sourceLines: number } {
  const numstat = git(["diff", "--numstat", "main...HEAD"], root);
  let lines = 0;
  let sourceLines = 0;
  for (const row of numstat.split("\n")) {
    if (row === "") continue;
    const [added, deleted, path] = row.split("\t");
    const count = Number(added === "-" ? 0 : added) + Number(deleted === "-" ? 0 : deleted);
    lines += count;
    if (path !== undefined && !isDocPath(path) && !isTestPath(path)) sourceLines += count;
  }
  return { lines, sourceLines };
}

/** Plans that name this workstream, plus any `Plan:` trailer on branch commits. */
function planDocs(root: string, workstream: string): string[] {
  const dir = join(root, "callback-box/docs/plans");
  if (!existsSync(dir)) return [];
  const listed = git(["ls-files", "callback-box/docs/plans"], root).split("\n");
  return listed.filter((file) => {
    if (!file.endsWith(".md")) return false;
    const head = readFileSync(join(root, file), "utf-8").slice(0, 2000);
    return new RegExp(`^workstream:\\s*${workstream}\\s*$`, "m").test(head);
  });
}

/**
 * The selected test set. Only asked for when callback-box is in the diff — the
 * selector's esbuild pass costs seconds and selects nothing otherwise.
 */
function selection(root: string, packages: string[]): Sheet["selectedTests"] {
  if (!packages.includes("callback-box")) return null;
  const result = spawnSync(process.execPath, ["--import", "tsx", join(root, "bin/test-select.ts")], {
    cwd: root,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    return { files: [], note: `selector failed (${result.stderr.trim()}) — run pnpm test` };
  }
  const files = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#") && line.includes("/"));
  return files.length === 0
    ? { files: [], note: "no test imports the changed paths" }
    : { files, note: `${files.length} selected` };
}

export function buildSheet(input: { merge: boolean }): Sheet {
  const root = repoRoot();
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], root);
  const worktree = basename(root);
  if (branch === "main" || branch === "HEAD") {
    throw new PreflightError(`on '${branch}' — /finish is for worktree branches only`, 2);
  }
  const workstream = branch.replace(/^worktree-/, "");
  const leg = privateLeg(root);
  const stragglers = git(["status", "--porcelain"], root)
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.slice(3));
  const merge = input.merge ? mergeMain(root) : { status: "up-to-date" as const, broughtPaths: [] };

  const changed = changedPaths({ base: "main", cwd: root });
  const packages = workspacePackages(root);
  const grouped = groupPaths(changed, packages);
  const skip = skipTypecheckLintDecision({
    mergeNoOp: merge.status === "up-to-date",
    mergeBroughtPaths: merge.broughtPaths,
    stragglers,
  });
  const verification = verificationCommands({
    paths: changed,
    workspacePackages: packages,
    hasScript: hasScriptIn(root),
    skipTypecheckLint: skip,
  });
  const messages = git(["log", "--format=%B%x00", "main..HEAD"], root).split("\0");
  const trailers = parseTrailers(messages);
  const plans = planDocs(root, workstream);
  const diff = diffSize(root);
  const codeChanged = hasCodeChange(changed);

  return {
    worktree,
    branch,
    repoRoot: root,
    privateLeg: leg,
    stragglers,
    merge,
    changed: { all: changed, byGroup: grouped.groups, unknownGroups: grouped.unknown },
    docsOnly: isDocsOnly(changed),
    codeChanged,
    selectedTests: selection(root, grouped.packages),
    verification,
    skipTypecheckLint: { ...skip, rule: SKIP_RULE },
    plan: { attached: plans.length > 0 || trailers.plans.length > 0, docs: plans, trailers: trailers.plans },
    issues: trailers.issues,
    diff,
    trackO: trackORecommendation({ codeChanged, sourceLines: diff.sourceLines }),
  };
}

export function formatSheet(sheet: Sheet): string {
  const lines: string[] = [];
  const list = (label: string, values: string[]): void => {
    lines.push(`${label}: ${values.length === 0 ? "none" : values.join(", ")}`);
  };
  lines.push(`worktree ${sheet.worktree} (${sheet.branch})`);
  lines.push(
    `private leg: ${sheet.privateLeg.active ? `ACTIVE (${sheet.privateLeg.repo ?? "?"})` : "not opted in — skip every private step"}`,
  );
  list("stragglers (never commit these blind)", sheet.stragglers);
  lines.push(
    `merge main: ${sheet.merge.status}${sheet.merge.broughtPaths.length > 0 ? ` (+${sheet.merge.broughtPaths.length} paths)` : ""}`,
  );
  lines.push(`changed (${sheet.changed.all.length} paths):`);
  for (const [group, paths] of Object.entries(sheet.changed.byGroup)) {
    lines.push(`  ${group}: ${paths.length}`);
  }
  if (sheet.changed.unknownGroups.length > 0) {
    list("  UNCLASSIFIED (verified as root)", sheet.changed.unknownGroups);
  }
  lines.push(`docsOnly: ${String(sheet.docsOnly)}   codeChanged: ${String(sheet.codeChanged)}`);
  lines.push(
    `selected tests: ${sheet.selectedTests === null ? "n/a (callback-box untouched)" : sheet.selectedTests.note}`,
  );
  for (const file of sheet.selectedTests?.files ?? []) lines.push(`  ${file}`);
  lines.push("verification:");
  for (const command of sheet.verification) {
    lines.push(`  ${command.skip === undefined ? "run " : "skip"} ${command.command}${command.skip === undefined ? "" : `  (${command.skip})`}`);
  }
  if (sheet.verification.length === 0) lines.push("  nothing to verify");
  lines.push(`skipTypecheckLint: ${String(sheet.skipTypecheckLint.value)} — ${sheet.skipTypecheckLint.reason}`);
  lines.push(`  rule: ${SKIP_RULE}`);
  list("plan", sheet.plan.docs.length > 0 ? sheet.plan.docs : sheet.plan.trailers);
  list("issues named in trailers", sheet.issues);
  lines.push(
    `diff: ${sheet.diff.lines} lines (${sheet.diff.sourceLines} source)   trackO: ${sheet.trackO.recommended ? "review" : "skip"} — ${sheet.trackO.reason}`,
  );
  return lines.join("\n");
}

export function main(argv: string[]): number {
  const json = argv.includes("--json");
  const sheet = buildSheet({ merge: !argv.includes("--no-merge") });
  console.log(json ? JSON.stringify(sheet, null, 2) : formatSheet(sheet));
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`finish-preflight: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = e instanceof PreflightError ? e.exitCode : 1;
  }
}
