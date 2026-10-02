#!/usr/bin/env node --import tsx
/**
 * `pnpm layout-check`: report every breach of the file-layout rules
 * (docs/plans/file-layout.md) in one or more package roots.
 *
 *   --root <pkg>   package root, repo-relative; repeatable. Default: every
 *                  package root in the repo that has a `src/` directory.
 *   --summary      counts per rule and area instead of every finding.
 *   --report       exit 0 even with findings (move-window rollout only).
 *
 * Prints nothing and exits 0 when the tree is clean. There is no changed-
 * files mode: a staged change in one directory can create a finding in
 * another (a new importer makes a parent's helper movable), and the whole
 * repo scans in a few seconds.
 */
import { dirname, resolve } from "node:path";
import { defaultRoots } from "../../default-roots.js";
import type { Finding } from "../../model.js";
import { scanPackage } from "../../scan/package/scan.js";
import { renderFindings, renderSummary } from "./report.js";
import { layoutRules } from "../rules.js";

class MissingRootValueError extends Error {
  constructor() {
    super("--root needs a package root");
    this.name = "MissingRootValueError";
  }
}

class UnknownArgumentError extends Error {
  readonly argument: string;
  constructor(argument: string) {
    super("unknown argument; expected --root <pkg>, --summary, or --report");
    this.name = "UnknownArgumentError";
    this.argument = argument;
  }
}

interface Args {
  roots: string[];
  summary: boolean;
  report: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { roots: [], summary: false, report: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root") {
      const value = argv[++i];
      if (value === undefined) throw new MissingRootValueError();
      args.roots.push(value.replace(/\/+$/, ""));
    } else if (arg === "--summary") args.summary = true;
    else if (arg === "--report") args.report = true;
    else throw new UnknownArgumentError(String(arg));
  }
  return args;
}

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../../../../../..");

async function checkRoot(root: string): Promise<Finding[]> {
  const layout = await scanPackage({ repoRoot: REPO_ROOT, packageRoot: root });
  const findings: Finding[] = [...layout.scanFindings];
  for (const rule of layoutRules.list) findings.push(...rule.check(layout));
  return findings;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const roots = args.roots.length > 0 ? args.roots : defaultRoots(REPO_ROOT);
  let total = 0;
  for (const root of roots) {
    const findings = await checkRoot(root);
    if (findings.length === 0) continue;
    total += findings.length;
    console.log(`layout-check: ${findings.length} findings in ${root}`);
    console.log(args.summary ? renderSummary({ findings, root }) : renderFindings(findings));
  }
  if (total > 0 && !args.report) process.exitCode = 1;
}

await main();
