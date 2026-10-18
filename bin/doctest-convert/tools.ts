/**
 * The tools the conversion driver runs, each as a child process from the
 * directory `bin/test-roots.ts` names: the converter, tap, eslint, and a
 * package's typecheck script. Paths in and out are repo-relative.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, normalize, relative, resolve } from "node:path";
import { z } from "zod";
import { ToolLaunchError, ToolOutputError } from "./errors.ts";

export const REPO = resolve(import.meta.dirname, "../..");

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface Command {
  cmd: string;
  args: readonly string[];
  /** Repo-relative directory to run in. */
  cwd: string;
  env?: Record<string, string>;
}

function run(c: Command): Run {
  const r = spawnSync(c.cmd, c.args, {
    cwd: join(REPO, c.cwd),
    env: { ...process.env, ...c.env },
    encoding: "utf8",
    // tap's junit and eslint's JSON for a directory run to tens of megabytes.
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.error !== undefined) throw new ToolLaunchError({ cmd: c.cmd, args: c.args, cause: r.error.message });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Repo-relative path → path relative to `dir` (itself repo-relative). */
function from(dir: string, file: string): string {
  return relative(join(REPO, dir), join(REPO, file));
}

/** Path printed relative to `dir` → repo-relative. */
function back(dir: string, file: string): string {
  return normalize(relative(REPO, resolve(REPO, dir, file)));
}

/**
 * Run doctest-to-ts on repo-relative doctests. Returns the failure lines it
 * printed; throws unless it ran to its summary line (exit 0, or 1 when some
 * file failed to convert).
 */
export function convert(doctests: readonly string[], flags: readonly string[]): string[] {
  if (doctests.length === 0) return [];
  const r = run({ cmd: "node", args: ["agent-doctest/bin/doctest-to-ts.mjs", "--force", ...flags, ...doctests], cwd: "." });
  const lines = r.stdout.split("\n");
  const failed = lines.filter((l) => l.startsWith("FAIL "));
  const summary = `converted ${doctests.length - failed.length} of ${doctests.length}`;
  if ((r.status !== 0 && r.status !== 1) || !lines.includes(summary)) throw new ToolOutputError({ what: ["doctest-to-ts"], output: r.stdout + r.stderr });
  return failed;
}

export interface TapResult {
  failures: number;
  assertions: number;
}

/** `<testsuite ...>` attributes from tap's junit output, by repo-relative file. */
export function parseJunit(xml: string, runFrom: string): Map<string, TapResult> {
  const out = new Map<string, TapResult>();
  for (const m of xml.matchAll(/<testsuite\s([^>]*)>/g)) {
    const attrs = new Map([...(m[1] ?? "").matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1] ?? "", a[2] ?? ""]));
    const name = attrs.get("name");
    if (name === undefined) continue;
    out.set(back(runFrom, name), { failures: Number(attrs.get("failures") ?? "0"), assertions: Number(attrs.get("assertions") ?? "0") });
  }
  return out;
}

export interface TapRun {
  runFrom: string;
  files: readonly string[];
  /** Node arguments ahead of the tap config's own, e.g. a preload. */
  nodeArgs?: readonly string[];
  env?: Record<string, string>;
}

/** Run test files under `runFrom`'s tap config. A file missing from the result did not run. */
export function tap(t: TapRun): Map<string, TapResult> {
  if (t.files.length === 0) return new Map();
  const nodeArgs = (t.nodeArgs ?? []).map((a) => `--node-arg=${a}`);
  const r = run({
    cmd: "pnpm",
    args: ["-s", "exec", "tap", "--reporter=junit", ...nodeArgs, ...t.files.map((f) => from(t.runFrom, f))],
    cwd: t.runFrom,
    ...(t.env ? { env: t.env } : {}),
  });
  return parseJunit(r.stdout, t.runFrom);
}

const LintResults = z.array(
  z.object({
    filePath: z.string(),
    messages: z.array(z.object({ ruleId: z.string().nullable(), line: z.number().optional(), message: z.string(), severity: z.number() })),
  }),
);
export type LintMessage = z.infer<typeof LintResults>[number]["messages"][number];

/** eslint's findings per repo-relative file, run from `lintFrom`. */
export function eslint(lintFrom: string, files: readonly string[]): Map<string, LintMessage[]> {
  if (files.length === 0) return new Map();
  const r = run({ cmd: "pnpm", args: ["-s", "exec", "eslint", "--no-cache", "-f", "json", ...files.map((f) => from(lintFrom, f))], cwd: lintFrom });
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.stdout);
  } catch (error) {
    throw new ToolOutputError({ what: ["eslint from", lintFrom], output: String(error) + r.stderr });
  }
  const results = LintResults.safeParse(parsed);
  if (!results.success) throw new ToolOutputError({ what: ["eslint from", lintFrom], output: results.error.message });
  return new Map(results.data.map((res) => [relative(REPO, res.filePath), res.messages]));
}

export interface TypeErrorAt {
  file: string;
  line: number;
  code: string;
  message: string;
}

export interface Program {
  dir: string;
  script: string;
  printsFrom?: string;
}

/** Errors from a package's typecheck script, with repo-relative files. Throws when the script fails without one. */
export function typecheck(program: Program): TypeErrorAt[] {
  // A stale incremental build info hid new errors once
  // (issues/bugs/2026-10-18-incremental-typecheck-missed-new-include.md).
  for (const cache of [join(REPO, program.dir, "node_modules/.cache/tsc"), join(REPO, program.dir, "src/frontend/node_modules/.cache/tsc")]) {
    if (!existsSync(cache)) continue;
    for (const f of readdirSync(cache)) if (f.endsWith(".tsbuildinfo")) rmSync(join(cache, f));
  }
  const r = run({ cmd: "pnpm", args: ["-s", "run", program.script], cwd: program.dir });
  const errors: TypeErrorAt[] = [];
  for (const m of r.stdout.matchAll(/^(\S[^\n(]*)\((\d+),\d+\): error (TS\d+): (.*)$/gm)) {
    const file = back(program.printsFrom ?? program.dir, m[1] ?? "");
    errors.push({ file, line: Number(m[2]), code: m[3] ?? "", message: (m[4] ?? "").slice(0, 200) });
  }
  // A signal, or a failure with no diagnostic, is a crash, not a result.
  if (r.status === null || (r.status !== 0 && errors.length === 0)) throw new ToolOutputError({ what: [program.dir, program.script], output: r.stdout + r.stderr });
  return errors;
}

/** The blob hash git gives the file's current content. */
export function blobOf(file: string): string {
  const r = run({ cmd: "git", args: ["hash-object", file], cwd: "." });
  if (r.status !== 0) throw new ToolOutputError({ what: ["git hash-object", file], output: r.stderr });
  return r.stdout.trim();
}

/** Tracked and untracked (not ignored) doctests under a repo-relative directory. */
export function doctestsUnder(dir: string): string[] {
  const base = dir.replace(/\/$/, "");
  const r = run({ cmd: "git", args: ["ls-files", "--cached", "--others", "--exclude-standard", "--", `${base}/**/*.doctest.md`, `${base}/*.doctest.md`], cwd: "." });
  return [...new Set(r.stdout.split("\n").filter((f) => f !== "" && existsSync(join(REPO, f))))].toSorted();
}

/**
 * Whether git tracks the file and it has no uncommitted change. Only such a
 * doctest is converted: its recorded blob is then in history, so deleting
 * it loses nothing.
 */
export function isCommitted(file: string): boolean {
  if (run({ cmd: "git", args: ["ls-files", "--error-unmatch", "--", file], cwd: "." }).status !== 0) return false;
  return run({ cmd: "git", args: ["diff", "--quiet", "HEAD", "--", file], cwd: "." }).status === 0;
}
