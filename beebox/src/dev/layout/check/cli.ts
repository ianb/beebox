#!/usr/bin/env node --import tsx
/**
 * `pnpm layout-check`: report every breach of the file-layout rules
 * (docs/plans/file-layout.md) in one or more package roots.
 *
 *   --root <pkg>   package root, repo-relative; repeatable. Default: every
 *                  package root in the repo that has a `src/` directory.
 *   --changed      only findings in directories that hold a staged file.
 *   --summary      counts per rule and area instead of every finding.
 *   --report       exit 0 even with findings (move-window rollout only).
 *
 * Prints nothing and exits 0 when the tree is clean.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { dirOf, isWithin } from "../graph.js";
import type { Finding } from "../model.js";
import { scanPackage } from "../scan/package.js";
import { renderFindings, renderSummary } from "./report.js";
import { layoutRules } from "./rules.js";

class MissingRootValueError extends Error {
  constructor() {
    super("--root needs a package root");
    this.name = "MissingRootValueError";
  }
}

class UnknownArgumentError extends Error {
  readonly argument: string;
  constructor(argument: string) {
    super("unknown argument; expected --root <pkg>, --changed, --summary, or --report");
    this.name = "UnknownArgumentError";
    this.argument = argument;
  }
}

interface Args {
  roots: string[];
  changed: boolean;
  summary: boolean;
  report: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { roots: [], changed: false, summary: false, report: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root") {
      const value = argv[++i];
      if (value === undefined) throw new MissingRootValueError();
      args.roots.push(value.replace(/\/+$/, ""));
    } else if (arg === "--changed") args.changed = true;
    else if (arg === "--summary") args.summary = true;
    else if (arg === "--report") args.report = true;
    else throw new UnknownArgumentError(String(arg));
  }
  return args;
}

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../../../../..");

function git(args: string[]): string[] {
  const out = execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return out.split("\0").filter((s) => s.length > 0);
}

function defaultRoots(): string[] {
  return git(["ls-files", "-z", "--", "package.json", "*/package.json"])
    .map((p) => dirOf(p))
    .filter((root) => root !== "" && !root.includes("node_modules"))
    .filter((root) => existsSync(join(REPO_ROOT, root, "src")))
    .toSorted();
}

function stagedDirectories(): string[] {
  return [...new Set(git(["diff", "--cached", "--name-only", "-z"]).map((p) => dirOf(p)))];
}

/** A finding is in scope for --changed when it sits in a directory holding a staged file. */
function inChangedScope(finding: Finding, dirs: string[]): boolean {
  return dirs.some((d) => finding.path === d || dirOf(finding.path) === d || isWithin(d, finding.path));
}

async function checkRoot(root: string): Promise<Finding[]> {
  const layout = await scanPackage({ repoRoot: REPO_ROOT, packageRoot: root });
  const findings: Finding[] = [...layout.scanFindings];
  for (const rule of layoutRules.list) findings.push(...rule.check(layout));
  return findings;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const roots = args.roots.length > 0 ? args.roots : defaultRoots();
  const dirs = args.changed ? stagedDirectories() : [];
  let total = 0;
  for (const root of roots) {
    let findings = await checkRoot(root);
    if (args.changed) findings = findings.filter((f) => inChangedScope(f, dirs));
    if (findings.length === 0) continue;
    total += findings.length;
    console.log(`layout-check: ${findings.length} findings in ${root}`);
    console.log(args.summary ? renderSummary({ findings, root }) : renderFindings(findings));
  }
  if (total > 0 && !args.report) process.exitCode = 1;
}

await main();
